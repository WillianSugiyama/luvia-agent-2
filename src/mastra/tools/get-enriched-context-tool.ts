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
import { executeWithLogging } from '../utils/supabase-logger';
import { cosineSimilarity } from '../utils/vector-search';
import { searchProductRulesHybrid } from '../utils/supabase-hybrid-search';
import type { ProductRuleHybridResult } from '../../types/hybrid-search.types';

interface ProductEmbeddingRow {
  metadata: ProductMetadata;
}

interface ProductRuleRow {
  metadata: ProductRuleMetadata | { rules?: string[]; rule?: string };
}

interface CustomerEventRow {
  event_type: string;
}

/**
 * Formats price from cents to BRL currency format
 * @param priceInCents - Price in cents (e.g., 4788 = R$ 47,88)
 * @returns Formatted price string (e.g., "R$ 47,88")
 */
const formatPriceToBRL = (priceInCents: number): string => {
  const priceInReais = priceInCents / 100;
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(priceInReais);
};

let supabaseClient: SupabaseClient | null = null;
let openaiClient: OpenAI | null = null;
let qdrantClient: QdrantClient | null = null;

// Helper para logar queries do Supabase com detalhes
const logSupabaseQuery = async <T>(
  logger: any,
  queryName: string,
  table: string,
  filters: Record<string, any>,
  queryFn: () => any
): Promise<{ data: T | null; error: any }> => {
  return executeWithLogging<T>(
    queryName,
    table,
    filters,
    queryFn,
    logger,
    { alwaysLogToConsole: true }
  );
};

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
  product_id: z.string().optional(),
  product_name: z.string().optional(),
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
  // Multi-product support
  customer_purchased_products: z.array(z.string()),
  is_multi_product_customer: z.boolean(),
  active_product_ownership: z.enum(['APPROVED', 'REFUND', 'UNKNOWN']),
});

const fetchProductMetadata = async (
  teamId: string,
  productId: string,
  logger?: any,
): Promise<ProductMetadata | null> => {
  const supabase = getSupabaseClient();

  const { data, error } = await logSupabaseQuery<ProductEmbeddingRow>(
    logger,
    'fetchProductMetadata',
    'product_embeddings',
    { team_id: teamId, product_id: productId },
    () => supabase
      .from('product_embeddings')
      .select('metadata')
      .eq('team_id', teamId)
      .eq('product_id', productId)
      .maybeSingle<ProductEmbeddingRow>()
  );

  if (error) {
    throw error;
  }

  return data?.metadata ?? null;
};

interface ProductEmbeddingSearchRow {
  metadata: ProductMetadata;
  embedding: number[];
}

const searchProductMetadataByName = async (
  teamId: string,
  productName: string,
  logger?: any
): Promise<ProductMetadata | null> => {
  const supabase = getSupabaseClient();

  // 1. Generate embedding from product name
  const embedding = await generateIntentEmbedding(productName, logger);

  // 2. Fetch all product embeddings for this team
  const { data, error } = await logSupabaseQuery<ProductEmbeddingSearchRow[]>(
    logger,
    'searchProductMetadataByName',
    'product_embeddings',
    { team_id: teamId },
    () => supabase
      .from('product_embeddings')
      .select('metadata, embedding')
      .eq('team_id', teamId)
  );

  if (error) {
    throw error;
  }

  if (!data || data.length === 0) {
    if (logger) {
      logger.warn(`No products found for team_id: ${teamId}`);
    }
    return null;
  }

  // 3. Calculate similarity and find best match
  const scored = data.map((row) => {
    let similarity = 0;
    if (Array.isArray(row.embedding)) {
      try {
        similarity = cosineSimilarity(embedding, row.embedding);
      } catch (e) {
        // Ignore dimensionality mismatch
      }
    }
    return {
      metadata: row.metadata,
      score: similarity,
    };
  });

  // Sort by similarity and get top result
  scored.sort((a, b) => b.score - a.score);
  const topMatch = scored[0];

  if (logger) {
    logger.info(`Product search by name "${productName}" - Top match: ${topMatch?.metadata?.nome ?? 'N/A'} (score: ${topMatch?.score?.toFixed(4) ?? 0})`);
  }

  // Only return if similarity is above threshold (0.9 - high confidence required)
  if (topMatch && topMatch.score > 0.9) {
    return topMatch.metadata;
  }

  if (logger) {
    logger.warn(`No product found with sufficient similarity for "${productName}" (best score: ${topMatch?.score?.toFixed(4) ?? 0}, threshold: 0.9)`);
  }

  return null;
};

const fetchProductRules = async (
  teamId: string,
  productId: string,
  logger?: any
): Promise<string[]> => {
  const supabase = getSupabaseClient();

  const { data, error } = await logSupabaseQuery<ProductRuleRow[]>(
    logger,
    'fetchProductRules',
    'product_rule_embeddings',
    { team_id: teamId, product_id: productId },
    () => supabase
      .from('product_rule_embeddings')
      .select('metadata')
      .eq('team_id', teamId)
      .eq('product_id', productId)
  );

  if (error) {
    throw error;
  }

  if (logger && data && data.length > 0) {
    // Log the first item to debug structure
    logger.debug(`First Rule Row Payload: ${JSON.stringify(data[0])}`);
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

/**
 * Fetch product rules using hybrid search (vector + BM25)
 * This provides better relevance filtering compared to fetching all rules
 */
const fetchProductRulesHybrid = async (
  teamId: string,
  productId: string,
  queryText: string,
  queryEmbedding: number[],
  logger?: any
): Promise<string[]> => {
  console.log(`\x1b[36m[GetEnrichedContext]\x1b[0m Using hybrid search for product rules`);
  console.log(`\x1b[90m[RPC]\x1b[0m match_product_rules_hybrid - query: "${queryText.substring(0, 50)}..."`);

  if (logger) {
    logger.info(`[Supabase RPC] Executing: match_product_rules_hybrid - team_id: ${teamId}, product_id: ${productId}`);
  }

  try {
    const results = await searchProductRulesHybrid({
      queryEmbedding,
      queryText,
      teamId,
      productId,
      matchThreshold: 0.3,
      bm25Weight: 0.3,
      vectorWeight: 0.7,
      resultLimit: 30,
    }, { logger });

    if (logger) {
      logger.info(`[Supabase RPC] Hybrid rules search returned ${results.length} results`);
    }

    // Extract rules from metadata
    const rules: string[] = [];
    for (const result of results) {
      const meta = result.metadata as any;

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

    console.log(`\x1b[36m[GetEnrichedContext]\x1b[0m Extracted ${rules.length} relevant rules from hybrid search`);

    return rules;
  } catch (error: any) {
    console.error(`\x1b[31m[GetEnrichedContext]\x1b[0m Hybrid rules search FAILED: ${error.message}`);
    if (logger) {
      logger.error(`[Supabase RPC] match_product_rules_hybrid failed - ${error.message}`);
      logger.info('Falling back to fetchProductRules (all rules)');
    }

    // Fallback to old method if hybrid search fails
    return fetchProductRules(teamId, productId, logger);
  }
};

const fetchCustomerStatus = async (
  teamId: string,
  customerPhone: string,
  productId: string,
  logger?: any
): Promise<string> => {
  const supabase = getSupabaseClient();

  const { data, error } = await logSupabaseQuery<CustomerEventRow[]>(
    logger,
    'fetchCustomerStatus',
    'customer_events',
    { team_id: teamId, customer_phone: customerPhone, product_id: productId },
    () => supabase
      .from('customer_events')
      .select('event_type')
      .eq('team_id', teamId)
      .eq('customer_phone', customerPhone)
      .eq('product_id', productId)
      .order('created_at', { ascending: false })
      .limit(1)
  );

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as CustomerEventRow[];
  const latest = rows[0];

  return latest?.event_type ?? 'UNKNOWN';
};

const fetchCustomerPurchasedProducts = async (
  teamId: string,
  customerPhone: string,
  logger?: any
): Promise<string[]> => {
  if (!customerPhone) {
    return [];
  }

  const supabase = getSupabaseClient();

  const { data, error } = await logSupabaseQuery<CustomerEventRow[]>(
    logger,
    'fetchCustomerPurchasedProducts',
    'customer_events',
    { team_id: teamId, customer_phone: customerPhone, event_type: 'approved' },
    () => supabase
      .from('customer_events')
      .select('product_id, event_type')
      .eq('team_id', teamId)
      .eq('customer_phone', customerPhone)
      .in('event_type', ['approved', 'refund'])
      .order('created_at', { ascending: false })
  );

  if (error) {
    console.error(`\x1b[31m[GetEnrichedContext]\x1b[0m Error fetching purchased products: ${error.message}`);
    return [];
  }

  const rows = (data ?? []) as Array<{ product_id: string; event_type: string }>;

  // Get unique products (latest event per product)
  const productMap = new Map<string, string>();
  for (const row of rows) {
    if (!productMap.has(row.product_id)) {
      productMap.set(row.product_id, row.event_type);
    }
  }

  // Filter only approved (exclude refund)
  const approvedProducts = Array.from(productMap.entries())
    .filter(([_, eventType]) => eventType === 'approved')
    .map(([productId, _]) => productId);

  return approvedProducts;
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
    should_offer: true,
  };
};

const fetchSalesStrategy = async (userIntent: string, embedding: number[] | null, logger?: any) => {
  const qdrant = getQdrantClient();

  if (!qdrant) {
    if (logger) {
      logger.warn('Qdrant client not available, using fallback strategy.');
    }
    return buildFallbackSalesStrategy(userIntent, logger);
  }

  try {
    // If embedding not provided, generate it (fallback)
    const intentEmbedding = embedding ?? await generateIntentEmbedding(userIntent, logger);

    const results = await qdrant.search('sales_frameworks', {
      vector: intentEmbedding,
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
      logger.debug(`Sales Strategy Payload: ${JSON.stringify(output)}`);
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
  execute: async (inputData, context) => {
    const { product_id, product_name, team_id, customer_phone, user_intent } = inputData;
    const logger = context?.mastra?.logger;

    if (logger) {
      logger.info(`Enriching context for Product: ${product_id ?? product_name ?? 'N/A'}, Team: ${team_id}`);
    }

    // Determine product metadata based on available input
    let productMetadata: ProductMetadata | null = null;

    if (product_id) {
      // Use direct ID lookup
      productMetadata = await fetchProductMetadata(team_id, product_id, logger);
    } else if (product_name) {
      // Use vector similarity search by name
      productMetadata = await searchProductMetadataByName(team_id, product_name, logger);
    }

    // Fetch other data in parallel (using product_id if available, otherwise skip product-specific queries)
    const resolvedProductId = product_id ?? '';
    // Try both field names (produto_plataforma_id is the correct one in DB)
    const platformProductId = (productMetadata as any)?.produto_plataforma_id || productMetadata?.product_id_plataforma || '';

    if (logger && platformProductId) {
      logger.info(`Using platform_product_id for customer_events lookup: ${platformProductId}`);
    }

    // Generate intent embedding for hybrid rules search
    const intentEmbedding = resolvedProductId ? await generateIntentEmbedding(user_intent, logger) : null;

    const [rules, customerStatus, salesStrategy, purchasedProducts] = await Promise.all([
      resolvedProductId && intentEmbedding
        ? fetchProductRulesHybrid(team_id, resolvedProductId, user_intent, intentEmbedding, logger)
        : resolvedProductId
          ? fetchProductRules(team_id, resolvedProductId, logger)
          : Promise.resolve([]),
      platformProductId ? fetchCustomerStatus(team_id, customer_phone, platformProductId, logger) : Promise.resolve('UNKNOWN'),
      fetchSalesStrategy(user_intent, intentEmbedding, logger),
      fetchCustomerPurchasedProducts(team_id, customer_phone, logger),
    ]);

    if (logger) {
      logger.info(`Fetched ${rules.length} rules, Customer Status: ${customerStatus}, Purchased Products: ${purchasedProducts.length}`);
    }

    // Determine ownership of current product (using platform_product_id)
    const activeProductOwnership = platformProductId && purchasedProducts.includes(platformProductId)
      ? (customerStatus === 'refund' ? 'REFUND' : 'APPROVED')
      : 'UNKNOWN';

    const rawPrice = productMetadata?.preco;
    const price =
      typeof rawPrice === 'number'
        ? formatPriceToBRL(rawPrice) // Format from cents to BRL (e.g., 4788 → R$ 47,88)
        : typeof rawPrice === 'string'
          ? rawPrice // Already formatted string, use as-is
          : '';

    const rawCheckout = productMetadata?.link_checkout ?? '';
    const upperCheckout = rawCheckout.toUpperCase();
    const isPlaceholder = 
        upperCheckout.includes('LINK DE CHECKOUT') || 
        upperCheckout.includes('LINK DO PRODUTO') ||
        upperCheckout.includes('LINK AQUI');

    if ((!rawCheckout || isPlaceholder) && logger) {
      logger.error(`CRITICAL: Valid checkout link not found for product - product_id: ${product_id ?? 'N/A'}, product_name: ${product_name ?? 'N/A'}, team_id: ${team_id}, raw_link: ${rawCheckout}`);
    }

    const checkout_link =
      rawCheckout && !isPlaceholder
        ? rawCheckout
        : '';

    const description =
      (productMetadata as any)?.descricao ??
      (productMetadata as any)?.description ??
      '';

    // Debug logging for product data
    const productName = productMetadata?.nome ?? '';
    if (!productName) {
      console.warn(`\x1b[33m[GetEnrichedContext]\x1b[0m ⚠️ Product name is empty! product_id: ${product_id}, product_name input: ${product_name}`);
      console.warn(`\x1b[33m[GetEnrichedContext]\x1b[0m productMetadata:`, productMetadata);
    } else {
      console.log(`\x1b[36m[GetEnrichedContext]\x1b[0m Product: "${productName}", Price: ${price}`);
    }

    const product = {
      name: productName,
      price,
      checkout_link,
      description: description || undefined,
    };

    return {
      product,
      customer_status: customerStatus,
      rules,
      sales_strategy: salesStrategy,
      customer_purchased_products: purchasedProducts,
      is_multi_product_customer: purchasedProducts.length > 1,
      active_product_ownership: activeProductOwnership as 'APPROVED' | 'REFUND' | 'UNKNOWN',
    };
  },
});
