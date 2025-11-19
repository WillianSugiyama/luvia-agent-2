import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { QdrantClient } from '@qdrant/js-client-rest';
import type {
  ProductMetadata,
  ProductRuleMetadata,
  SalesFrameworkOutput,
} from '../../types/luvia.types';

interface ProductEmbeddingRow {
  metadata: ProductMetadata;
}

interface ProductRuleRow {
  metadata: ProductRuleMetadata | { rules?: string[]; rule?: string };
}

interface CustomerEventRow {
  event_type: string;
}

let supabaseClient: SupabaseClient | null = null;
let openaiClient: OpenAI | null = null;
let qdrantClient: QdrantClient | null = null;

const getSupabaseClient = () => {
  if (!supabaseClient) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_KEY;

    if (!url || !key) {
      throw new Error('Supabase credentials are not configured');
    }

    supabaseClient = createClient(url, key);
  }

  return supabaseClient;
};

const getOpenAIClient = () => {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not configured');
    }

    openaiClient = new OpenAI({ apiKey });
  }

  return openaiClient;
};

const getQdrantClient = () => {
  if (!qdrantClient) {
    const url = process.env.QDRANT_URL;
    const apiKey = process.env.QDRANT_API_KEY;

    if (!url || !apiKey) {
      return null;
    }

    qdrantClient = new QdrantClient({
      url,
      apiKey,
      // Evita tentativa de checar versão em ambientes onde o servidor não responde
      checkCompatibility: false,
      timeout: 10,
    });
  }

  return qdrantClient;
};

const getEnrichedContextInputSchema = z.object({
  product_id: z.string(),
  team_id: z.string(),
  customer_phone: z.string(),
  user_intent: z.string(),
});

const getEnrichedContextOutputSchema = z.object({
  product: z.object({
    name: z.string(),
    price: z.string(),
    checkout_link: z.string(),
    description: z.string().optional(),
  }),
  customer_status: z.string(),
  rules: z.array(z.string()),
  sales_strategy: z.object({
    framework: z.string(),
    instruction: z.string(),
    cta_suggested: z.string(),
    should_offer: z.boolean().default(true),
  }),
});

const fetchProductMetadata = async (
  teamId: string,
  productId: string,
  logger?: any,
): Promise<ProductMetadata | null> => {
  const supabase = getSupabaseClient();

  if (logger) {
    logger.info(`Fetching Product Metadata: team_id='${teamId}', product_id='${productId}'`);
  }

  const { data, error } = await supabase
    .from('product_embeddings')
    .select('metadata')
    .eq('team_id', teamId)
    .eq('id', productId)
    .maybeSingle<ProductEmbeddingRow>();

  if (error) {
    if (logger) logger.error('Error fetching product metadata', error);
    throw error;
  }

  if (logger) {
    logger.info(data ? 'Product Metadata found.' : 'No Product Metadata found.');
  }

  return data?.metadata ?? null;
};

const fetchProductRules = async (
  teamId: string, 
  productId: string,
  logger?: any
): Promise<string[]> => {
  const supabase = getSupabaseClient();

  if (logger) {
    logger.info(`Fetching Rules from Supabase: table='product_rule_embeddings', team_id='${teamId}', product_id='${productId}'`);
  }

  const { data, error } = await supabase
    .from('product_rule_embeddings')
    .select('metadata')
    .eq('team_id', teamId)
    .eq('product_id', productId);

  if (error) {
    if (logger) logger.error('Error fetching rules from Supabase', error);
    throw error;
  }

  if (logger) {
    logger.info(`Supabase returned ${data?.length ?? 0} rule rows.`);
    if (data && data.length > 0) {
       // Log the first item to debug structure
       logger.info({ firstRow: data[0] }, 'First Rule Row Payload');
    }
  }

  const rows = (data ?? []) as ProductRuleRow[];
  const rules: string[] = [];

  for (const row of rows) {
    const meta = row.metadata as any;

    if (Array.isArray(meta.rules)) {
      for (const rule of meta.rules) {
        if (typeof rule === 'string' && rule.trim()) {
          rules.push(rule.trim());
        }
      }
    } else if (typeof meta.rule === 'string' && meta.rule.trim()) {
      rules.push(meta.rule.trim());
    }
  }

  return rules;
};

const fetchCustomerStatus = async (
  teamId: string,
  customerPhone: string,
  productId: string,
): Promise<string> => {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('customer_events')
    .select('event_type')
    .eq('team_id', teamId)
    .eq('customer_phone', customerPhone)
    .eq('product_id', productId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as CustomerEventRow[];
  const latest = rows[0];

  return latest?.event_type ?? 'UNKNOWN';
};

const generateIntentEmbedding = async (userIntent: string, logger?: any) => {
  const openai = getOpenAIClient();

  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: userIntent,
  });

  const embedding = response.data[0]?.embedding;

  if (!embedding) {
    throw new Error('Failed to generate intent embedding');
  }

  return embedding;
};

const buildFallbackSalesStrategy = (userIntent: string, logger?: any) => {
  if (logger) {
    logger.info('Using Fallback Sales Strategy.');
  }

  let framework = 'Genérico';
  let instruction = 'Adapte a mensagem ao contexto do cliente.';

  if (/preço|caro|alto/i.test(userIntent)) {
    framework = 'Objeção de Preço';
    instruction = 'Reforce o valor agregado antes de mencionar preço.';
  } else if (/urgênc|urgenc|agora|hoje/i.test(userIntent)) {
    framework = 'Escassez Real';
    instruction = 'Reforce que a oferta tem tempo limitado.';
  }

  const cta = 'Clique agora para garantir sua oferta.';

  return {
    framework,
    instruction,
    cta_suggested: cta,
  };
};

const fetchSalesStrategy = async (userIntent: string, logger?: any) => {
  const qdrant = getQdrantClient();

  if (!qdrant) {
    if (logger) {
      logger.warn('Qdrant client not available, using fallback strategy.');
    }
    return buildFallbackSalesStrategy(userIntent, logger);
  }

  try {
    const embedding = await generateIntentEmbedding(userIntent, logger);

    const results = await qdrant.search('sales_frameworks', {
      vector: embedding,
      limit: 1,
      with_payload: true,
    });

    const top = results[0];

    if (!top || !top.payload) {
      if (logger) {
        logger.info('No matching sales framework found in Qdrant.');
      }
      return buildFallbackSalesStrategy(userIntent, logger);
    }

    const payload = top.payload as unknown as SalesFrameworkOutput | any;
    // Supports multiple payload structures (nested output or flat)
    const output = payload.output ?? payload;

    const frameworksUtilizados = Array.isArray(output.frameworks_utilizados)
      ? output.frameworks_utilizados
      : [];

    const framework =
      frameworksUtilizados[0] ??
      output.framework ??
      output.framework_name ??
      'Genérico';

    const instruction =
      output.instrucoes_execucao ??
      output.instruction ??
      'Adapte a mensagem ao contexto do cliente.';

    const ctaSuggested =
      output.call_to_action ??
      output.cta_suggested ??
      'Clique agora para garantir sua oferta.';

    const shouldOffer =
      typeof output.deve_ofertar === 'boolean' ? output.deve_ofertar : true;

    if (logger) {
      logger.info(`Sales Strategy Found: Framework="${framework}"`);
      logger.debug({ payload: output }, 'Sales Strategy Payload');
    }

    return {
      framework,
      instruction,
      cta_suggested: ctaSuggested,
      should_offer: shouldOffer,
    };
  } catch (err) {
    if (logger) {
      logger.error('Error fetching sales strategy from Qdrant', err);
    }
    return buildFallbackSalesStrategy(userIntent, logger);
  }
};

export const get_enriched_context = createTool({
  id: 'get_enriched_context',
  description:
    'Fetches and aggregates product metadata, rules, customer status, and sales framework strategy.',
  inputSchema: getEnrichedContextInputSchema,
  outputSchema: getEnrichedContextOutputSchema,
  execute: async ({ context, mastra }) => {
    const { product_id, team_id, customer_phone, user_intent } = context;
    const logger = mastra?.logger;

    if (logger) {
      logger.info(`Enriching context for Product: ${product_id}, Team: ${team_id}`);
    }

    const [productMetadata, rules, customerStatus, salesStrategy] = await Promise.all([
      fetchProductMetadata(team_id, product_id, logger),
      fetchProductRules(team_id, product_id, logger),
      fetchCustomerStatus(team_id, customer_phone, product_id),
      fetchSalesStrategy(user_intent, logger),
    ]);

    if (logger) {
      logger.info(`Fetched ${rules.length} rules and Customer Status: ${customerStatus}`);
    }

    const rawPrice = productMetadata?.preco;
    const price =
      typeof rawPrice === 'number'
        ? String(rawPrice)
        : typeof rawPrice === 'string'
          ? rawPrice
          : '';

    const rawCheckout = productMetadata?.link_checkout ?? '';
    const upperCheckout = rawCheckout.toUpperCase();
    const isPlaceholder = 
        upperCheckout.includes('LINK DE CHECKOUT') || 
        upperCheckout.includes('LINK DO PRODUTO') ||
        upperCheckout.includes('LINK AQUI');

    if ((!rawCheckout || isPlaceholder) && logger) {
      logger.error({ 
        product_id, 
        team_id, 
        raw_link: rawCheckout 
      }, 'CRITICAL: Valid checkout link not found for product.');
    }

    const checkout_link =
      rawCheckout && !isPlaceholder
        ? rawCheckout
        : '';

    const description =
      (productMetadata as any)?.descricao ??
      (productMetadata as any)?.description ??
      '';

    const product = {
      name: productMetadata?.nome ?? '',
      price,
      checkout_link,
      description: description || undefined,
    };

    return {
      product,
      customer_status: customerStatus,
      rules,
      sales_strategy: salesStrategy,
    };
  },
});
