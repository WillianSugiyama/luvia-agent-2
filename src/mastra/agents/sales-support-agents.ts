import { Agent } from '@mastra/core/agent';

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

export const salesAgent = new Agent({
  name: 'sales_agent',
  instructions: ({ requestContext }) => {
    const ctx = getEnrichedContextFromRuntime(requestContext);

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
  model: 'openai/gpt-4o-mini',
});

export const supportAgent = new Agent({
  name: 'support_agent',
  instructions: ({ requestContext }) => {
    const ctx = getEnrichedContextFromRuntime(requestContext);

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
  model: 'openai/gpt-4o-mini',
});

export const clarificationAgent = new Agent({
  name: 'clarification_agent',
  instructions: `
O usuário enviou uma mensagem que não deixa claro exatamente qual curso ou produto ele está se referindo.

Sua tarefa:
- Faça UMA pergunta simples e direta em português.
- Peça para o usuário informar o NOME exato do curso/produto.
- Se fizer sentido, peça também que diga se quer trocar, comprar, cancelar ou tirar dúvida sobre esse curso.

Regras importantes:
- Não sugira nomes de produtos.
- Não assuma que você sabe qual é o produto.
- Não faça nenhuma oferta de venda ainda, apenas peça clarificação.
`.trim(),
  model: 'openai/gpt-4o-mini',
});
