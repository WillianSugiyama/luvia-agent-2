import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { CohereClient } from 'cohere-ai';
import type { ProductMetadata } from '../../types/luvia.types';
import { cosineSimilarity } from '../utils/vector-search';

interface ProductCandidate {
  product_id: string;
  metadata: ProductMetadata;
  similarity?: number;
}

interface CustomerEventRow {
  product_id: string;
}

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

  if (logger) {
    logger.info(`Generated embedding for message: "${message.substring(0, 50)}..." (Length: ${embedding.length})`);
  }

  return embedding;
};

const fetchProductCandidates = async (
  teamId: string,
  embedding: number[],
  logger?: any,
): Promise<ProductCandidate[]> => {
  const supabase = getSupabaseClient();

  // Preferred path: use RPC if available
  const { data, error } = await supabase.rpc('match_product_embeddings', {
    query_embedding: embedding,
    team_id: teamId,
    match_count: 10,
  });

  if (!error && data) {
    if (logger) {
      logger.info(`RPC match_product_embeddings returned ${data.length} candidates.`);
    }
    return (data as any[]).map((row) => ({
      product_id: row.product_id as string,
      metadata: row.metadata as ProductMetadata,
      similarity: typeof row.similarity === 'number' ? row.similarity : undefined,
    }));
  }

  if (logger && error) {
    logger.warn(`RPC failed or missing: ${error.message}. Falling back to client-side vector search.`);
  }

  // Fallback: Client-Side Vector Search
  // Fetch all products with embeddings for this team
  const { data: fallbackData, error: fallbackError } = await supabase
    .from('product_embeddings')
    .select('product_id, metadata, embedding')
    .eq('team_id', teamId);

  if (fallbackError) {
    throw fallbackError;
  }

  if (!fallbackData) {
    return [];
  }

  if (logger) {
    logger.info(`Fetched ${fallbackData.length} products for client-side scoring.`);
  }

  // Calculate similarity locally
  const scoredCandidates = fallbackData
    .map((row: any) => {
      let similarity = 0;
      if (Array.isArray(row.embedding)) {
        try {
          similarity = cosineSimilarity(embedding, row.embedding);
        } catch (e) {
          // Ignore dimensionality mismatch errors
        }
      }
      return {
        product_id: row.product_id,
        metadata: row.metadata,
        similarity,
      };
    })
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 10); // Keep top 10

  if (logger) {
    logger.info(`Client-side search identified top ${scoredCandidates.length} candidates.`);
  }

  return scoredCandidates;
};

const fetchRecentProductsForCustomer = async (teamId: string, customerPhone?: string) => {
  if (!customerPhone) {
    return new Set<string>();
  }

  const supabase = getSupabaseClient();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('customer_events')
    .select('product_id')
    .eq('team_id', teamId)
    .eq('customer_phone', customerPhone)
    .gt('created_at', sevenDaysAgo);

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as CustomerEventRow[];
  return new Set(rows.map((row) => row.product_id));
};

const rerankCandidates = async (
  message: string,
  candidates: ProductCandidate[],
  recentProductIds: Set<string>,
  logger?: any
) => {
  if (candidates.length === 0) {
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
        const price = typeof metadata.preco === 'number' ? `R$ ${metadata.preco}` : '';

        return `${name} ${page} ${price}`.trim();
      });

      const rerankResponse = await cohere.rerank({
        query: message,
        documents,
      });

      scored = rerankResponse.results.map((result) => {
        const candidate = candidates[result.index];
        const baseScore = typeof result.relevance_score === 'number' ? result.relevance_score : 0;

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

    if (recentProductIds.has(candidate.product_id)) {
      finalScore += 0.15;
      if (logger) {
        logger.info(`Boosted score for recently viewed product: ${candidate.metadata.nome}`);
      }
    }

    return { candidate, score: finalScore };
  });

  boosted.sort((a, b) => b.score - a.score);

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
  execute: async ({ context, mastra }) => {
    const { message, team_id, customer_phone } = context;
    const logger = mastra?.logger;

    if (logger) {
      logger.info(`Starting Advanced Product Search for Team: ${team_id}`);
    }

    const embedding = await generateEmbedding(message, logger);
    const candidates = await fetchProductCandidates(team_id, embedding, logger);
    const recentProductIds = await fetchRecentProductsForCustomer(team_id, customer_phone);

    const { best, isAmbiguous, needsConfirmation } = await rerankCandidates(
      message,
      candidates,
      recentProductIds,
      logger
    );

    return {
      best_match: {
        product_id: best.candidate.product_id,
        name: best.candidate.metadata.nome,
        score: best.score,
      },
      is_ambiguous: isAmbiguous,
      needs_confirmation: needsConfirmation,
    };
  },
});
