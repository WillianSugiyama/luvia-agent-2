import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

let supabaseClient: SupabaseClient | null = null;
let openaiClient: OpenAI | null = null;

const getSupabaseClient = () => {
  if (!supabaseClient) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_KEY;

    if (!url || !key) {
      throw new Error('Supabase credentials are not configured');
    }

    supabaseClient = createClient(url, key);
  }

  return supabaseClient;
};

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

const greetingHandlerInputSchema = z.object({
  message: z.string(),
  team_id: z.string(),
  customer_phone: z.string().optional(),
  conversation_history: z.string().optional().describe('Recent conversation history for context'),
});

const greetingHandlerOutputSchema = z.object({
  is_greeting_only: z.boolean().describe('True if message is ONLY a greeting without any question or intent'),
  has_question_or_intent: z.boolean().describe('True if message contains a question, request or clear intent'),
  customer_name: z.string().optional(),
  team_name: z.string().optional(),
  agent_name: z.string().optional(),
  response: z.string().optional(),
});

interface GreetingAnalysis {
  is_greeting_only: boolean;
  has_question_or_intent: boolean;
  detected_intent?: string;
}

async function analyzeMessageWithLLM(message: string, conversationHistory?: string): Promise<GreetingAnalysis> {
  const openai = getOpenAIClient();

  // If there's conversation history, the user is in an ongoing conversation
  // "olá?", "oii", "pode me ajudar?" in this context are follow-ups, NOT new greetings
  const hasHistory = conversationHistory && conversationHistory.trim().length > 0;

  const systemPrompt = hasHistory
    ? `Você é um analisador de mensagens em uma conversa em andamento.

CONTEXTO IMPORTANTE: O usuário JÁ ESTÁ em uma conversa. Mensagens como "olá?", "oii", "oi?", "alguém aí?", "pode me ajudar?" NÃO são saudações novas - são sinais de impaciência ou pedidos de atenção.

HISTÓRICO DA CONVERSA:
${conversationHistory}

Sua tarefa é determinar se a NOVA mensagem do usuário é:
1. Um follow-up/cobrança (usuário esperando resposta ou querendo atenção) - NÃO é saudação
2. Uma mensagem que contém uma pergunta, pedido ou intenção clara

REGRA IMPORTANTE: Se existe histórico de conversa, mensagens curtas como "oi", "olá?", "oii", "e aí?" NÃO são saudações - são cobranças ou pedidos de atenção.

Responda APENAS com um JSON válido no formato:
{
  "is_greeting_only": false (SEMPRE false quando há histórico de conversa),
  "has_question_or_intent": true (SEMPRE true quando há histórico de conversa),
  "detected_intent": "follow_up" ou descrição da intenção
}`
    : `Você é um analisador de mensagens. Sua tarefa é determinar se uma mensagem é:
1. APENAS uma saudação (sem nenhuma pergunta ou intenção clara)
2. Uma mensagem que contém uma pergunta, pedido ou intenção clara

Exemplos de APENAS saudação (is_greeting_only = true):
- "Oi"
- "Olá"
- "Olá, tudo bem?"
- "Oi, tudo certo?"
- "Bom dia"
- "Boa tarde, como vai?"
- "E aí!"
- "Opa"

Exemplos de mensagem COM pergunta/intenção (has_question_or_intent = true):
- "Olá, quero saber sobre o produto X"
- "Oi, quanto custa?"
- "Bom dia, preciso de ajuda com meu pedido"
- "Olá, gostaria de fazer uma compra"
- "Oi, estou com problema no acesso"
- "Olá, me fala sobre os cursos"

Responda APENAS com um JSON válido no formato:
{
  "is_greeting_only": boolean,
  "has_question_or_intent": boolean,
  "detected_intent": "string ou null"
}`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Analise esta mensagem: "${message}"` },
      ],
      temperature: 0,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      console.error('[GreetingHandler] LLM returned empty response');
      return { is_greeting_only: false, has_question_or_intent: true };
    }

    const analysis = JSON.parse(content) as GreetingAnalysis;
    console.log(`\x1b[36m[GreetingHandler]\x1b[0m LLM Analysis: ${JSON.stringify(analysis)} (hasHistory=${hasHistory})`);
    return analysis;
  } catch (error) {
    console.error('[GreetingHandler] LLM analysis failed:', error);
    // Fallback: assume it's not just a greeting to be safe
    return { is_greeting_only: false, has_question_or_intent: true };
  }
}

async function fetchCustomerName(
  supabase: SupabaseClient,
  teamId: string,
  customerPhone: string
): Promise<string | null> {
  try {
    // Try to fetch customer name from customer_events or a customers table
    const { data, error } = await supabase
      .from('customer_events')
      .select('customer_name')
      .eq('team_id', teamId)
      .eq('customer_phone', customerPhone)
      .not('customer_name', 'is', null)
      .limit(1)
      .single();

    if (error || !data?.customer_name) {
      return null;
    }

    return data.customer_name;
  } catch {
    return null;
  }
}

async function fetchTeamData(
  supabase: SupabaseClient,
  teamId: string
): Promise<{ teamName: string; agentName: string }> {
  try {
    const { data, error } = await supabase
      .from('teams')
      .select('name, agent_name')
      .eq('id', teamId)
      .single();

    if (error || !data) {
      return { teamName: 'nossa equipe', agentName: 'Assistente' };
    }

    return {
      teamName: data.name || 'nossa equipe',
      agentName: data.agent_name || 'Assistente',
    };
  } catch {
    return { teamName: 'nossa equipe', agentName: 'Assistente' };
  }
}

export const greeting_handler = createTool({
  id: 'greeting-handler',
  description: 'Uses LLM to detect if message is only a greeting and generates personalized response',
  inputSchema: greetingHandlerInputSchema,
  outputSchema: greetingHandlerOutputSchema,
  execute: async (inputData, context) => {
    const { message, team_id, customer_phone, conversation_history } = inputData;
    const logger = context?.mastra?.logger;

    console.log(`\x1b[36m[GreetingHandler]\x1b[0m Analyzing message: "${message}" (has_history=${!!conversation_history})`);

    // Use LLM to analyze the message with conversation history context
    const analysis = await analyzeMessageWithLLM(message, conversation_history);

    // Fetch team data
    const supabase = getSupabaseClient();
    const { teamName, agentName } = await fetchTeamData(supabase, team_id);

    // Try to fetch customer name if phone is provided
    let customerName: string | null = null;
    if (customer_phone) {
      customerName = await fetchCustomerName(supabase, team_id, customer_phone);
    }

    // If message has a question or intent, don't treat as simple greeting
    if (analysis.has_question_or_intent) {
      console.log(`\x1b[33m[GreetingHandler]\x1b[0m Message has question/intent - not a simple greeting`);

      return {
        is_greeting_only: false,
        has_question_or_intent: true,
        customer_name: customerName || undefined,
        team_name: teamName,
        agent_name: agentName,
      };
    }

    // It's only a greeting - generate humanized response
    console.log(`\x1b[32m[GreetingHandler]\x1b[0m Detected simple greeting - generating welcome response`);

    if (logger) {
      logger.info(`[GreetingHandler] Simple greeting detected for team ${teamName}`);
    }

    // Build personalized greeting
    // Check if user asked "tudo bem?" or similar
    const askedHowAreYou = /(tudo bem|como vai|como está|td bem|blz|beleza)\??/i.test(message);

    let response: string;

    if (customerName) {
      if (askedHowAreYou) {
        response = `Olá ${customerName}! Tudo ótimo por aqui, e com você? 😊 Sou ${agentName}, em que posso te ajudar hoje?`;
      } else {
        response = `Olá ${customerName}! Sou ${agentName}, em que posso te ajudar hoje?`;
      }
    } else {
      if (askedHowAreYou) {
        response = `Olá! Tudo ótimo por aqui, e com você? 😊 Sou ${agentName}, em que posso te ajudar hoje?`;
      } else {
        response = `Olá! Sou ${agentName}, em que posso te ajudar hoje?`;
      }
    }

    console.log(`\x1b[32m[GreetingHandler]\x1b[0m Generated response: "${response}"`);

    return {
      is_greeting_only: true,
      has_question_or_intent: false,
      customer_name: customerName || undefined,
      team_name: teamName,
      agent_name: agentName,
      response,
    };
  },
});
