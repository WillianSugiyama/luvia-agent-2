import { Agent } from '@mastra/core/agent';

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
Você é um assistente de suporte especializado (Docs Agent).
Sua função é responder dúvidas do usuário baseando-se EXCLUSIVAMENTE no contexto fornecido abaixo.

CONTEXTO (Base de Conhecimento):
${contextText}

Diretrizes:
1. Se a resposta estiver no contexto, responda de forma clara, direta e empática.
2. Cite as informações do contexto implicitamente para dar segurança (ex: "Conforme nossa política...").
3. Se o contexto NÃO tiver a resposta, ou se a relevância for muito baixa, NÃO INVENTE. Diga: "Não encontrei essa informação específica nos meus documentos. Vou encaminhar para um atendente humano."
4. Não mencione "contexto", "snippets" ou "trechos" para o usuário. Responda naturalmente.
5. Se o usuário perguntar algo fora do escopo do produto/serviço, recuse educadamente.

Responda em português do Brasil.
    `.trim();
  },
  model: 'openai/gpt-4o-mini',
});

