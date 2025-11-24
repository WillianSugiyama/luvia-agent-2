import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import OpenAI from 'openai';

let openaiClient: OpenAI | null = null;

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

const multiProductClarificationInputSchema = z.object({
  purchased_products: z.array(
    z.object({
      product_id: z.string(),
      product_name: z.string(),
      purchase_date: z.string(),
      event_type: z.enum(['APPROVED', 'REFUND']),
    })
  ),
  user_message: z.string(),
});

const multiProductClarificationOutputSchema = z.object({
  needs_clarification: z.boolean(),
  clarification_message: z.string().optional(),
  identified_product_id: z.string().optional(),
});

export const multi_product_clarification = createTool({
  id: 'multi-product-clarification',
  description: 'Determines if a user message is ambiguous when customer owns multiple products, and generates clarification prompt',
  inputSchema: multiProductClarificationInputSchema,
  outputSchema: multiProductClarificationOutputSchema,
  execute: async (inputData, context) => {
    const { purchased_products, user_message } = inputData;
    const logger = context?.mastra?.logger;

    if (purchased_products.length === 0) {
      return {
        needs_clarification: false,
      };
    }

    if (purchased_products.length === 1) {
      console.log(`\x1b[36m[MultiProductClarification]\x1b[0m Single product only, no clarification needed`);
      return {
        needs_clarification: false,
        identified_product_id: purchased_products[0].product_id,
      };
    }

    console.log(`\x1b[36m[MultiProductClarification]\x1b[0m Analyzing message for ${purchased_products.length} products`);

    // Use LLM to detect if message explicitly mentions a product name
    const client = getOpenAIClient();

    const productNames = purchased_products.map((p) => p.product_name);

    const system = `
Você é um analisador de mensagens de clientes que possuem múltiplos produtos.

Sua tarefa é determinar se a mensagem do cliente menciona EXPLICITAMENTE algum produto específico.

Lista de produtos que o cliente possui:
${productNames.map((name, i) => `${i + 1}. ${name}`).join('\n')}

Regras:
- Se a mensagem menciona um nome de produto ou parte significativa dele, retorne o índice (1-based) do produto.
- Se a mensagem é genérica ("curso", "produto", "acesso", "senha"), retorne null (ambíguo).
- Ignore variações de escrita e erros de digitação (ex: "pythin" = "Python").

IMPORTANTE: Seja conservador. Em caso de dúvida, considere ambíguo (null).
`.trim();

    const userContent = `
Mensagem do usuário:
"${user_message}"

Responda APENAS com JSON:
{
  "is_ambiguous": boolean,
  "identified_product_index": number | null (1-based, ou null se ambíguo)
}
`.trim();

    try {
      const completion = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userContent },
        ],
        response_format: { type: 'json_object' },
      });

      const content = completion.choices[0]?.message?.content?.trim();

      if (!content) {
        console.log(`\x1b[33m[MultiProductClarification]\x1b[0m Empty LLM response, defaulting to ambiguous`);
        return buildClarificationMessage(purchased_products);
      }

      const parsed = JSON.parse(content);

      const isAmbiguous = parsed.is_ambiguous === true;
      const identifiedIndex = typeof parsed.identified_product_index === 'number' ? parsed.identified_product_index : null;

      if (!isAmbiguous && identifiedIndex && identifiedIndex >= 1 && identifiedIndex <= purchased_products.length) {
        const identifiedProduct = purchased_products[identifiedIndex - 1];
        console.log(`\x1b[32m[MultiProductClarification]\x1b[0m Identified product: ${identifiedProduct.product_name}`);

        if (logger) {
          logger.info(`Message is specific, identified product: ${identifiedProduct.product_name}`);
        }

        return {
          needs_clarification: false,
          identified_product_id: identifiedProduct.product_id,
        };
      }

      // Ambiguous
      console.log(`\x1b[33m[MultiProductClarification]\x1b[0m Message is ambiguous, generating clarification`);
      return buildClarificationMessage(purchased_products);
    } catch (error: any) {
      console.error(`\x1b[31m[MultiProductClarification]\x1b[0m Error: ${error.message}`);
      if (logger) {
        logger.error(`Multi-product clarification failed: ${error.message}`);
      }

      // Fallback to clarification
      return buildClarificationMessage(purchased_products);
    }
  },
});

function buildClarificationMessage(
  purchased_products: Array<{
    product_id: string;
    product_name: string;
    purchase_date: string;
    event_type: 'APPROVED' | 'REFUND';
  }>
): { needs_clarification: true; clarification_message: string } {
  const productList = purchased_products
    .map((p, i) => `${i + 1}. ${p.product_name}`)
    .join('\n');

  const message = `Vejo que você tem ${purchased_products.length} produtos:\n\n${productList}\n\nSobre qual deles você está falando?`;

  return {
    needs_clarification: true,
    clarification_message: message,
  };
}
