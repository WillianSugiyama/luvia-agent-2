import { Agent } from '@mastra/core/agent';
import { MODELS } from '../config/models';

type EnrichedContext = {
  product: {
    name: string;
    price: string;
    checkout_link: string;
    description?: string;
  };
  customer_status: string;
  rules: string[];
  sales_strategy: {
    framework: string;
    instruction: string;
    cta_suggested: string;
    should_offer?: boolean;
  };
};

type GreetingData = {
  customer_name?: string;
  agent_name?: string;
  team_name?: string;
};

const getEnrichedContextFromRuntime = (requestContext: any): EnrichedContext | null => {
  if (!requestContext?.get) {
    return null;
  }

  try {
    const context = requestContext.get('enriched_context') as EnrichedContext | undefined;
    return context ?? null;
  } catch {
    return null;
  }
};

const getGreetingDataFromRuntime = (requestContext: any): GreetingData | null => {
  if (!requestContext?.get) {
    return null;
  }

  try {
    const data = requestContext.get('greeting_data') as GreetingData | undefined;
    return data ?? null;
  } catch {
    return null;
  }
};

const buildGreetingPrefix = (greetingData: GreetingData | null): string => {
  if (!greetingData) {
    return 'Olá! Tudo bem?';
  }

  const { customer_name } = greetingData;

  if (customer_name) {
    return `Olá ${customer_name}, tudo bem?`;
  }

  return 'Olá! Tudo bem?';
};

export const salesAgent = new Agent({
  name: 'sales_agent',
  instructions: ({ requestContext }) => {
    const ctx = getEnrichedContextFromRuntime(requestContext);
    const greetingData = getGreetingDataFromRuntime(requestContext);
    const greetingPrefix = buildGreetingPrefix(greetingData);

    const product = ctx?.product ?? {
      name: 'produto',
      price: '',
      checkout_link: '',
      description: '',
    };

    const salesStrategy = ctx?.sales_strategy ?? {
      framework: 'Genérico',
      instruction: 'Adapte a mensagem ao contexto do cliente.',
      cta_suggested: 'Clique agora para garantir sua oferta.',
    };

    const rules = Array.isArray(ctx?.rules) ? ctx?.rules : [];
    const customerStatus = ctx?.customer_status ?? 'UNKNOWN';
    const shouldOffer = ctx?.sales_strategy?.should_offer ?? true;

    const rulesText =
      rules.length > 0
        ? rules.map((rule) => `- ${rule}`).join('\n')
        : '- Sem regras específicas para este produto.';

    const descriptionText = product.description
      ? `DESCRIÇÃO: ${product.description}\n`
      : '';

    const checkoutInstruction = product.checkout_link
      ? `Você DEVE fornecer este link no final: ${product.checkout_link}`
      : 'Se o link não estiver disponível, explique isso claramente e não invente um link.';

    return `
Você é um especialista em vendas.

SAUDAÇÃO OBRIGATÓRIA:
Comece SEMPRE sua resposta com: "${greetingPrefix}"
Depois da saudação, responda à pergunta ou objeção do cliente.

PRODUTO: ${product.name}
PREÇO: ${product.price}
${descriptionText}

ESTRATÉGIA OBRIGATÓRIA (Do QDrant):
- Framework: ${salesStrategy.framework}
- Instrução: ${salesStrategy.instruction}
- CTA: ${salesStrategy.cta_suggested}

REGRAS DE NEGÓCIO (Do Supabase):
${rulesText}

LINK DE CHECKOUT (Crítico):
${checkoutInstruction}

Regras adicionais:
- Use o preço e as regras para trazer detalhes concretos (parcelamento, garantia, descontos ou ausência deles).
- Se sales_strategy.should_offer for false, NÃO force uma oferta; foque em informar e acolher.
- Se faltar informação importante (preço vazio, regras vazias, nenhuma estratégia clara), diga que não tem dados suficientes e que vai encaminhar para um especialista humano, em vez de inventar.
- Seja empático com mensagens de ansiedade ou dificuldade financeira, explique opções reais (quando existir) e evite respostas genéricas.

Contexto do Cliente: ${customerStatus} (Se ABANDONED, foque em recuperar).
Seja persuasivo, mas claro e específico; priorize informações relevantes mesmo que passe de 180 caracteres.
    `.trim();
  },
  model: MODELS.AGENT_MODEL_STRING,
});

export const supportAgent = new Agent({
  name: 'support_agent',
  instructions: ({ requestContext }) => {
    const ctx = getEnrichedContextFromRuntime(requestContext);
    const greetingData = getGreetingDataFromRuntime(requestContext);
    const greetingPrefix = buildGreetingPrefix(greetingData);

    const product = ctx?.product ?? {
      name: 'produto',
      price: '',
      checkout_link: '',
      description: '',
    };

    const rules = Array.isArray(ctx?.rules) ? ctx?.rules : [];

    console.log(rules, 'rules');

    const customerStatus = ctx?.customer_status ?? 'UNKNOWN';

    const rulesText =
      rules.length > 0
        ? rules.map((rule) => `- ${rule}`).join('\n')
        : '- Sem regras específicas para este produto.';

    return `
Você é o suporte técnico oficial.

SAUDAÇÃO OBRIGATÓRIA:
Comece SEMPRE sua resposta com: "${greetingPrefix}"
Depois da saudação, responda à dúvida ou problema do cliente.

Cliente comprou: ${product.name}. Status: ${customerStatus}.

Base de Conhecimento/Regras:
${rulesText}

Regras adicionais:
- Use o máximo possível das regras para explicar políticas (garantia, trocas, reembolsos, prazos).
- Se não tiver informação suficiente, assuma postura de suporte: explique o que VOCÊ sabe e diga que vai acionar um especialista humano para o restante.
- Evite respostas genéricas; foque em clareza, empatia e em reduzir a ansiedade do usuário.

Seja empático, resolutivo e use linguagem clara.
    `.trim();
  },
  model: MODELS.AGENT_MODEL_STRING,
});

export const clarificationAgent = new Agent({
  name: 'clarification_agent',
  instructions: ({ requestContext }) => {
    const ctx = getEnrichedContextFromRuntime(requestContext);
    const greetingData = getGreetingDataFromRuntime(requestContext);
    const greetingPrefix = buildGreetingPrefix(greetingData);
    const suggestedProduct = ctx?.product?.name ?? 'o produto';

    return `
O sistema encontrou um produto que pode ser o que o usuário está procurando, mas não tem certeza (score de confiança < 0.9).

SAUDAÇÃO OBRIGATÓRIA:
Comece SEMPRE sua resposta com: "${greetingPrefix}"
Depois da saudação, peça a confirmação do produto.

PRODUTO SUGERIDO: ${suggestedProduct}

Sua tarefa:
- SUGIRA o produto encontrado ao usuário
- Peça confirmação de forma natural e direta
- Exemplo: "${greetingPrefix} Você está falando sobre o **${suggestedProduct}**?"

Regras importantes:
- SEMPRE mencione o nome do produto sugerido
- Seja direto e objetivo
- Use formatação em negrito (**nome do produto**) para destacar
- Não faça ofertas de venda ainda, apenas confirme o produto
- Se o usuário confirmar, o sistema vai rotear para o agente correto
`.trim();
  },
  model: MODELS.AGENT_MODEL_STRING,
});
