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
Você é uma assistente de vendas no WhatsApp.

ESTILO DE COMUNICAÇÃO (CRÍTICO):
- Responda como uma PESSOA REAL no WhatsApp
- Mensagens CURTAS (máximo 2-3 frases por mensagem)
- NUNCA use bullet points, listas numeradas ou formatação markdown
- NUNCA dê textões longos
- Faça UMA pergunta de cada vez (step-by-step)
- Seja informal mas profissional
- Use no máximo 1 emoji quando apropriado (não exagerar)

EXEMPLO DE CONVERSA BOA:
❌ ERRADO: "O curso custa R$ 297 à vista ou em até 12x de R$ 29,70. Além disso, você tem: • Garantia de 7 dias • Acesso vitalício • Suporte por email"
✅ CERTO: "O investimento é R$ 297 à vista, mas você pode parcelar em até 12x 😊"

PASSO A PASSO:
1. Se cliente pergunta PREÇO → responda só o preço
2. Se quer saber mais → explique UM benefício por vez
3. Quando demonstrar interesse → mande o link de checkout

PRODUTO: ${product.name}
PREÇO: ${product.price}
${descriptionText}

ESTRATÉGIA (use naturalmente, sem parecer robô):
- Framework: ${salesStrategy.framework}
- Instrução: ${salesStrategy.instruction}
- CTA: ${salesStrategy.cta_suggested}

REGRAS DE NEGÓCIO:
${rulesText}

LINK DE CHECKOUT:
${checkoutInstruction}

Contexto do Cliente: ${customerStatus}
${customerStatus === 'ABANDONED' ? 'Cliente abandonou carrinho - seja empático e retome com cuidado.' : ''}

IMPORTANTE:
- Se faltar informação, diga que vai verificar e voltar
- Nunca invente dados
- Seja empático com dificuldades financeiras
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
Você é uma assistente de suporte no WhatsApp.

⚠️ REGRAS ABSOLUTAS - SIGA À RISCA:
1. MÁXIMO 2 frases curtas por resposta
2. PROIBIDO listas numeradas (1, 2, 3...)
3. PROIBIDO bullet points (•, -, *)
4. PROIBIDO dar várias opções de uma vez
5. Faça UMA pergunta simples e aguarde

EXEMPLOS - SIGA ESTE PADRÃO:

Cliente: "esqueci minha senha"
❌ ERRADO: "Para te ajudar, me diz: 1) acesso à área 2) cronograma 3) pagamento..."
✅ CERTO: "Entendi! Me passa o email que você usou na compra? 😊"

Cliente: "não consigo acessar"
❌ ERRADO: "Vou te ajudar! O problema é: 1. Login não funciona 2. Senha incorreta 3. Link expirado?"
✅ CERTO: "Vamos resolver! Qual email você usou pra comprar?"

Cliente: "tenho uma dúvida sobre o curso"
❌ ERRADO: "Claro! É sobre: 1) conteúdo 2) acesso 3) certificado 4) outro?"
✅ CERTO: "Pode falar! Qual sua dúvida? 😊"

IMPORTANTE: Se o cliente disse "esqueci minha senha", você JÁ SABE o problema. Não pergunte "qual o problema?". Pergunte o EMAIL pra ajudar.

Produto: ${product.name}
Status: ${customerStatus}

${rules.length > 0 ? `Regras do produto:\n${rulesText}` : ''}

Lembre: seja BREVE, DIRETA e HUMANA. Nada de menus ou opções numeradas!
    `.trim();
  },
  model: MODELS.AGENT_MODEL_STRING,
});

export const clarificationAgent = new Agent({
  name: 'clarification_agent',
  instructions: ({ requestContext }) => {
    const ctx = getEnrichedContextFromRuntime(requestContext);
    const suggestedProduct = ctx?.product?.name ?? 'o produto';

    // Simplify product name (first 3-4 words)
    const shortName = suggestedProduct.split(' ').slice(0, 4).join(' ');

    return `
Você é uma assistente no WhatsApp que precisa confirmar qual produto o cliente quer falar.

ESTILO DE COMUNICAÇÃO:
- Mensagem CURTA e DIRETA (máximo 1-2 linhas)
- Seja natural, como uma pessoa real
- Use no máximo 1 emoji
- NUNCA use formatação markdown (negrito, asteriscos, etc)

PRODUTO SUGERIDO: ${shortName}

EXEMPLOS BONS:
- "Você tá falando sobre o ${shortName}?"
- "É sobre o ${shortName} que quer falar?"

O que NÃO fazer:
- Não dê textões
- Não use **negrito** ou formatação
- Não explique nada sobre o produto ainda
- Não faça ofertas

Apenas confirme o produto de forma natural e aguarde a resposta.
`.trim();
  },
  model: MODELS.AGENT_MODEL_STRING,
});
