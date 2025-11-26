import { openai } from '@ai-sdk/openai';

/**
 * Configuração centralizada de modelos LLM
 * Permite troca rápida de modelos em todo o sistema
 */
export const MODELS = {
  // Modelo principal para agentes e ferramentas
  MAIN: openai('gpt-5-mini'),

  // String de modelo para agentes Mastra (formato: 'provider/model')
  AGENT_MODEL_STRING: 'openai/gpt-5',

  // Modelo para embeddings
  EMBEDDINGS: 'text-embedding-3-small',
} as const;

/**
 * Configurações específicas por caso de uso
 */
export const MODEL_CONFIGS = {
  // Classificação de intenção: output determinístico e rápido
  INTENT_CLASSIFICATION: {
    model: MODELS.MAIN,
    temperature: 0,
    maxTokens: 500,
  },

  // Validação de promessas: output determinístico e preciso
  VALIDATION: {
    model: MODELS.MAIN,
    temperature: 0,
    maxTokens: 1000,
  },

  // Agentes conversacionais: output natural e criativo
  CONVERSATIONAL: {
    model: MODELS.MAIN,
    temperature: 0.7,
    maxTokens: 2000,
  },
} as const;
