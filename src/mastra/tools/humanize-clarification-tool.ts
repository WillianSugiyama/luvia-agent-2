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

const humanizeClarificationInputSchema = z.object({
  user_message: z.string().describe('Original user message'),
  customer_name: z.string().optional().describe('Customer first name if known'),
  products: z.array(z.object({
    name: z.string(),
    short_name: z.string().optional(),
    status: z.enum(['approved', 'abandoned', 'refund']),
  })).describe('List of customer products'),
  context: z.enum(['greeting', 'support', 'sales', 'password', 'access', 'general']).describe('Context of the conversation'),
});

const humanizeClarificationOutputSchema = z.object({
  message: z.string().describe('Humanized clarification message'),
});

export const humanize_clarification = createTool({
  id: 'humanize-clarification',
  description: 'Generates humanized, conversational clarification messages using LLM',
  inputSchema: humanizeClarificationInputSchema,
  outputSchema: humanizeClarificationOutputSchema,
  execute: async (inputData) => {
    const { user_message, customer_name, products, context } = inputData;
    const client = getOpenAIClient();

    // Build product context
    const productDescriptions = products.map(p => {
      const statusMap = {
        approved: 'ativo/comprado',
        abandoned: 'no carrinho',
        refund: 'reembolsado',
      };
      const shortName = p.short_name || p.name.split(' ').slice(0, 3).join(' ');
      return `- ${shortName} (${statusMap[p.status]})`;
    }).join('\n');

    const isSingleProduct = products.length === 1;

    const systemPrompt = `Você é uma assistente de atendimento no WhatsApp. Seu tom é:
- Informal mas profissional
- Empático e acolhedor
- Usa frases curtas como no WhatsApp real
- Pode usar 1 emoji quando apropriado (não exagerar)
- NUNCA usa listas numeradas ou bullet points
- NUNCA dá respostas longas
- Responde como uma pessoa real responderia no WhatsApp

O cliente tem ${products.length} produto(s):
${productDescriptions}

${isSingleProduct
  ? `Sua tarefa: Gerar UMA mensagem curta confirmando se é sobre esse produto que o cliente quer falar.

REGRAS PARA 1 PRODUTO:
- Seja direto: "Você tá falando sobre o [nome curto]?"
- Se o cliente tem problema (senha, acesso), mostre empatia primeiro: "Não se preocupe, vamos resolver! É sobre o [produto]?"
- Use nome CURTO do produto (máximo 3-4 palavras principais)
- Máximo 2 linhas`
  : `Sua tarefa: Gerar UMA mensagem curta perguntando qual dos produtos o cliente quer falar.

REGRAS PARA MÚLTIPLOS PRODUTOS:
- Seja natural: "Você tá falando sobre a Comu RT ou o Divórcio Energético?"
- Se o cliente tem problema (senha, acesso), mostre empatia primeiro: "Não se preocupe, vamos resolver! Mas qual produto: a Comu RT ou o Divórcio?"
- Use nomes CURTOS dos produtos (máximo 3-4 palavras principais de cada)
- Máximo 2-3 linhas`}

REGRAS GERAIS:
1. Se o cliente mandou "olá" ou saudação, responda brevemente ANTES: "Oi! Tudo bem?" ou "Olá, tudo ótimo!"
2. ${customer_name ? `Use o nome "${customer_name}" de forma natural` : 'Não precisa usar nome'}
3. Contexto detectado: ${context}
4. Seja HUMANO, não robótico!`;

    const userPrompt = `Mensagem do cliente: "${user_message}"

Gere uma resposta humanizada ${isSingleProduct ? 'confirmando o produto' : 'perguntando qual produto'}. Lembre: curta, natural, como WhatsApp real.`;

    try {
      const response = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 150,
      });

      const message = response.choices[0]?.message?.content?.trim() || '';

      console.log(`\x1b[36m[HumanizeClarification]\x1b[0m Generated: "${message.substring(0, 100)}..."`);

      return { message };
    } catch (error: any) {
      console.error(`\x1b[31m[HumanizeClarification]\x1b[0m Error: ${error.message}`);

      // Fallback to simple message
      const names = products.map(p => p.short_name || p.name.split(' ').slice(0, 2).join(' ')).join(' ou ');
      return {
        message: `Oi! Você tá falando sobre ${names}?`,
      };
    }
  },
});
