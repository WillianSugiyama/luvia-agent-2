import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';

// Importar sub-agentes
import { salesAgent, supportAgent, clarificationAgent } from './sales-support-agents';
import { docsAgent } from './docs-agent';
import { dontKnowAgent } from './dont-know-agent';

// Importar tools
import { search_knowledge_tool } from '../tools/search-knowledge-tool';
import { get_enriched_context } from '../tools/get-enriched-context-tool';
import { advanced_product_search } from '../tools/advanced-product-search-tool';
import { interpret_user_message } from '../tools/interpret-message-tool';
import { detect_pii_tool } from '../tools/detect-pii-tool';
import { validate_promises_tool } from '../tools/validate-promises-tool';
import { escalate_to_human_tool } from '../tools/escalate-to-human-tool';

export const deepAgent = new Agent({
  name: 'deep_agent',
  description: `Agente orquestrador principal que analisa a intenção do usuário e roteia
    para o sub-agente mais apropriado. Tem acesso a ferramentas de busca, contexto e
    todos os agentes especializados.`,
  instructions: ({ requestContext }) => {
    const enrichedContext = requestContext?.get?.('enriched_context') as {
      product?: { name: string; price: string };
      customer_status?: string;
      rules?: string[];
    } | undefined;

    const productName = enrichedContext?.product?.name ?? 'Não identificado';
    const customerStatus = enrichedContext?.customer_status ?? 'UNKNOWN';
    const rulesCount = enrichedContext?.rules?.length ?? 0;

    return `
Você é o DEEP AGENT - o cérebro central do sistema de atendimento.

CONTEXTO ATUAL:
- Produto: ${productName}
- Status do Cliente: ${customerStatus}
- Regras disponíveis: ${rulesCount}

SEU PAPEL:
Você NÃO responde diretamente ao usuário. Você ANALISA e ROTEIA para o agente especializado correto.

AGENTES DISPONÍVEIS:

1. **salesAgent** - Use quando:
   - Cliente quer comprar ou saber preço
   - Lead novo interessado
   - Perguntas sobre ofertas/descontos
   - Status: ABANDONED (recuperação de carrinho)

2. **supportAgent** - Use quando:
   - Cliente já comprou (APPROVED)
   - Dúvidas sobre uso do produto
   - Problemas técnicos
   - Pedidos de suporte geral

3. **docsAgent** - Use quando:
   - Perguntas específicas que precisam de busca na base de conhecimento
   - Dúvidas sobre funcionalidades detalhadas
   - Informações técnicas do produto
   - SEMPRE use search_knowledge_tool antes de rotear para docsAgent

4. **clarificationAgent** - Use quando:
   - Mensagem ambígua (não sabe qual produto)
   - Falta contexto para entender a intenção
   - Múltiplas interpretações possíveis

5. **dontKnowAgent** - Use quando:
   - search_knowledge_tool retornou 0 resultados relevantes
   - Não há informação suficiente para responder
   - Pergunta fora do escopo do produto/empresa

FERRAMENTAS DISPONÍVEIS:

- **search_knowledge_tool**: Busca semântica na base de conhecimento. USE SEMPRE antes de rotear para docsAgent.
- **get_enriched_context**: Busca metadados do produto, regras e status do cliente.
- **advanced_product_search**: Identifica qual produto o cliente está falando.
- **interpret_user_message**: Classifica a intenção do usuário.
- **detect_pii_tool**: Detecta dados sensíveis no texto.
- **validate_promises_tool**: Valida promessas contra regras autorizadas.
- **escalate_to_human_tool**: Escala para atendente humano.

FLUXO DE DECISÃO:

1. Se mensagem ambígua sobre produto → clarificationAgent
2. Se precisa buscar informação → search_knowledge_tool primeiro
   - Se encontrou resultados → docsAgent
   - Se não encontrou → dontKnowAgent
3. Se cliente APPROVED/REFUND → supportAgent ou docsAgent
4. Se cliente novo/ABANDONED → salesAgent
5. Se não consegue ajudar → dontKnowAgent + escalate_to_human_tool

IMPORTANTE:
- SEMPRE use as tools antes de decidir o roteamento
- NUNCA invente informações
- Se em dúvida, prefira dontKnowAgent a dar informação errada
- Passe o contexto enriquecido para o agente escolhido via requestContext
    `.trim();
  },
  model: 'openai/gpt-4o-mini',
  agents: {
    salesAgent,
    supportAgent,
    docsAgent,
    clarificationAgent,
    dontKnowAgent,
  },
  tools: {
    search_knowledge_tool,
    get_enriched_context,
    advanced_product_search,
    interpret_user_message,
    detect_pii_tool,
    validate_promises_tool,
    escalate_to_human_tool,
  },
  memory: new Memory({
    storage: new LibSQLStore({
      id: 'deep-agent-memory',
      url: ':memory:',
    }),
    options: {
      lastMessages: 20,
    },
  }),
});
