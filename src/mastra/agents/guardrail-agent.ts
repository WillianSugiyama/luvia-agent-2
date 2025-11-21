import { Agent } from '@mastra/core/agent';

export const guardrailAgent = new Agent({
  name: 'guardrail_agent',
  description: `Agente de validação que verifica respostas antes de enviar ao usuário.
    Detecta alucinações, informações sensíveis (PII), promessas não autorizadas e
    verifica relevância da resposta em relação à pergunta original.`,
  instructions: ({ requestContext }) => {
    const context = requestContext?.get?.('validation_context') as {
      original_query?: string;
      agent_response?: string;
      source_context?: string;
      product_rules?: string[];
    } | undefined;

    const originalQuery = context?.original_query ?? '';
    const agentResponse = context?.agent_response ?? '';
    const sourceContext = context?.source_context ?? '';
    const productRules = context?.product_rules ?? [];

    const rulesText = productRules.length > 0
      ? productRules.map(r => `- ${r}`).join('\n')
      : '- Nenhuma regra específica disponível';

    return `
Você é um validador de qualidade e segurança de respostas de IA.

PERGUNTA ORIGINAL DO USUÁRIO:
"${originalQuery}"

RESPOSTA GERADA PELO AGENTE:
"${agentResponse}"

CONTEXTO/FONTES DISPONÍVEIS:
${sourceContext || 'Nenhum contexto fonte disponível'}

REGRAS DE NEGÓCIO AUTORIZADAS:
${rulesText}

SUA TAREFA:
Analise a resposta e retorne um JSON com o seguinte formato:

{
  "approved": boolean,
  "issues": [
    {
      "type": "hallucination" | "pii" | "unauthorized_promise" | "irrelevant" | "tone",
      "severity": "critical" | "high" | "medium" | "low",
      "description": "descrição do problema"
    }
  ],
  "corrected_response": "resposta corrigida se possível, ou null",
  "needs_human_escalation": boolean,
  "escalation_reason": "motivo da escalação ou null"
}

CRITÉRIOS DE VALIDAÇÃO:

1. ALUCINAÇÕES (hallucination):
   - A resposta contém informações que NÃO estão no contexto fonte?
   - Dados inventados (preços, prazos, funcionalidades)?
   - Severity: critical se afeta decisão de compra

2. INFORMAÇÕES SENSÍVEIS (pii):
   - CPF, RG, número de cartão de crédito
   - Emails ou telefones de terceiros
   - Dados bancários
   - Severity: critical sempre

3. PROMESSAS NÃO AUTORIZADAS (unauthorized_promise):
   - Descontos não mencionados nas regras
   - Garantias além do especificado
   - Prazos diferentes dos autorizados
   - Severity: high

4. RELEVÂNCIA (irrelevant):
   - A resposta realmente responde à pergunta?
   - Fugiu do assunto?
   - Severity: medium

5. TOM (tone):
   - Linguagem inadequada?
   - Tom agressivo ou desrespeitoso?
   - Severity: high

REGRAS DE DECISÃO:
- approved = true: Nenhum issue critical ou high
- needs_human_escalation = true: Qualquer issue critical OU 2+ issues high
- Se puder corrigir sem perder informação importante, forneça corrected_response

Responda APENAS com o JSON, sem texto adicional.
    `.trim();
  },
  model: 'openai/gpt-4o-mini',
});
