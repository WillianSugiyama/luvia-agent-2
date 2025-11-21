import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { executeWithLogging } from '../utils/supabase-logger';

let supabaseClient: SupabaseClient | null = null;
let openaiClient: OpenAI | null = null;

const getSupabaseClient = () => {
  if (!supabaseClient) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_KEY;
    if (!url || !key) throw new Error('Supabase credentials not configured');
    supabaseClient = createClient(url, key);
  }
  return supabaseClient;
};

const getOpenAIClient = () => {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY not configured');
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
};

const validatePromisesInputSchema = z.object({
  response_text: z.string().describe('Texto da resposta a ser validado'),
  team_id: z.string().describe('ID do time'),
  product_id: z.string().describe('ID do produto'),
});

const validatePromisesOutputSchema = z.object({
  is_valid: z.boolean(),
  unauthorized_promises: z.array(z.object({
    promise_text: z.string(),
    reason: z.string(),
    severity: z.enum(['critical', 'high', 'medium', 'low']),
  })),
  authorized_rules_used: z.array(z.string()),
  confidence_score: z.number().min(0).max(100),
});

// Padrões comuns de promessas
const PROMISE_PATTERNS = [
  /garant(?:ia|imos|ido)/gi,
  /desconto\s+de?\s*\d+%?/gi,
  /parcel(?:a|amento)\s+(?:em|de)?\s*\d+x?/gi,
  /prazo\s+de?\s*\d+\s*dias?/gi,
  /devolu[çc][ãa]o\s+(?:em|de)?\s*\d+\s*dias?/gi,
  /reembolso\s+(?:total|integral|em\s+\d+)/gi,
  /b[ôo]nus\s+(?:de|exclusivo)?/gi,
  /gr[áa]tis|gratuito/gi,
  /100%\s+(?:garantido|seguro)/gi,
  /sem\s+(?:risco|custo)/gi,
  /oferta\s+(?:especial|limitada|exclusiva)/gi,
  /pre[çc]o\s+(?:promocional|especial)/gi,
];

export const validate_promises_tool = createTool({
  id: 'validate_promises',
  description: 'Valida se as promessas na resposta estão autorizadas pelas regras do produto no Supabase',
  inputSchema: validatePromisesInputSchema,
  outputSchema: validatePromisesOutputSchema,
  execute: async (inputData, context) => {
    const { response_text, team_id, product_id } = inputData;
    const logger = context?.mastra?.logger;
    const supabase = getSupabaseClient();

    // 1. Buscar regras autorizadas do produto
    const { data: rulesData, error } = await executeWithLogging<any[]>(
      'validatePromises_fetchRules',
      'product_rule_embeddings',
      { team_id, product_id },
      async () => await supabase
        .from('product_rule_embeddings')
        .select('metadata, source_text')
        .eq('team_id', team_id)
        .eq('product_id', product_id),
      logger,
      { alwaysLogToConsole: true }
    );

    if (error) {
      throw error;
    }

    // Extrair regras dos metadados
    const authorizedRules: string[] = [];
    for (const row of rulesData ?? []) {
      const meta = row.metadata as any;

      if (Array.isArray(meta?.rules)) {
        authorizedRules.push(...meta.rules.filter((r: any) => typeof r === 'string'));
      } else if (typeof meta?.rule === 'string') {
        authorizedRules.push(meta.rule);
      }

      if (row.source_text) {
        authorizedRules.push(row.source_text);
      }
    }

    // Log sempre no console
    console.log(`\x1b[36m[ValidatePromises]\x1b[0m Fetched ${authorizedRules.length} authorized rules for team=${team_id}, product=${product_id}`);

    if (logger) {
      logger.info(`[ValidatePromises] Fetched authorized rules - team_id: ${team_id}, product_id: ${product_id}, rules_count: ${authorizedRules.length}`);
    }

    // 2. Extrair promessas da resposta
    const foundPromises: string[] = [];
    for (const pattern of PROMISE_PATTERNS) {
      const matches = response_text.match(pattern);
      if (matches) {
        foundPromises.push(...matches);
      }
    }

    if (foundPromises.length === 0) {
      return {
        is_valid: true,
        unauthorized_promises: [],
        authorized_rules_used: [],
        confidence_score: 100,
      };
    }

    // 3. Usar LLM para validar promessas contra regras
    const openai = getOpenAIClient();

    const validationPrompt = `
Analise as seguintes promessas encontradas em uma resposta de atendimento e verifique se estão autorizadas pelas regras do produto.

PROMESSAS ENCONTRADAS NA RESPOSTA:
${foundPromises.map((p, i) => `${i + 1}. "${p}"`).join('\n')}

REGRAS AUTORIZADAS DO PRODUTO:
${authorizedRules.length > 0 ? authorizedRules.map((r, i) => `${i + 1}. ${r}`).join('\n') : 'Nenhuma regra específica cadastrada'}

Para cada promessa, determine:
1. Se está explicitamente autorizada pelas regras
2. Se contradiz alguma regra
3. Se é uma promessa que não deveria ser feita sem autorização

Responda em JSON:
{
  "unauthorized": [
    {
      "promise": "texto da promessa",
      "reason": "por que não está autorizada",
      "severity": "critical|high|medium|low"
    }
  ],
  "authorized_rules_matched": ["regras que autorizam promessas válidas"],
  "confidence": 0-100
}

Critérios de severidade:
- critical: Promessa financeira falsa (desconto inexistente, preço errado)
- high: Garantias ou prazos diferentes dos autorizados
- medium: Promessas vagas que podem causar expectativa errada
- low: Linguagem promocional genérica

Responda APENAS com o JSON.
    `.trim();

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: validationPrompt }],
      temperature: 0,
      response_format: { type: 'json_object' },
    });

    const result = JSON.parse(completion.choices[0]?.message?.content || '{}');

    const unauthorizedPromises = (result.unauthorized || []).map((u: any) => ({
      promise_text: u.promise || '',
      reason: u.reason || 'Não autorizada pelas regras',
      severity: u.severity || 'medium',
    }));

    if (logger && unauthorizedPromises.length > 0) {
      logger.warn(`[ValidatePromises] Unauthorized promises detected - count: ${unauthorizedPromises.length}, promises: ${unauthorizedPromises.map((p: any) => p.promise_text).join(', ')}`);
    }

    return {
      is_valid: unauthorizedPromises.length === 0,
      unauthorized_promises: unauthorizedPromises,
      authorized_rules_used: result.authorized_rules_matched || [],
      confidence_score: result.confidence || 50,
    };
  },
});
