import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { inputSchema as luviaInputSchema } from '../../schemas/input.schema';
import { validate_security_layer } from '../tools/security-tool';
import { advanced_product_search } from '../tools/advanced-product-search-tool';
import { manageConversationContext, loadConversationState } from '../tools/manage-conversation-context-tool';
import { get_enriched_context } from '../tools/get-enriched-context-tool';
import { interpret_user_message } from '../tools/interpret-message-tool';
import { detect_pii_tool } from '../tools/detect-pii-tool';
import { validate_promises_tool } from '../tools/validate-promises-tool';
import { escalate_to_human_tool } from '../tools/escalate-to-human-tool';
import { relevanceScorer } from '../scorers/relevance-scorer';

// Schema intermediário para passar dados entre steps
const enrichedContextSchema = z.object({
  original_message: z.string(),
  sanitized_message: z.string(),
  conversation_id: z.string(),
  team_id: z.string(),
  customer_phone: z.string().optional(),
  customer_email: z.string().optional(),
  product_id: z.string(),
  product_name: z.string(),
  enriched_context: z.object({
    product: z.object({
      name: z.string(),
      price: z.string(),
      checkout_link: z.string(),
      description: z.string().optional(),
    }),
    customer_status: z.string(),
    rules: z.array(z.string()),
    sales_strategy: z.object({
      framework: z.string(),
      instruction: z.string(),
      cta_suggested: z.string(),
      should_offer: z.boolean().default(true),
    }),
  }),
  is_ambiguous: z.boolean(),
  needs_confirmation: z.boolean(),
  intent: z.object({
    interaction_type: z.string(),
    has_clear_product: z.boolean(),
    normalized_query: z.string().optional(),
  }),
});

const deepAgentOutputSchema = z.object({
  agent_response: z.string(),
  agent_used: z.string(),
  needs_human_escalation: z.boolean(),
  escalation_reason: z.string().optional(),
  context: enrichedContextSchema,
});

const finalOutputSchema = z.object({
  response: z.string(),
  workflow_status: z.enum(['success', 'escalated', 'error']),
  agent_used: z.string(),
  needs_human: z.boolean(),
  ticket_id: z.string().optional(),
  validation_issues: z.array(z.object({
    type: z.string(),
    severity: z.string(),
    description: z.string(),
  })).optional(),
});

// Step 1: Security + Enrichment
const security_and_enrich_step = createStep({
  id: 'security_and_enrich',
  description: 'Valida segurança, identifica produto e enriquece contexto',
  inputSchema: luviaInputSchema,
  outputSchema: enrichedContextSchema,
  execute: async ({ inputData, mastra, requestContext }) => {
    const logger = (mastra as any)?.logger;

    if (!inputData || !mastra) {
      throw new Error('Input data and Mastra instance are required');
    }

    const { team_id, message, phone, email, user_confirmation } = inputData;

    // 1. Security Layer
    const securityResult = await validate_security_layer.execute(
      { team_id, phone, message },
      { requestContext, mastra }
    ) as { is_safe: boolean; sanitized_message: string };

    const safeMessage = securityResult.sanitized_message;
    const sanitizedPhone = phone ? phone.replace(/\D/g, '') : undefined;
    const conversationId = sanitizedPhone || email || `team-${team_id}`;

    if (logger) {
      logger.info(`[Step 1] Security passed - conversationId: ${conversationId}`);
    }

    // 2. Load Previous State
    const previousState = await loadConversationState(conversationId);

    // 3. Interpret Intent
    const intent = await interpret_user_message.execute(
      {
        message: safeMessage,
        previous_product_name: previousState?.current_product_id,
      },
      { requestContext, mastra }
    ) as { is_clarification_response: boolean; has_clear_product: boolean; product_name: string | null; normalized_query: string; interaction_type: string };

    console.log(`[Step 1] User message: "${safeMessage}"`);
    console.log(`[Step 1] Intent interpreted - type: ${intent.interaction_type}, has_clear_product: ${intent.has_clear_product}, product_name: "${intent.product_name}"`);

    // 4. Product Search
    // Usar product_name extraído pela LLM quando disponível (mais preciso para embedding)
    const messageForSearch = intent.product_name || intent.normalized_query || safeMessage;
    console.log(`[Step 1] Search query: "${messageForSearch}"`);
    const productSearchResult = await advanced_product_search.execute(
      {
        message: messageForSearch,
        team_id,
        customer_phone: sanitizedPhone,
      },
      { requestContext, mastra }
    ) as { best_match: { product_id: string; name: string; score: number }; is_ambiguous: boolean; needs_confirmation: boolean; alternatives: any[] };

    let { best_match, is_ambiguous, needs_confirmation } = productSearchResult;

    // Resolve ambiguity based on context
    const hasPreviousProduct = !!previousState?.current_product_id;
    const isShortFollowUp =
      safeMessage.length <= 60 &&
      !/\b(curso|produto|congresso|treinamento)\b/i.test(safeMessage) &&
      !/\b(outro|outra|nao e|não é)\b/i.test(safeMessage);

    if (hasPreviousProduct && isShortFollowUp) {
      best_match = {
        product_id: previousState!.current_product_id!,
        name: best_match?.name ?? previousState!.current_product_id!,
        score: 1,
      };
      is_ambiguous = false;
      needs_confirmation = false;
    } else if (intent.has_clear_product) {
      is_ambiguous = false;
      needs_confirmation = false;
    }

    // 5. Manage Conversation Context
    const conversationContext = await manageConversationContext.execute(
      {
        conversation_id: conversationId,
        newly_identified_product_id: best_match.product_id,
      },
      { requestContext, mastra }
    ) as unknown as { current_product_id: string; context_switched: boolean; history_summary: string };

    const activeProductId = conversationContext.current_product_id;

    // 6. Enrich Context
    const enrichedContext = await get_enriched_context.execute(
      {
        product_id: activeProductId,
        team_id,
        customer_phone: sanitizedPhone ?? '',
        user_intent: safeMessage,
      },
      { requestContext, mastra }
    ) as { product: { name: string; price: string; checkout_link: string; description?: string }; customer_status: string; rules: string[]; sales_strategy: { framework: string; instruction: string; cta_suggested: string; should_offer: boolean } };

    if (logger) {
      logger.info(`[Step 1] Context enriched - product: ${enrichedContext.product.name}, rules_count: ${enrichedContext.rules.length}, customer_status: ${enrichedContext.customer_status}`);
    }

    return {
      original_message: message,
      sanitized_message: safeMessage,
      conversation_id: conversationId,
      team_id,
      customer_phone: sanitizedPhone,
      customer_email: email,
      product_id: activeProductId,
      product_name: enrichedContext.product.name,
      enriched_context: enrichedContext,
      is_ambiguous: is_ambiguous && !user_confirmation,
      needs_confirmation: needs_confirmation && !user_confirmation,
      intent: {
        interaction_type: intent.interaction_type,
        has_clear_product: intent.has_clear_product,
        normalized_query: intent.normalized_query,
      },
    };
  },
});

// Step 2: Deep Agent Routing via Network
const deep_agent_routing_step = createStep({
  id: 'deep_agent_routing',
  description: 'Deep Agent analisa e roteia para o sub-agente apropriado usando network()',
  inputSchema: enrichedContextSchema,
  outputSchema: deepAgentOutputSchema,
  execute: async ({ inputData, mastra, requestContext }) => {
    const logger = (mastra as any)?.logger;

    if (!inputData || !mastra) {
      throw new Error('Input data and Mastra instance are required');
    }

    // Injetar contexto no requestContext para os sub-agentes
    requestContext.set('enriched_context', inputData.enriched_context);
    requestContext.set('intent', inputData.intent);

    // Se ambíguo, usa clarificationAgent diretamente
    if (inputData.is_ambiguous || inputData.needs_confirmation) {
      if (logger) {
        logger.info('[Step 2] Routing to clarificationAgent (ambiguous)');
      }

      const clarificationAgent = mastra.getAgent('clarificationAgent' as any);
      const result = await clarificationAgent.generate(
        [{ role: 'user', content: inputData.sanitized_message }],
        { requestContext }
      );

      return {
        agent_response: result.text ?? '',
        agent_used: 'clarificationAgent',
        needs_human_escalation: false,
        context: inputData,
      };
    }

    // Usar Deep Agent com network() para roteamento inteligente
    const deepAgent = mastra.getAgent('deepAgent' as any);

    if (logger) {
      logger.info(`[Step 2] Invoking Deep Agent network - product: ${inputData.product_name}, intent: ${inputData.intent.interaction_type}`);
    }

    try {
      // Preparar prompt com contexto
      const contextualPrompt = `
CONTEXTO DO CLIENTE:
- Produto: ${inputData.product_name}
- Status: ${inputData.enriched_context.customer_status}
- Intenção detectada: ${inputData.intent.interaction_type}

MENSAGEM DO CLIENTE:
"${inputData.sanitized_message}"

Analise e responda apropriadamente.
      `.trim();

      // Usar network() para roteamento automático
      const networkResult = await deepAgent.network(contextualPrompt, {
        requestContext,
      });

      // Processar eventos do network
      let response = '';
      let agentUsed = 'deepAgent';

      for await (const chunk of networkResult) {
        if (logger) {
          logger.debug(`[Step 2] Network event - type: ${chunk.type}`);
        }

        if (chunk.type === 'agent-execution-event-text-delta') {
          // Acumular texto
        }

        if (chunk.type === 'network-execution-event-step-finish') {
          response = chunk.payload?.result ?? '';
        }

        if (chunk.type === 'routing-agent-end') {
          // Identificar qual agente foi escolhido
          const payload = chunk.payload as any;
          if (payload?.agentName) {
            agentUsed = payload.agentName;
          }
        }
      }

      if (logger) {
        logger.info(`[Step 2] Deep Agent completed - agent_used: ${agentUsed}, response_length: ${response.length}`);
      }

      return {
        agent_response: response,
        agent_used: agentUsed,
        needs_human_escalation: false,
        context: inputData,
      };
    } catch (error: any) {
      if (logger) {
        logger.error(`[Step 2] Deep Agent error - ${error.message}`);
      }

      // Fallback para dontKnowAgent
      const dontKnowAgent = mastra.getAgent('dontKnowAgent' as any);
      const fallbackResult = await dontKnowAgent.generate(
        [{ role: 'user', content: inputData.sanitized_message }],
        { requestContext }
      );

      return {
        agent_response: fallbackResult.text ?? '',
        agent_used: 'dontKnowAgent',
        needs_human_escalation: true,
        escalation_reason: `Deep Agent error: ${error.message}`,
        context: inputData,
      };
    }
  },
});

// Step 3: Guardrail Validation
const guardrail_validation_step = createStep({
  id: 'guardrail_validation',
  description: 'Valida resposta por alucinações, PII e promessas não autorizadas',
  inputSchema: deepAgentOutputSchema,
  outputSchema: finalOutputSchema,
  execute: async ({ inputData, mastra, requestContext }) => {
    const logger = (mastra as any)?.logger;

    if (!inputData || !mastra) {
      throw new Error('Input data and Mastra instance are required');
    }

    const { agent_response, agent_used, context, needs_human_escalation, escalation_reason } = inputData;

    // Se já precisa escalar, não valida
    if (needs_human_escalation) {
      // Escalar para humano
      const escalationResult = await escalate_to_human_tool.execute(
        {
          conversation_id: context.conversation_id,
          reason: 'risk_detected',
          context: {
            team_id: context.team_id,
            customer_phone: context.customer_phone,
            product_id: context.product_id,
            product_name: context.product_name,
            additional_info: escalation_reason,
          },
          priority: 'high',
        },
        { mastra }
      ) as { success: boolean; ticket_id: string; escalation_time: string; webhook_called: boolean; };

      return {
        response: agent_response,
        workflow_status: 'escalated' as const,
        agent_used,
        needs_human: true,
        ticket_id: escalationResult.ticket_id,
      };
    }

    // 1. Detectar PII
    const piiResult = await detect_pii_tool.execute(
      { text: agent_response },
      { mastra }
    ) as { has_pii: boolean; findings: Array<{ value: string; type: string; masked: string; position: { start: number; end: number } }>; risk_score: number; sanitized_text: string };

    // 2. Validar promessas
    const promisesResult = await validate_promises_tool.execute(
      {
        response_text: agent_response,
        team_id: context.team_id,
        product_id: context.product_id,
      },
      { mastra }
    ) as { is_valid: boolean; unauthorized_promises: Array<{ promise_text: string; reason: string; severity: string }>; authorized_rules_used: string[]; confidence_score: number };

    // Coletar issues
    const validationIssues: Array<{ type: string; severity: string; description: string }> = [];

    if (piiResult.has_pii) {
      for (const finding of piiResult.findings) {
        validationIssues.push({
          type: 'pii',
          severity: 'critical',
          description: `PII detectado: ${finding.type}`,
        });
      }
    }

    if (!promisesResult.is_valid) {
      for (const promise of promisesResult.unauthorized_promises) {
        validationIssues.push({
          type: 'unauthorized_promise',
          severity: promise.severity,
          description: `${promise.promise_text}: ${promise.reason}`,
        });
      }
    }

    // Decidir se precisa escalar
    const hasCriticalIssue = validationIssues.some(i => i.severity === 'critical');
    const hasHighIssues = validationIssues.filter(i => i.severity === 'high').length >= 2;
    const needsEscalation = hasCriticalIssue || hasHighIssues;

    if (needsEscalation) {
      if (logger) {
        logger.warn(`[Step 3] Critical issues detected, escalating - issues_count: ${validationIssues.length}`);
      }

      const escalationResult = await escalate_to_human_tool.execute(
        {
          conversation_id: context.conversation_id,
          reason: piiResult.has_pii ? 'pii_leak' : 'unauthorized_promise',
          context: {
            team_id: context.team_id,
            customer_phone: context.customer_phone,
            product_id: context.product_id,
            product_name: context.product_name,
            additional_info: JSON.stringify(validationIssues),
          },
          priority: hasCriticalIssue ? 'urgent' : 'high',
        },
        { mastra }
      ) as { success: boolean; ticket_id: string; escalation_time: string; webhook_called: boolean; };

      // Usar resposta sanitizada se houver PII
      const safeResponse = piiResult.has_pii ? piiResult.sanitized_text : agent_response;

      return {
        response: safeResponse,
        workflow_status: 'escalated' as const,
        agent_used,
        needs_human: true,
        ticket_id: escalationResult.ticket_id,
        validation_issues: validationIssues,
      };
    }

    // Calcular relevance score (não bloqueante)
    relevanceScorer.score(context.sanitized_message, agent_response).then((score) => {
      if (logger) {
        logger.info(`[Step 3] Relevance score - ${score}`);
      }
    }).catch(() => {});

    if (logger) {
      logger.info(`[Step 3] Response validated successfully - agent_used: ${agent_used}, issues_count: ${validationIssues.length}`);
    }

    return {
      response: agent_response,
      workflow_status: 'success' as const,
      agent_used,
      needs_human: false,
      validation_issues: validationIssues.length > 0 ? validationIssues : undefined,
    };
  },
});

// Workflow principal
const luviaWorkflow = createWorkflow({
  id: 'luvia-workflow',
  inputSchema: luviaInputSchema,
  outputSchema: finalOutputSchema,
})
  .then(security_and_enrich_step)
  .then(deep_agent_routing_step)
  .then(guardrail_validation_step);

luviaWorkflow.commit();

export { luviaWorkflow };
