/**
 * Type definitions for hybrid search (vector + BM25)
 * Used with Supabase RPCs: match_products_hybrid and match_product_rules_hybrid
 */

export interface HybridSearchParams {
  queryEmbedding: number[];
  queryText: string;
  teamId: string;
  matchThreshold?: number;
  bm25Weight?: number;
  vectorWeight?: number;
  resultLimit?: number;
}

export interface ProductHybridResult {
  product_id: string;
  product_id_plataforma: string | null;
  source_text: string;
  metadata: Record<string, any>;
  similarity: number;
  bm25_score: number;
  combined_score: number;
}

export interface ProductRuleHybridResult {
  rule_id: string;
  source_text: string;
  metadata: Record<string, any>;
  similarity: number;
  bm25_score: number;
  combined_score: number;
}

export interface HybridSearchOptions {
  logger?: any;
}
