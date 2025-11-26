import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { CohereClient } from 'cohere-ai';
import type { ProductMetadata } from '../../types/luvia.types';
import { searchProductsHybrid } from '../utils/supabase-hybrid-search';
import type { ProductHybridResult } from '../../types/hybrid-search.types';

interface ProductCandidate {
  product_id: string;
  metadata: ProductMetadata;
  similarity?: number;
}

interface CustomerEventRow {
  product_id: string;
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
let cohereClient: CohereClient | null = null;

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

const getCohereClient = () => {
  if (!cohereClient) {
    const apiKey = process.env.COHERE_API_KEY;

    if (!apiKey) {
      return null;
    }

    cohereClient = new CohereClient({ token: apiKey });
  }

  return cohereClient;
};

const advancedProductSearchInputSchema = z.object({
  message: z.string().min(1),
  team_id: z.string(),
  customer_phone: z.string().optional(),
});

const advancedProductSearchOutputSchema = z.object({
  best_match: z.object({
    product_id: z.string(),
    name: z.string(),
    score: z.number(),
  }),
  is_ambiguous: z.boolean(),
  needs_confirmation: z.boolean(),
});

const generateEmbedding = async (message: string, logger?: any) => {
  const openai = getOpenAIClient();

  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: message,
  });

  const embedding = response.data[0]?.embedding;

  if (!embedding) {
    throw new Error('Failed to generate embedding');
  }

  console.log(`\x1b[36m[AdvancedProductSearch]\x1b[0m Generated embedding: ${embedding.length} dimensions`);
  if (logger) {
    logger.info(`Generated embedding for message: "${message.substring(0, 50)}..." (Length: ${embedding.length})`);
  }

  return embedding;
};

/**
 * Fetch product candidates using hybrid search (vector + BM25)
 * This replaces the old client-side similarity calculation with server-side RPC
 */
const fetchProductCandidates = async (
  teamId: string,
  message: string,
  embedding: number[],
  logger?: any,
): Promise<ProductCandidate[]> => {
  const startTime = Date.now();

  console.log(`\x1b[36m[AdvancedProductSearch]\x1b[0m Using hybrid search (vector + BM25) for team=${teamId}`);
  console.log(`\x1b[90m[RPC]\x1b[0m match_products_hybrid - query: "${message.substring(0, 50)}..."`);
  if (logger) {
    logger.info(`[Supabase RPC] Executing: match_products_hybrid - team_id: ${teamId}`);
  }

  try {
    const results = await searchProductsHybrid({
      queryEmbedding: embedding,
      queryText: message,
      teamId,
      matchThreshold: 0.15,
      bm25Weight: 0.3,
      vectorWeight: 0.7,
      resultLimit: 20,
    }, { logger });

    const duration = Date.now() - startTime;

    if (results.length === 0) {
      console.log(`\x1b[33m[AdvancedProductSearch]\x1b[0m No products found for team=${teamId} | ${duration}ms`);
      if (logger) {
        logger.warn(`[Supabase RPC] No products found - team_id: ${teamId}, duration: ${duration}ms`);
      }
      return [];
    }

    console.log(`\x1b[36m[AdvancedProductSearch]\x1b[0m Hybrid search OK: ${results.length} results | ${duration}ms`);
    if (logger) {
      logger.info(`[Supabase RPC] Query completed: ${results.length} results, ${duration}ms`);
    }

    // Convert hybrid results to ProductCandidate format
    // Use combined_score from hybrid search as similarity
    const candidates: ProductCandidate[] = results.map((result) => ({
      product_id: result.product_id,
      metadata: result.metadata as ProductMetadata,
      similarity: result.combined_score,
    }));

    // Already sorted by combined_score from RPC, take top 10
    const topCandidates = candidates.slice(0, 10);

    if (logger) {
      logger.info(`Hybrid search identified top ${topCandidates.length} candidates.`);
      logger.info(`Top result: ${topCandidates[0]?.metadata?.nome || 'N/A'} (score: ${topCandidates[0]?.similarity?.toFixed(3) || 'N/A'}, vector: ${results[0]?.similarity?.toFixed(3)}, bm25: ${results[0]?.bm25_score?.toFixed(3)})`);
    }

    return topCandidates;
  } catch (error: any) {
    const duration = Date.now() - startTime;
    console.error(`\x1b[31m[AdvancedProductSearch]\x1b[0m Hybrid search FAILED: ${error.message} | ${duration}ms`);
    if (logger) {
      logger.error(`[Supabase RPC] match_products_hybrid failed - ${error.message}`);
    }
    throw error;
  }
};

const fetchRecentProductsForCustomer = async (teamId: string, customerPhone?: string, logger?: any) => {
  if (!customerPhone) {
    return new Set<string>();
  }

  const supabase = getSupabaseClient();
  const startTime = Date.now();

  const sql = `SELECT product_id FROM customer_events WHERE team_id = '${teamId}' AND customer_phone = '${customerPhone}'`;
  console.log(`\x1b[36m[AdvancedProductSearch]\x1b[0m Fetching ALL customer products for customer=${customerPhone}`);
  console.log(`\x1b[90m[SQL]\x1b[0m ${sql}`);
  if (logger) {
    logger.info(`[Supabase] Executing query: fetchAllProductsForCustomer - team_id: ${teamId}, customer_phone: ${customerPhone}`);
  }

  const { data, error } = await supabase
    .from('customer_events')
    .select('product_id')
    .eq('team_id', teamId)
    .eq('customer_phone', customerPhone);

  const duration = Date.now() - startTime;

  if (error) {
    console.error(`\x1b[31m[AdvancedProductSearch]\x1b[0m fetchRecentProducts FAILED: ${error.message}`);
    if (logger) {
      logger.error(`[Supabase] Query failed: fetchRecentProductsForCustomer - ${error.message}`);
    }
    throw error;
  }

  const rows = (data ?? []) as CustomerEventRow[];

  console.log(`\x1b[36m[AdvancedProductSearch]\x1b[0m fetchAllCustomerProducts OK: ${rows.length} events | ${duration}ms`);
  if (logger) {
    logger.info(`[Supabase] Query completed: fetchAllProductsForCustomer - ${rows.length} rows, ${duration}ms`);
  }

  return new Set(rows.map((row) => row.product_id));
};

const rerankCandidates = async (
  message: string,
  candidates: ProductCandidate[],
  recentProductIds: Set<string>,
  logger?: any
) => {
  if (candidates.length === 0) {
    console.error(`\x1b[31m[AdvancedProductSearch]\x1b[0m ERROR: No product candidates found for message: "${message.substring(0, 50)}..."`);
    if (logger) {
      logger.error(`No product candidates found for message: "${message.substring(0, 100)}..."`);
    }
    throw new Error('No product candidates found');
  }

  const useCohere = process.env.NODE_ENV === 'production';
  const cohere = useCohere ? getCohereClient() : null;

  if (logger) {
    logger.info(`Reranking strategy: ${useCohere ? 'Cohere (Production)' : 'Local Similarity (Development)'}`);
  }

  let scored = candidates.map((candidate) => ({
    candidate,
    score: candidate.similarity ?? 0,
  }));

  if (useCohere && cohere) {
    try {
      const documents = candidates.map((candidate) => {
        const metadata = candidate.metadata;
        const name = metadata.nome ?? '';
        const page = metadata.pagina_vendas ?? '';
        const price = typeof metadata.preco === 'number' ? formatPriceToBRL(metadata.preco) : '';

        return `${name} ${page} ${price}`.trim();
      });

      const rerankResponse = await cohere.rerank({
        query: message,
        documents,
      });

      scored = rerankResponse.results.map((result) => {
        const candidate = candidates[result.index];
        const baseScore = typeof result.relevanceScore === 'number' ? result.relevanceScore : 0;

        return {
          candidate,
          score: baseScore,
        };
      });
    } catch (err) {
      if (logger) {
        logger.error('Cohere reranking failed, falling back to similarity score', err);
      }
    }
  }

  const boosted = scored.map(({ candidate, score }) => {
    let finalScore = score;

    // Match usando product_id_plataforma da metadata (usado em customer_events)
    // Try both field names (produto_plataforma_id is the correct one in DB)
    const platformProductId = (candidate.metadata as any).produto_plataforma_id || candidate.metadata.product_id_plataforma;

    if (platformProductId && recentProductIds.has(platformProductId)) {
      finalScore += 0.15;
      if (logger) {
        logger.info(`Boosted score for customer's product: ${candidate.metadata.nome} (platform_id: ${platformProductId})`);
      }
    }

    return { candidate, score: finalScore };
  });

  boosted.sort((a, b) => b.score - a.score);

  // Log top 10 candidates to console
  console.log(`\x1b[33m[AdvancedProductSearch]\x1b[0m Top 10 Candidates:`);
  boosted.slice(0, 10).forEach((c, i) => {
    console.log(`  ${i + 1}. "${c.candidate.metadata.nome}" (score: ${c.score.toFixed(4)})`);
  });

  if (logger) {
    logger.info('Top 3 Candidates:');
    boosted.slice(0, 3).forEach((c, i) => {
      logger.info(`${i + 1}. ${c.candidate.metadata.nome} (Score: ${c.score.toFixed(4)})`);
    });
  }

  const [best, second] = boosted;
  const isAmbiguous = second ? best.score - second.score < 0.05 : false;
  const needsConfirmation = best.score < 0.9; // Threshold 0.9 might be high for raw cosine similarity, but good for reranker.

  return {
    best,
    isAmbiguous,
    needsConfirmation,
  };
};

export const advanced_product_search = createTool({
  id: 'advanced-product-search',
  description: 'Advanced product search using embeddings, customer context, and optional Cohere reranking.',
  inputSchema: advancedProductSearchInputSchema,
  outputSchema: advancedProductSearchOutputSchema,
  execute: async (inputData, context) => {
    const { message, team_id, customer_phone } = inputData;
    const logger = context?.mastra?.logger;

    console.log(`\x1b[36m[AdvancedProductSearch]\x1b[0m Starting search for team=${team_id}, message="${message.substring(0, 50)}..."`);
    if (logger) {
      logger.info(`Starting Advanced Product Search for Team: ${team_id}`);
    }

    try {
      const embedding = await generateEmbedding(message, logger);
      const candidates = await fetchProductCandidates(team_id, message, embedding, logger);
      const recentProductIds = await fetchRecentProductsForCustomer(team_id, customer_phone, logger);

      const { best, isAmbiguous, needsConfirmation } = await rerankCandidates(
        message,
        candidates,
        recentProductIds,
        logger
      );

      console.log(`\x1b[32m[AdvancedProductSearch]\x1b[0m Best match: "${best.candidate.metadata.nome}" (score: ${best.score.toFixed(4)})`);

      return {
        best_match: {
          product_id: best.candidate.product_id,
          name: best.candidate.metadata.nome,
          score: best.score,
        },
        is_ambiguous: isAmbiguous,
        needs_confirmation: needsConfirmation,
      };
    } catch (error: any) {
      console.error(`\x1b[31m[AdvancedProductSearch]\x1b[0m FAILED: ${error.message}`);
      if (logger) {
        logger.error(`Advanced Product Search failed - team_id: ${team_id}, message: "${message.substring(0, 100)}...", error: ${error.message}`);
      }
      throw error;
    }
  },
});
