import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { embed } from 'ai';
import { openai } from '@ai-sdk/openai';
import { MODELS } from '../config/models';
import { searchProductRulesHybrid } from '../utils/supabase-hybrid-search';
import type { ProductRuleHybridResult } from '../../types/hybrid-search.types';

interface ProductRuleRow {
  metadata: { rules?: string[]; rule?: string; content?: string };
  embedding: number[];
}

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

const searchKnowledgeInputSchema = z.object({
  query: z.string(),
  product_id: z.string(),
  team_id: z.string(),
});

const searchKnowledgeOutputSchema = z.object({
  results: z.array(
    z.object({
      content: z.string(),
      score: z.number(),
    })
  ),
});

const generateEmbedding = async (text: string, logger?: any) => {
  const { embedding } = await embed({
    model: openai.embedding(MODELS.EMBEDDINGS),
    value: text,
  });

  if (!embedding) {
    throw new Error('Failed to generate embedding');
  }

  if (logger) {
    logger.info(`Generated embedding for knowledge search. Length: ${embedding.length}`);
  }

  return embedding;
};

export const search_knowledge_tool = createTool({
  id: 'search_knowledge',
  description: 'Searches product knowledge base/rules using vector similarity.',
  inputSchema: searchKnowledgeInputSchema,
  outputSchema: searchKnowledgeOutputSchema,
  execute: async (inputData, context) => {
    const { query, product_id, team_id } = inputData;
    const logger = context?.mastra?.logger;

    console.log(`\x1b[36m[SearchKnowledge]\x1b[0m Using hybrid search (vector + BM25) for product ${product_id}`);
    console.log(`\x1b[90m[RPC]\x1b[0m match_product_rules_hybrid - query: "${query.substring(0, 50)}..."`);

    if (logger) {
      logger.info(`[Supabase RPC] Searching knowledge for product ${product_id}, query: "${query}"`);
    }

    const embedding = await generateEmbedding(query, logger);

    try {
      const hybridResults = await searchProductRulesHybrid({
        queryEmbedding: embedding,
        queryText: query,
        teamId: team_id,
        productId: product_id,
        matchThreshold: 0.3,
        bm25Weight: 0.3,
        vectorWeight: 0.7,
        resultLimit: 10,
      }, { logger });

      if (hybridResults.length === 0) {
        if (logger) {
          logger.info('No relevant knowledge found above threshold 0.3');
        }
        return { results: [] };
      }

      // Convert hybrid results to expected format
      const results = hybridResults.slice(0, 5).map((result) => {
        // Extract text content from metadata
        let content = '';
        const meta = result.metadata || {};
        if (typeof meta.content === 'string') {
          content = meta.content;
        } else if (typeof meta.rule === 'string') {
          content = meta.rule;
        } else if (Array.isArray(meta.rules)) {
          content = meta.rules.join('\n');
        } else {
          content = JSON.stringify(meta);
        }

        return {
          content,
          score: result.combined_score,
        };
      });

      console.log(`\x1b[36m[SearchKnowledge]\x1b[0m Found ${results.length} relevant chunks using hybrid search`);

      if (logger) {
        logger.info(`Found ${results.length} relevant chunks above threshold 0.3.`);
        results.forEach((r, i) => {
          logger.info(`Result ${i + 1} (Score: ${r.score.toFixed(4)}): ${r.content.substring(0, 50)}...`);
        });
      }

      return { results };
    } catch (error: any) {
      console.error(`\x1b[31m[SearchKnowledge]\x1b[0m Hybrid search FAILED: ${error.message}`);
      if (logger) {
        logger.error(`[Supabase RPC] match_product_rules_hybrid failed - ${error.message}`);
      }
      throw error;
    }
  },
});

