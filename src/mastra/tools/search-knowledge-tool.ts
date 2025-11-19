import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { cosineSimilarity } from '../utils/vector-search';

interface ProductRuleRow {
  metadata: { rules?: string[]; rule?: string; content?: string };
  embedding: number[];
}

let supabaseClient: SupabaseClient | null = null;
let openaiClient: OpenAI | null = null;

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
  const openai = getOpenAIClient();

  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  });

  const embedding = response.data[0]?.embedding;

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
  execute: async ({ context, mastra }) => {
    const { query, product_id, team_id } = context;
    const logger = mastra?.logger;

    if (logger) {
      logger.info(`Searching knowledge for product ${product_id}, query: "${query}"`);
    }

    const embedding = await generateEmbedding(query, logger);
    const supabase = getSupabaseClient();

    // Fetch all rules/embeddings for this product
    const { data, error } = await supabase
      .from('product_rule_embeddings')
      .select('metadata, embedding')
      .eq('team_id', team_id)
      .eq('product_id', product_id);

    if (error) {
      if (logger) {
        logger.error('Error fetching product rules', error);
      }
      throw error;
    }

    if (!data || data.length === 0) {
      if (logger) {
        logger.info('No knowledge found for this product.');
      }
      return { results: [] };
    }

    if (logger) {
      logger.info(`Fetched ${data.length} knowledge chunks. Calculating similarity...`);
    }

    const scored = (data as any[]).map((row: any) => {
      let similarity = 0;
      // Ensure embedding exists and is array
      if (Array.isArray(row.embedding)) {
        try {
          similarity = cosineSimilarity(embedding, row.embedding);
        } catch (e) {
          // ignore mismatch
        }
      }

      // Extract text content from metadata
      // The metadata might have 'rule', 'rules' array, or 'content'
      let content = '';
      const meta = row.metadata || {};
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
        score: similarity,
      };
    });

    scored.sort((a, b) => b.score - a.score);

    // Filter for relevance (e.g. > 0.3) and take top 5
    const results = scored.filter((r) => r.score > 0.3).slice(0, 5);

    if (logger) {
      logger.info(`Found ${results.length} relevant chunks above threshold 0.3.`);
      results.forEach((r, i) => {
        logger.info(`Result ${i + 1} (Score: ${r.score.toFixed(4)}): ${r.content.substring(0, 50)}...`);
      });
    }

    return { results };
  },
});

