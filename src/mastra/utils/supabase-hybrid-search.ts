/**
 * Utility functions for hybrid search (vector + BM25) using Supabase RPCs
 *
 * These functions call the following Supabase RPCs:
 * - match_products_hybrid: Hybrid search for products
 * - match_product_rules_hybrid: Hybrid search for product rules
 *
 * Both RPCs combine vector similarity (HNSW index) with BM25 full-text search
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type {
  HybridSearchParams,
  ProductHybridResult,
  ProductRuleHybridResult,
  HybridSearchOptions,
} from '../../types/hybrid-search.types';

let supabaseClient: SupabaseClient | null = null;

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

/**
 * Converts embedding array to text format expected by Supabase RPCs
 * Example: [0.1, 0.2, 0.3] => "[0.1,0.2,0.3]"
 */
export const embeddingToText = (embedding: number[]): string => {
  return `[${embedding.join(',')}]`;
};

/**
 * Hybrid search for products using match_products_hybrid RPC
 *
 * @param params - Search parameters
 * @param options - Optional logger for debugging
 * @returns Array of product results with combined scores
 */
export const searchProductsHybrid = async (
  params: HybridSearchParams,
  options?: HybridSearchOptions
): Promise<ProductHybridResult[]> => {
  const {
    queryEmbedding,
    queryText,
    teamId,
    matchThreshold = 0.15,
    bm25Weight = 0.3,
    vectorWeight = 0.7,
    resultLimit = 20,
  } = params;

  const supabase = getSupabaseClient();
  const embeddingText = embeddingToText(queryEmbedding);

  if (options?.logger) {
    options.logger.info('searchProductsHybrid called', {
      queryText,
      teamId,
      matchThreshold,
      bm25Weight,
      vectorWeight,
      resultLimit,
    });
  }

  const { data, error } = await supabase.rpc('match_products_hybrid', {
    query_embedding: embeddingText,
    query_text: queryText,
    team_id_filter: teamId,
    match_threshold: matchThreshold,
    bm25_weight: bm25Weight,
    vector_weight: vectorWeight,
    result_limit: resultLimit,
  });

  if (error) {
    if (options?.logger) {
      options.logger.error('searchProductsHybrid error', { error });
    }
    throw new Error(`Hybrid product search failed: ${error.message}`);
  }

  if (options?.logger) {
    options.logger.info('searchProductsHybrid results', {
      count: data?.length ?? 0,
    });
  }

  return (data ?? []) as ProductHybridResult[];
};

/**
 * Hybrid search for product rules using match_product_rules_hybrid RPC
 *
 * @param params - Search parameters (includes productId)
 * @param options - Optional logger for debugging
 * @returns Array of product rule results with combined scores
 */
export const searchProductRulesHybrid = async (
  params: HybridSearchParams & { productId: string },
  options?: HybridSearchOptions
): Promise<ProductRuleHybridResult[]> => {
  const {
    queryEmbedding,
    queryText,
    teamId,
    productId,
    matchThreshold = 0.3,
    bm25Weight = 0.3,
    vectorWeight = 0.7,
    resultLimit = 30,
  } = params;

  const supabase = getSupabaseClient();
  const embeddingText = embeddingToText(queryEmbedding);

  if (options?.logger) {
    options.logger.info('searchProductRulesHybrid called', {
      queryText,
      teamId,
      productId,
      matchThreshold,
      bm25Weight,
      vectorWeight,
      resultLimit,
    });
  }

  const { data, error } = await supabase.rpc('match_product_rules_hybrid', {
    query_embedding: embeddingText,
    query_text: queryText,
    team_id_filter: teamId,
    product_id_filter: productId,
    match_threshold: matchThreshold,
    bm25_weight: bm25Weight,
    vector_weight: vectorWeight,
    result_limit: resultLimit,
  });

  if (error) {
    if (options?.logger) {
      options.logger.error('searchProductRulesHybrid error', { error });
    }
    throw new Error(`Hybrid rules search failed: ${error.message}`);
  }

  if (options?.logger) {
    options.logger.info('searchProductRulesHybrid results', {
      count: data?.length ?? 0,
    });
  }

  return (data ?? []) as ProductRuleHybridResult[];
};
