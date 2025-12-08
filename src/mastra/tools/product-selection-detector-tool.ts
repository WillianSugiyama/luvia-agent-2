import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import OpenAI from 'openai';

let openaiClient: OpenAI | null = null;

const getOpenAIClient = () => {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OpenAI API key is not configured');
    }
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
};

const productSelectionDetectorInputSchema = z.object({
  message: z.string().describe('User message to analyze'),
  products: z.array(z.object({
    index: z.number(),
    product_name: z.string(),
    event_type: z.string(),
  })).describe('List of products shown to the user'),
  conversation_history: z.string().optional().describe('Recent conversation history for context'),
});

const productSelectionDetectorOutputSchema = z.object({
  selected_index: z.number().nullable().describe('Index of selected product (1-based) or null if no selection'),
  confidence: z.number().describe('Confidence score 0-1'),
  is_selection: z.boolean().describe('True if user is selecting a product'),
  is_new_question: z.boolean().describe('True if user is asking something unrelated'),
  detected_intent: z.string().optional().describe('What the user seems to want'),
});

interface SelectionAnalysis {
  selected_index: number | null;
  confidence: number;
  is_selection: boolean;
  is_new_question: boolean;
  detected_intent?: string;
}

async function analyzeProductSelection(
  message: string,
  products: { index: number; product_name: string; event_type: string }[],
  conversationHistory?: string
): Promise<SelectionAnalysis> {
  const openai = getOpenAIClient();

  const productsList = products
    .map((p) => `${p.index}. "${p.product_name}" (${p.event_type})`)
    .join('\n');

  // Build context section if we have conversation history
  const historySection = conversationHistory
    ? `\nHISTÓRICO DA CONVERSA (mensagens anteriores):
${conversationHistory}

CONTEXTO: O usuário pode estar fazendo referência a algo mencionado anteriormente na conversa.
Se a mensagem parecer uma cobrança/impaciência ("olá?", "oii", "alguém aí?"), considere como follow_up, não como seleção de produto.\n`
    : '';

  const systemPrompt = `Você é um analisador de seleção de produtos. O sistema mostrou uma lista de produtos para o usuário e agora precisa entender a resposta dele.
${historySection}
LISTA DE PRODUTOS MOSTRADA:
${productsList}

Sua tarefa é determinar SE o usuário está selecionando um produto da lista e QUAL produto ele escolheu.

O usuário pode selecionar de várias formas:
- Número: "2", "o 2", "segundo", "o segundo"
- Nome parcial: "tratamento", "divórcio", "o coletivo"
- Nome completo ou quase completo
- Referência ao status: "o que eu comprei", "o do carrinho"

Se o usuário NÃO está selecionando um produto (está fazendo uma pergunta nova, cumprimentando, cobrando resposta, etc.), marque is_selection como false.

IMPORTANTE: O campo "selected_index" deve ser EXATAMENTE o número que aparece no início da linha do produto na lista acima.
- Se o usuário disse "2" ou "segundo", selected_index deve ser 2 (não 1!)
- Se o usuário disse "1" ou "primeiro", selected_index deve ser 1 (não 0!)
- Os índices começam em 1, NÃO em 0!

MENSAGENS DE COBRANÇA/IMPACIÊNCIA:
- Se a mensagem for "olá?", "oii", "oi?", "pode me ajudar?", "alguém aí?" = is_selection: false, is_new_question: false, detected_intent: "follow_up"

Responda APENAS com JSON válido:
{
  "selected_index": número do produto na lista (1, 2, 3...) ou null se não selecionou,
  "confidence": 0.0 a 1.0,
  "is_selection": boolean,
  "is_new_question": boolean,
  "detected_intent": "descrição curta do que o usuário quer"
}`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Mensagem do usuário: "${message}"` },
      ],
      temperature: 0,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      console.error('[ProductSelectionDetector] LLM returned empty response');
      return { selected_index: null, confidence: 0, is_selection: false, is_new_question: true };
    }

    const analysis = JSON.parse(content) as SelectionAnalysis;
    console.log(`\x1b[36m[ProductSelectionDetector]\x1b[0m Analysis: ${JSON.stringify(analysis)}`);
    return analysis;
  } catch (error) {
    console.error('[ProductSelectionDetector] LLM analysis failed:', error);
    return { selected_index: null, confidence: 0, is_selection: false, is_new_question: true };
  }
}

export const product_selection_detector = createTool({
  id: 'product-selection-detector',
  description: 'Uses LLM to detect which product the user is selecting from a multi-product list',
  inputSchema: productSelectionDetectorInputSchema,
  outputSchema: productSelectionDetectorOutputSchema,
  execute: async (inputData) => {
    const { message, products, conversation_history } = inputData;

    console.log(`\x1b[36m[ProductSelectionDetector]\x1b[0m Analyzing: "${message}" with ${products.length} products (has_history=${!!conversation_history})`);

    if (!products || products.length === 0) {
      return {
        selected_index: null,
        confidence: 0,
        is_selection: false,
        is_new_question: true,
        detected_intent: 'No products to select from',
      };
    }

    const analysis = await analyzeProductSelection(message, products, conversation_history);

    // Validate selected_index is within range
    if (analysis.selected_index !== null) {
      const validIndices = products.map((p) => p.index);
      if (!validIndices.includes(analysis.selected_index)) {
        console.warn(`[ProductSelectionDetector] Invalid index ${analysis.selected_index}, valid: ${validIndices}`);
        return {
          selected_index: null,
          confidence: 0,
          is_selection: false,
          is_new_question: false,
          detected_intent: 'Invalid product selection',
        };
      }
    }

    return {
      selected_index: analysis.selected_index,
      confidence: analysis.confidence,
      is_selection: analysis.is_selection,
      is_new_question: analysis.is_new_question,
      detected_intent: analysis.detected_intent,
    };
  },
});
