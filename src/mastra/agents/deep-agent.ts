import { Agent } from '@mastra/core/agent';
import { MODELS } from '../config/models';
import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';

// Importar sub-agentes
import { salesAgent, supportAgent, clarificationAgent } from './sales-support-agents';
import { docsAgent } from './docs-agent';
import { dontKnowAgent } from './dont-know-agent';
import { contextSwitchConfirmationAgent } from './context-switch-confirmation-agent';
import { productHistoryConfirmationAgent } from './product-history-confirmation-agent';

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
      customer_purchased_products?: string[];
      is_multi_product_customer?: boolean;
      active_product_ownership?: 'APPROVED' | 'REFUND' | 'UNKNOWN';
    } | undefined;

    const intent = requestContext?.get?.('intent') as {
      interaction_type?: string;
    } | undefined;

    // Get team_id and product_id from enrichedContext
    const teamId = requestContext?.get?.('team_id') ?? 'unknown';
    const productId = requestContext?.get?.('product_id') ?? 'unknown';

    const productName = enrichedContext?.product?.name ?? 'Não identificado';
    const customerStatus = enrichedContext?.customer_status ?? 'UNKNOWN';
    const rulesCount = enrichedContext?.rules?.length ?? 0;

    // Multi-product context
    const purchasedProducts = enrichedContext?.customer_purchased_products ?? [];
    const isMultiProductCustomer = enrichedContext?.is_multi_product_customer ?? false;
    const activeProductOwnership = enrichedContext?.active_product_ownership ?? 'UNKNOWN';

    // Pending context switch (from conversation state)
    const pendingSwitch = requestContext?.get?.('pending_context_switch') as {
      from_product_name?: string;
      to_product_name?: string;
      from_mode?: string;
      to_mode?: string;
    } | undefined;

    // Pending product confirmation (from conversation state)
    const pendingProductConfirmation = requestContext?.get?.('pending_product_confirmation') as {
      suggested_product_name?: string;
      event_type?: string;
    } | undefined;

    return `
Você é o DEEP AGENT - o cérebro central do sistema de atendimento.

CONTEXTO ATUAL:
- Team ID: ${teamId}
- Product ID: ${productId}
- Produto: ${productName}
- Status do Cliente: ${customerStatus}
- Regras disponíveis: ${rulesCount}

MULTI-PRODUCT CONTEXT:
- Cliente possui múltiplos produtos: ${isMultiProductCustomer ? 'SIM' : 'NÃO'}
- Produtos comprados: ${purchasedProducts.length > 0 ? purchasedProducts.join(', ') : 'Nenhum'}
- Ownership do produto atual: ${activeProductOwnership}
- Troca de contexto pendente: ${pendingSwitch ? `${pendingSwitch.from_product_name} (${pendingSwitch.from_mode}) → ${pendingSwitch.to_product_name} (${pendingSwitch.to_mode})` : 'Nenhuma'}
- Confirmação de produto pendente: ${pendingProductConfirmation ? `${pendingProductConfirmation.suggested_product_name} (${pendingProductConfirmation.event_type})` : 'Nenhuma'}

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

6. **contextSwitchConfirmationAgent** - Use quando:
   - Existe uma troca de contexto pendente (veja "MULTI-PRODUCT CONTEXT")
   - Usuário respondeu a uma pergunta de confirmação de troca
   - Precisa interpretar se usuário confirmou, rejeitou ou está indeciso

7. **productHistoryConfirmationAgent** - Use quando:
   - Existe uma confirmação de produto pendente (veja "MULTI-PRODUCT CONTEXT")
   - Usuário respondeu a uma pergunta sobre produto sugerido do histórico
   - Precisa interpretar se usuário confirmou, rejeitou ou está indeciso sobre o produto sugerido

FERRAMENTAS DISPONÍVEIS:

- **search_knowledge_tool**: Busca semântica na base de conhecimento. USE SEMPRE antes de rotear para docsAgent.
  PARÂMETROS OBRIGATÓRIOS: query, product_id, team_id (disponível no contexto)
- **get_enriched_context**: Busca metadados do produto, regras e status do cliente.
- **advanced_product_search**: Identifica qual produto o cliente está falando.
- **interpret_user_message**: Classifica a intenção do usuário.
- **detect_pii_tool**: Detecta dados sensíveis no texto.
- **validate_promises_tool**: Valida promessas contra regras autorizadas.
- **escalate_to_human_tool**: Escala para atendente humano.

FLUXO DE DECISÃO:

0. **[PRIORIDADE MÁXIMA]** Se existe troca de contexto pendente:
   - O usuário acabou de ser perguntado se quer trocar de produto/contexto
   - Use contextSwitchConfirmationAgent para interpretar a resposta
   - Baseado na resposta, confirme a troca ou mantenha o contexto atual

0.5. **[PRIORIDADE MÁXIMA]** Se existe confirmação de produto pendente:
   - O usuário acabou de ser perguntado se quer falar sobre o produto do histórico
   - Use productHistoryConfirmationAgent para interpretar a resposta
   - Se confirmou: use o produto sugerido
   - Se rejeitou: faça busca normal de produto
   - Se indeciso: peça mais clarificação

1. Se mensagem ambígua sobre produto → clarificationAgent
2. Se precisa buscar informação → search_knowledge_tool primeiro
   - Se encontrou resultados → docsAgent
   - Se não encontrou → dontKnowAgent
3. Se cliente APPROVED/REFUND → supportAgent ou docsAgent
4. Se cliente novo/ABANDONED → salesAgent
5. Se não consegue ajudar → dontKnowAgent + escalate_to_human_tool

CONTEXT SWITCHING (Multi-Product Customers):

Se o cliente possui múltiplos produtos (veja "MULTI-PRODUCT CONTEXT"):
- Produtos comprados mostram o histórico completo
- Ownership do produto atual indica se ele possui/não possui o produto em questão
- Se cliente muda de tópico (de suporte para vendas, ou entre produtos diferentes):
  1. Detecte a mudança de contexto
  2. Pergunte confirmação ao usuário: "Você quer falar sobre [novo produto] agora?"
  3. Na próxima mensagem, use contextSwitchConfirmationAgent para interpretar resposta

Regras de Context Switching:
- Suporte → Vendas de outro produto: SEMPRE perguntar
- Vendas → Suporte: SEMPRE perguntar
- Entre produtos diferentes no suporte: SEMPRE perguntar
- Contexto "sticky": se usuário está em suporte do Produto A, mensagens ambíguas assumem Produto A

IMPORTANTE:
- SEMPRE use as tools antes de decidir o roteamento
- NUNCA invente informações
- Se em dúvida, prefira dontKnowAgent a dar informação errada
- Passe o contexto enriquecido para o agente escolhido via requestContext
- Ao chamar search_knowledge_tool, SEMPRE passe team_id e product_id do contexto atual (veja "CONTEXTO ATUAL" acima)
- Respeite a prioridade: pending context switch > ambiguidade > busca normal

⚠️ ESTILO DE RESPOSTA (TODOS OS SUB-AGENTES DEVEM SEGUIR):
- Respostas CURTAS no estilo WhatsApp (máx 2 frases)
- PROIBIDO listas numeradas, bullet points ou menus de opções
- Uma pergunta de cada vez - nunca "1) opção A 2) opção B 3) opção C"
- Se cliente disse qual é o problema, NÃO pergunte "qual o problema?"
    `.trim();
  },
  model: MODELS.AGENT_MODEL_STRING,
  agents: {
    salesAgent,
    supportAgent,
    docsAgent,
    clarificationAgent,
    dontKnowAgent,
    contextSwitchConfirmationAgent,
    productHistoryConfirmationAgent,
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
