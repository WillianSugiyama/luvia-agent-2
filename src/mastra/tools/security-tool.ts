import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

const RATE_LIMIT_WINDOW_MS = 10_000;
const RATE_LIMIT_MAX_REQUESTS = 5;

const rateLimitStore = new Map<string, number[]>();

export class RateLimitError extends Error {
  constructor(message = 'Rate limit exceeded') {
    super(message);
    this.name = 'RateLimitError';
  }
}

export class SecurityError extends Error {
  constructor(message = 'Security policy violation') {
    super(message);
    this.name = 'SecurityError';
  }
}

const securityInputSchema = z.object({
  team_id: z.string(),
  phone: z.string().optional(),
  message: z.string().max(1000),
});

const securityOutputSchema = z.object({
  is_safe: z.boolean(),
  sanitized_message: z.string(),
});

const checkRateLimit = (key: string) => {
  const now = Date.now();
  const timestamps = rateLimitStore.get(key) ?? [];
  const recent = timestamps.filter((timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS);

  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) {
    throw new RateLimitError();
  }

  recent.push(now);
  rateLimitStore.set(key, recent);
};

const hasPromptInjection = (message: string) => {
  const lower = message.toLowerCase();
  const patterns = ['ignore previous instructions', 'system prompt', 'dan mode'];

  return patterns.some((pattern) => lower.includes(pattern));
};

const sanitizePhone = (phone?: string) => {
  if (!phone) {
    return phone;
  }

  const digitsOnly = phone.replace(/\D/g, '');

  if (!digitsOnly) {
    throw new SecurityError('Invalid phone number');
  }

  return digitsOnly;
};

export const validate_security_layer = createTool({
  id: 'validate-security-layer',
  description:
    'Applies initial security guardrails: rate limiting, prompt injection detection, and phone sanitization.',
  inputSchema: securityInputSchema,
  outputSchema: securityOutputSchema,
  execute: async (inputData) => {
    const parsed = securityInputSchema.safeParse(inputData);

    if (!parsed.success) {
      throw new SecurityError('Invalid input schema');
    }

    const { team_id, phone, message } = parsed.data;

    const rateLimitKey = phone ?? `team:${team_id}`;
    checkRateLimit(rateLimitKey);

    if (hasPromptInjection(message)) {
      throw new SecurityError('Prompt injection detected');
    }

    sanitizePhone(phone);
    const sanitizedMessage = message.trim();

    return {
      is_safe: true,
      sanitized_message: sanitizedMessage,
    };
  },
});
