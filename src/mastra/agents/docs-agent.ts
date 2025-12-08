import { Agent } from '@mastra/core/agent';
import { MODELS } from '../config/models';

type KnowledgeResult = {
  content: string;
  score: number;
};

const getKnowledgeFromRuntime = (requestContext: any): KnowledgeResult[] => {
  if (!requestContext?.get) {
    return [];
  }
  try {
    const results = requestContext.get('knowledge_results');
    return Array.isArray(results) ? results : [];
  } catch {
    return [];
  }
};

export const docsAgent = new Agent({
  name: 'docs_agent',
  instructions: ({ requestContext }) => {
    const knowledge = getKnowledgeFromRuntime(requestContext);

    const contextText =
      knowledge.length > 0
        ? knowledge.map((k, i) => `[DOC ${i + 1}] (Relevância: ${k.score.toFixed(2)})\n${k.content}`).join('\n\n')
        : 'Nenhuma informação específica encontrada na base de conhecimento.';

    return `
Você é uma assistente de suporte no WhatsApp.

ESTILO DE COMUNICAÇÃO (CRÍTICO):
- Mensagens CURTAS (máximo 2-3 frases)
- NUNCA use bullet points, listas ou formatação markdown
- Seja natural e conversacional
- Use no máximo 1 emoji quando apropriado

BASE DE CONHECIMENTO:
${contextText}

COMO RESPONDER:
- Use a informação da base de forma natural
- Não diga "de acordo com a documentação" ou similar
- Se não tiver a resposta, diga que vai verificar com a equipe

EXEMPLO BOM:
❌ ERRADO: "De acordo com nossa política, você tem: 1. Garantia de 7 dias 2. Acesso vitalício 3. Suporte por email"
✅ CERTO: "Você tem garantia de 7 dias pra testar, se não gostar devolvemos o valor 😊"

Se a informação não estiver na base, diga: "Vou verificar isso com a equipe e já te retorno!"
    `.trim();
  },
  model: MODELS.AGENT_MODEL_STRING,
});

