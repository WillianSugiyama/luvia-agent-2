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
  products: { index: number; product_name: string; event_type: string }[]
): Promise<SelectionAnalysis> {
  const openai = getOpenAIClient();

  const productsList = products
    .map((p) => `${p.index}. "${p.product_name}" (${p.event_type})`)
    .join('\n');

  const systemPrompt = `Você é um analisador de seleção de produtos. O sistema mostrou uma lista de produtos para o usuário e agora precisa entender a resposta dele.

LISTA DE PRODUTOS MOSTRADA:
${productsList}

Sua tarefa é determinar SE o usuário está selecionando um produto da lista e QUAL produto ele escolheu.

O usuário pode selecionar de várias formas:
- Número: "2", "o 2", "segundo", "o segundo"
- Nome parcial: "tratamento", "divórcio", "o coletivo"
- Nome completo ou quase completo
- Referência ao status: "o que eu comprei", "o do carrinho"

Se o usuário NÃO está selecionando um produto (está fazendo uma pergunta nova, cumprimentando, etc.), marque is_selection como false.

Responda APENAS com JSON válido:
{
  "selected_index": number ou null,
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
    const { message, products } = inputData;

    console.log(`\x1b[36m[ProductSelectionDetector]\x1b[0m Analyzing: "${message}" with ${products.length} products`);

    if (!products || products.length === 0) {
      return {
        selected_index: null,
        confidence: 0,
        is_selection: false,
        is_new_question: true,
        detected_intent: 'No products to select from',
      };
    }

    const analysis = await analyzeProductSelection(message, products);

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
