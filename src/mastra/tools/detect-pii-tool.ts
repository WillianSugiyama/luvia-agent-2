import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

const detectPiiInputSchema = z.object({
  text: z.string().describe('Texto a ser analisado para detecção de PII'),
});

const detectPiiOutputSchema = z.object({
  has_pii: z.boolean(),
  findings: z.array(z.object({
    type: z.enum(['cpf', 'credit_card', 'email', 'phone', 'rg', 'bank_account']),
    value: z.string(),
    masked: z.string(),
    position: z.object({
      start: z.number(),
      end: z.number(),
    }),
  })),
  risk_score: z.number().min(0).max(100),
  sanitized_text: z.string(),
});

// Regex patterns para PII brasileiros
const PII_PATTERNS = {
  cpf: /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g,
  credit_card: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  phone: /\b(?:\+55\s?)?(?:\(?\d{2}\)?\s?)?(?:9\s?)?\d{4,5}[-\s]?\d{4}\b/g,
  rg: /\b\d{1,2}\.?\d{3}\.?\d{3}-?[0-9Xx]\b/g,
  bank_account: /\b(?:ag[êe]ncia|conta)[\s:]*\d{4,6}[-\s]?\d{0,2}\b/gi,
};

const maskValue = (value: string, type: string): string => {
  switch (type) {
    case 'cpf':
      return '***.***.***-**';
    case 'credit_card':
      return '**** **** **** ****';
    case 'email':
      const [local, domain] = value.split('@');
      return `${local[0]}***@${domain}`;
    case 'phone':
      return '(**) *****-****';
    case 'rg':
      return '**.***.***-*';
    case 'bank_account':
      return value.replace(/\d/g, '*');
    default:
      return '***';
  }
};

export const detect_pii_tool = createTool({
  id: 'detect_pii',
  description: 'Detecta informações pessoais sensíveis (PII) em texto como CPF, cartões de crédito, emails, telefones',
  inputSchema: detectPiiInputSchema,
  outputSchema: detectPiiOutputSchema,
  execute: async (inputData, context) => {
    const { text } = inputData;
    const logger = context?.mastra?.logger;

    const findings: Array<{
      type: 'cpf' | 'credit_card' | 'email' | 'phone' | 'rg' | 'bank_account';
      value: string;
      masked: string;
      position: { start: number; end: number };
    }> = [];

    let sanitizedText = text;

    // Detecta cada tipo de PII
    for (const [type, pattern] of Object.entries(PII_PATTERNS)) {
      const matches = text.matchAll(pattern);

      for (const match of matches) {
        if (match.index !== undefined) {
          const value = match[0];
          const masked = maskValue(value, type);

          findings.push({
            type: type as any,
            value,
            masked,
            position: {
              start: match.index,
              end: match.index + value.length,
            },
          });

          // Sanitiza o texto
          sanitizedText = sanitizedText.replace(value, masked);
        }
      }
    }

    // Calcula score de risco baseado nos findings
    const riskWeights = {
      cpf: 30,
      credit_card: 40,
      email: 10,
      phone: 10,
      rg: 25,
      bank_account: 35,
    };

    let riskScore = 0;
    for (const finding of findings) {
      riskScore += riskWeights[finding.type] || 10;
    }
    riskScore = Math.min(100, riskScore);

    if (logger && findings.length > 0) {
      logger.warn(`[PII Detection] Sensitive data found in text - count: ${findings.length}, types: ${findings.map(f => f.type).join(', ')}, risk: ${riskScore}`);
    }

    return {
      has_pii: findings.length > 0,
      findings,
      risk_score: riskScore,
      sanitized_text: sanitizedText,
    };
  },
});
