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

const interpretMessageInputSchema = z.object({
  message: z.string(),
  previous_product_name: z.string().optional().nullable(),
});

const interpretMessageOutputSchema = z.object({
  is_clarification_response: z.boolean(),
  has_clear_product: z.boolean(),
  product_name: z.string().nullable(),
  normalized_query: z.string(),
  interaction_type: z
    .enum(['support', 'pricing', 'purchase', 'upgrade', 'refund', 'general'])
    .default('general'),
});

export const interpret_user_message = createTool({
  id: 'interpret-user-message',
  description:
    'Interprets a noisy user message in Portuguese and extracts whether it is a clarification response, and which product/course is being referenced.',
  inputSchema: interpretMessageInputSchema,
  outputSchema: interpretMessageOutputSchema,
  execute: async (inputData) => {
    const { message, previous_product_name } = inputData;

    const client = getOpenAIClient();

    const system = `
Você é um analisador de mensagens de WhatsApp em português, com erros de digitação, abreviações e frases incompletas.

Sua tarefa é:
- Detectar se o usuário está RESPONDENDO a uma pergunta anterior de clarificação (ex.: "Outro", "Não é esse", "É o SOS RT", etc.).
- Identificar, se possível, o nome do curso/produto que o usuário está mencionando (mesmo com erros).
- Classificar o tipo principal de intenção do usuário.
- Gerar uma versão "normalizada" da intenção para ser usada em busca semântica.

Definições:
- is_clarification_response: true quando a mensagem parece ser uma resposta a uma pergunta anterior do tipo "qual curso/produto?".
- has_clear_product: true quando a mensagem deixa razoavelmente claro qual curso/produto é (ex.: "SOS RT", "COMU RT", "Congresso Pendulado Experience").
- product_name: o nome do curso/produto que o usuário menciona (texto curto), ou null se não ficar claro.
  - IMPORTANTE: Se o usuário citar explicitamente um nome de produto (ex.: "comprei o curso: Nome do Produto", "curso Livro Digital - Segredos da Radiestesia Terapêutica"), extraia esse nome EXATO e COMPLETO.
  - Remova apenas prefixos como "comprei", "quero", "curso:", mas mantenha o nome completo do produto.
  - Exemplo: "comprei o curso: Livro Digital - Segredos da Radiestesia Terapêutica" → product_name: "Livro Digital - Segredos da Radiestesia Terapêutica"
- normalized_query: uma reformulação curta da intenção para busca (ex.: "trocar do curso SOS RT para COMU RT na Black Friday", "saber preço do curso SOS RT").
- interaction_type: uma das opções:
  - "support": problemas de acesso, bugs, dúvidas pós-compra, dificuldades técnicas, ansiedade / pedido de ajuda (ex.: "não estou conseguindo acessar a aula", "me ajuda com...").
  - "pricing": perguntas sobre preço, desconto, forma de pagamento (ex.: "quanto custa?", "tem desconto?", "parcelamento").
  - "purchase": quando o foco é comprar/fechar (ex.: "quero comprar", "me manda o link para pagar").
  - "upgrade": trocas de curso/plano, migração (ex.: "posso trocar do SOS RT para COMU RT na Black Friday?").
  - "refund": pedidos de reembolso/cancelamento (ex.: "quero reembolso", "quero cancelar").
  - "general": qualquer coisa que não caiba claramente nas categorias acima.

IMPORTANTE:
- Se a mensagem só diz "Outro" ou "Não é esse" sem citar nome, então has_clear_product = false e product_name = null.
- Não invente nomes de produtos; use apenas o que aparece ou variações óbvias (mesmo com erros).
- Seja conservador: se estiver em dúvida entre "support" e "purchase", prefira "support".
`.trim();

    const userContent = `
Mensagem do usuário:
"${message}"

Produto anterior (se houver):
"${previous_product_name ?? ''}"

Responda APENAS com um JSON do tipo:
{
  "is_clarification_response": boolean,
  "has_clear_product": boolean,
  "product_name": string | null,
  "normalized_query": string,
  "interaction_type": "support" | "pricing" | "purchase" | "upgrade" | "refund" | "general"
}
`.trim();

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
      return {
        is_clarification_response: false,
        has_clear_product: false,
        product_name: null,
        normalized_query: message,
        interaction_type: 'general',
      };
    }

    let parsed: any;

    try {
      parsed = JSON.parse(content);
    } catch {
      const match = content.match(/\{[\s\S]*\}/);
      if (!match) {
        return {
          is_clarification_response: false,
          has_clear_product: false,
          product_name: null,
          normalized_query: message,
          interaction_type: 'general',
        };
      }
      parsed = JSON.parse(match[0]);
    }

    const isClarification =
      typeof parsed.is_clarification_response === 'boolean'
        ? parsed.is_clarification_response
        : false;
    const hasClearProduct =
      typeof parsed.has_clear_product === 'boolean'
        ? parsed.has_clear_product
        : false;
    const productName =
      typeof parsed.product_name === 'string' ? parsed.product_name : null;
    const normalizedQuery =
      typeof parsed.normalized_query === 'string' && parsed.normalized_query.trim().length > 0
        ? parsed.normalized_query
        : message;
    const interactionTypeRaw = typeof parsed.interaction_type === 'string' ? parsed.interaction_type : 'general';
    const allowedTypes = ['support', 'pricing', 'purchase', 'upgrade', 'refund', 'general'] as const;
    const interactionType: 'support' | 'pricing' | 'purchase' | 'upgrade' | 'refund' | 'general' =
      allowedTypes.includes(interactionTypeRaw as any)
        ? (interactionTypeRaw as 'support' | 'pricing' | 'purchase' | 'upgrade' | 'refund' | 'general')
        : 'general';

    return {
      is_clarification_response: isClarification,
      has_clear_product: hasClearProduct,
      product_name: productName,
      normalized_query: normalizedQuery,
      interaction_type: interactionType,
    };
  },
});
