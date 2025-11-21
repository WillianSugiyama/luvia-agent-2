import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import OpenAI from 'openai';

interface ValidationResult {
  valid: boolean;
  reason: string;
  missing_link: boolean;
}

let openaiClient: OpenAI | null = null;

const getOpenAIClient = () => {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return null;
    }

    openaiClient = new OpenAI({ apiKey });
  }

  return openaiClient;
};

export const validateAgentOutputInputSchema = z.object({
  original_query: z.string(),
  agent_response: z.string(),
  required_link: z.string().optional().nullable(),
});

export const validateAgentOutputOutputSchema = z.object({
  valid: z.boolean(),
  reason: z.string(),
  missing_link: z.boolean(),
  corrected_response: z.string(),
});

const runLocalValidationFallback = (
  originalQuery: string,
  agentResponse: string,
  requiredLink?: string | null,
): ValidationResult => {
  const trimmedQuery = originalQuery.trim();
  const trimmedResponse = agentResponse.trim();
  const link = requiredLink?.trim();

  const missingLink = !!link && !trimmedResponse.includes(link);

  // Very basic sanity check: response must not be empty and should share at least one word with the query
  const queryTokens = trimmedQuery.toLowerCase().split(/\s+/);
  const responseTokens = trimmedResponse.toLowerCase().split(/\s+/);
  const overlap = queryTokens.some((token) => token.length > 3 && responseTokens.includes(token));

  const valid = !missingLink && overlap && trimmedResponse.length > 0;

  const reason = valid
    ? 'Validação local simples: resposta consistente e link presente (se aplicável).'
    : 'Validação local simples: possível inconsistência com a query ou link ausente.';

  return {
    valid,
    reason,
    missing_link: missingLink,
  };
};

const runLLMValidation = async (
  originalQuery: string,
  agentResponse: string,
  requiredLink?: string | null,
): Promise<ValidationResult> => {
  const client = getOpenAIClient();

  if (!client) {
    return runLocalValidationFallback(originalQuery, agentResponse, requiredLink);
  }

  const linkPlaceholder = requiredLink && requiredLink.trim().length > 0
    ? requiredLink.trim()
    : 'N/A';

  const prompt = `
Analise a RESPOSTA gerada para a QUERY do usuário.

QUERY:
${originalQuery}

RESPOSTA:
${agentResponse}

Checklist:
1. A resposta faz sentido com a query? (Sim/Não)
2. O link ${linkPlaceholder} está presente na resposta? (Sim/Não/Não Aplicável)
3. A resposta viola alguma regra de segurança óbvia?

Retorne JSON: { "valid": boolean, "reason": string, "missing_link": boolean }
`.trim();

  try {
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      response_format: { type: 'json_object' },
    });

    const content = completion.choices[0]?.message?.content?.trim();

    if (!content) {
      return runLocalValidationFallback(originalQuery, agentResponse, requiredLink);
    }

    let parsed: any;

    try {
      parsed = JSON.parse(content);
    } catch {
      // Try to extract the last JSON object if the model wrapped it in text
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return runLocalValidationFallback(originalQuery, agentResponse, requiredLink);
      }
      parsed = JSON.parse(jsonMatch[0]);
    }

    const valid = typeof parsed.valid === 'boolean' ? parsed.valid : false;
    const reason = typeof parsed.reason === 'string' ? parsed.reason : '';
    const missingLink =
      typeof parsed.missing_link === 'boolean' ? parsed.missing_link : false;

    return {
      valid,
      reason: reason || 'Validação via LLM concluída.',
      missing_link: missingLink,
    };
  } catch {
    return runLocalValidationFallback(originalQuery, agentResponse, requiredLink);
  }
};

export const validate_agent_output = createStep({
  id: 'validate_agent_output',
  description:
    'Validates the agent response against the original query and required checkout link, applying auto-corrections when possible.',
  inputSchema: validateAgentOutputInputSchema,
  outputSchema: validateAgentOutputOutputSchema,
  execute: async ({ inputData, mastra }) => {
    if (!inputData) {
      throw new Error('Input data not found for validate_agent_output step');
    }

    const { original_query, agent_response, required_link } = inputData;

    const validation = await runLLMValidation(
      original_query,
      agent_response,
      required_link,
    );

    const link = required_link?.trim();
    let finalResponse = agent_response;
    let { valid, missing_link, reason } = validation;

    // Auto-correction: ensure required link is present when flagged as missing
    if (missing_link && link) {
      const alreadyPresent = finalResponse.includes(link);

      if (!alreadyPresent) {
        finalResponse = `${finalResponse.trim()}\n\nAqui está o link: ${link}`;
      }

      valid = true;
      missing_link = false;
      if (!reason) {
        reason = 'Link ausente foi corrigido automaticamente.';
      }
    }

    // If still invalid after link correction, attempt a graceful fallback
    if (!valid) {
      try {
        const dontKnowAgent = mastra.getAgent('dont_know_agent' as any);

        const result = await dontKnowAgent.generate(
          [
            {
              role: 'user',
              content: `Não foi possível validar a resposta anterior para a seguinte pergunta do usuário. Forneça uma resposta segura dizendo que não sabe a resposta com confiança, sem inventar detalhes.\n\nQUERY:\n${original_query}`,
            },
          ],
        );

        const safeText = result.text ?? '';

        if (safeText.trim()) {
          finalResponse = safeText.trim();
          valid = true;
          reason =
            reason ||
            'Resposta original considerada alucinatória; substituída por saída do dont_know_agent.';
        }
      } catch {
        // If dont_know_agent is not configured, keep the original validation result
      }
    }

    return {
      valid,
      reason,
      missing_link,
      corrected_response: finalResponse,
    };
  },
});
