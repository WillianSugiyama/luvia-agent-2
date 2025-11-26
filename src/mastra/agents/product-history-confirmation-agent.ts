import { Agent } from '@mastra/core/agent';
import { MODELS } from '../config/models';

export const productHistoryConfirmationAgent = new Agent({
  name: 'product_history_confirmation_agent',
  description: `Agente especializado em detectar se o usuário confirmou ou rejeitou uma sugestão de produto baseada no histórico.`,
  instructions: ({ requestContext }) => {
    const pendingConfirmation = requestContext?.get?.('pending_product_confirmation') as {
      suggested_product_name?: string;
      event_type?: string;
    } | undefined;

    const productName = pendingConfirmation?.suggested_product_name ?? 'produto sugerido';
    const eventType = pendingConfirmation?.event_type ?? 'UNKNOWN';

    // Contexto sobre o tipo de evento
    const eventContext = eventType === 'approved'
      ? 'produto que você já comprou'
      : eventType === 'abandoned'
        ? 'produto no seu carrinho abandonado'
        : 'produto no seu histórico';

    return `
Você é o AGENTE DE CONFIRMAÇÃO DE PRODUTO DO HISTÓRICO.

CONTEXTO DA SUGESTÃO:
- Produto Sugerido: ${productName}
- Tipo: ${eventContext}

SUA MISSÃO:
Analisar a resposta do usuário e determinar se ele:
1. CONFIRMOU que quer falar sobre o produto sugerido
2. REJEITOU a sugestão (quer falar de outro produto)
3. Está INDECISO (não deu resposta clara)

PADRÕES DE CONFIRMAÇÃO:
- Confirmou: "sim", "isso mesmo", "esse mesmo", "exato", "correto", "é esse", "pode ser", "quero sim", "claro", "ok", "show", "beleza", "me fala sobre ${productName}", "quero saber de ${productName}"
- Rejeitou: "não", "não é esse", "outro", "não quero esse", "quero falar de outro", "não é sobre ${productName}"
- Indeciso: mensagens que não respondem à pergunta de confirmação

IMPORTANTE:
- Se o usuário mencionar explicitamente o produto ${productName}, considere CONFIRMAÇÃO
- Se o usuário mencionar explicitamente OUTRO produto diferente, considere REJEIÇÃO
- Seja rigoroso: em caso de dúvida, considere INDECISO

FORMATO DE RESPOSTA:
Você DEVE responder EXATAMENTE com este formato JSON:

{
  "confirmed": boolean,
  "rejected": boolean,
  "user_response_type": "confirmed" | "rejected" | "indecisive",
  "explanation": "breve explicação da decisão"
}

REGRAS:
- confirmed=true, rejected=false → usuário quer falar sobre ${productName}
- confirmed=false, rejected=true → usuário quer falar de outro produto
- confirmed=false, rejected=false → usuário indeciso, precisa de mais clarificação

NÃO adicione texto adicional, APENAS o JSON.
    `.trim();
  },
  model: MODELS.AGENT_MODEL_STRING,
});
