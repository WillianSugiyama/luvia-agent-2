import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { inputSchema as luviaInputSchema } from '../../schemas/input.schema';
import { validate_security_layer } from '../tools/security-tool';
import { advanced_product_search } from '../tools/advanced-product-search-tool';
import { manageConversationContext, loadConversationState } from '../tools/manage-conversation-context-tool';
import { get_enriched_context } from '../tools/get-enriched-context-tool';
import { interpret_user_message } from '../tools/interpret-message-tool';
import { search_knowledge_tool } from '../tools/search-knowledge-tool';
import { relevanceScorer } from '../scorers/relevance-scorer';
import {
  validate_agent_output,
  validateAgentOutputInputSchema,
  validateAgentOutputOutputSchema,
} from './validate-agent-output-step';

const build_agent_response = createStep({
  id: 'build_agent_response',
  description:
    'Runs security checks, product search, context management, enrichment, and routes to the appropriate agent.',
  inputSchema: luviaInputSchema,
  outputSchema: validateAgentOutputInputSchema,
  execute: async ({ inputData, mastra, runtimeContext }) => {
    const logger = mastra?.logger;

    if (!inputData) {
      throw new Error('Input data not found for build_agent_response step');
    }

    if (!mastra) {
      throw new Error('Mastra instance is required for build_agent_response');
    }

    if (logger) {
      logger.info({ inputData }, 'Workflow Started: build_agent_response');
    }

    const { team_id, message, phone, email, user_confirmation } = inputData;

    // 1. Security Layer
    const securityResult = await validate_security_layer.execute(
      {
        context: {
          team_id,
          phone,
          message,
        },
        runtimeContext,
        mastra,
      } as any,
    );

    const safeMessage = securityResult.sanitized_message;
    const sanitizedPhone = phone ? phone.replace(/\D/g, '') : undefined;
    const conversationId = sanitizedPhone || email || `team-${team_id}`;

    if (logger) {
      logger.info(`Security check passed. Conversation ID: ${conversationId}`);
    }

    // 2. Load Previous State
    const previousState = await loadConversationState(conversationId);

    // 3. Interpret Intent
    const intent = await interpret_user_message.execute(
      {
        context: {
          message: safeMessage,
          previous_product_name: previousState?.current_product_id,
        },
        runtimeContext,
        mastra,
      } as any,
    );

    if (logger) {
      logger.info({ intent }, 'User Intent Interpreted');
    }

    const messageForSearch = intent.normalized_query || safeMessage;

    // 4. Advanced Product Search
    const productSearchResult = await advanced_product_search.execute(
      {
        context: {
          message: messageForSearch,
          team_id,
          customer_phone: sanitizedPhone,
        },
        runtimeContext,
        mastra,
      } as any,
    );

    let { best_match, is_ambiguous, needs_confirmation } = productSearchResult;

    if (logger) {
      logger.info({ best_match, is_ambiguous, needs_confirmation }, 'Product Search Result');
    }

    // Logic to resolve ambiguity based on context
    const hasPreviousProduct = !!previousState?.current_product_id;
    const isShortFollowUp =
      safeMessage.length <= 60 &&
      !/\b(curso|produto|congresso|treinamento)\b/i.test(safeMessage) &&
      !/\b(outro|outra|nao e|não é|não é esse|nao e esse)\b/i.test(safeMessage);

    const isExplicitProductStatement = /estou (fazendo|no|na|cursando)|faço o|faço a|sou aluno/i.test(
      safeMessage.toLowerCase(),
    );

    if (hasPreviousProduct && isShortFollowUp) {
      best_match = {
        product_id: previousState!.current_product_id!,
        name: best_match?.name ?? previousState!.current_product_id!,
        score: 1,
      };
      is_ambiguous = false;
      needs_confirmation = false;
      if (logger) logger.info('Ambiguity resolved via previous context.');
    } else if (intent.has_clear_product || isExplicitProductStatement) {
      is_ambiguous = false;
      needs_confirmation = false;
      if (logger) logger.info('Ambiguity resolved via explicit intent.');
    }

    // 5. Manage Conversation Context
    const conversationContext = await manageConversationContext.execute(
      {
        context: {
          conversation_id: conversationId,
          newly_identified_product_id: best_match.product_id,
        },
        runtimeContext,
        mastra,
      } as any,
    );

    const activeProductId = conversationContext.current_product_id;

    // 6. Enrich Context (Product Rules, Sales Strategy, Customer Status)
    const enrichedContext = await get_enriched_context.execute(
      {
        context: {
          product_id: activeProductId,
          team_id,
          customer_phone: sanitizedPhone ?? '',
          user_intent: safeMessage,
        },
        runtimeContext,
        mastra,
      } as any,
    );

    let agentResponseText = '';
    let requiredLink: string | null = enrichedContext.product.checkout_link || null;

    const shouldClarify =
      (is_ambiguous || needs_confirmation || !best_match?.product_id) && !user_confirmation;

    if (shouldClarify) {
      if (logger) logger.info('Routing to Clarification Agent');
      const clarificationAgent = mastra.getAgent('clarificationAgent' as any);

      const clarificationResult = await clarificationAgent.generate(
        [
          {
            role: 'user',
            content: safeMessage,
          },
        ],
        {
          format: 'mastra',
          runtimeContext,
        },
      );

      agentResponseText = clarificationResult.text ?? '';
      requiredLink = null;
    } else {
      runtimeContext.set('enriched_context', enrichedContext);
      runtimeContext.set('intent', intent);

      const status = (enrichedContext.customer_status || 'UNKNOWN').toUpperCase();
      const isSupportStatus = status === 'APPROVED' || status === 'REFUND';
      const interactionType = intent.interaction_type;

      const isSupportIntent =
        interactionType === 'support' ||
        interactionType === 'refund' ||
        interactionType === 'upgrade';

      let agentKey: 'supportAgent' | 'salesAgent' | 'docsAgent';

      // Routing Logic
      if (isSupportIntent || isSupportStatus) {
        if (logger) logger.info('Intent identified as SUPPORT/DOCS. Attempting Knowledge Search...');

        // 7. Knowledge Search (RAG)
        const knowledge = await search_knowledge_tool.execute({
          context: {
            query: safeMessage,
            product_id: activeProductId,
            team_id,
          },
          mastra,
        } as any);

        if (knowledge.results.length > 0) {
          agentKey = 'docsAgent';
          runtimeContext.set('knowledge_results', knowledge.results);
          if (logger) logger.info(`Routing to Docs Agent with ${knowledge.results.length} context chunks.`);
        } else {
          agentKey = 'supportAgent';
          if (logger) logger.info('Routing to Support Agent (Fallback/General Rules).');
        }
      } else {
        agentKey = 'salesAgent';
        if (logger) logger.info('Routing to Sales Agent.');
      }

      const agent = mastra.getAgent(agentKey as any);

      const result = await agent.generate(
        [
          {
            role: 'user',
            content: safeMessage,
          },
        ],
        {
          format: 'mastra',
          runtimeContext,
        },
      );

      agentResponseText = result.text ?? '';
      
      // Log raw output
      if (logger) {
        logger.info(`Agent (${agentKey}) raw output: ${agentResponseText}`);
      }
      
      // Calculate Relevance Score
      relevanceScorer.score(safeMessage, agentResponseText).then((score) => {
         if (logger) {
             logger.info(`Relevance Score: ${score}`);
         }
      }).catch(() => {}); // Non-blocking
    }

    return {
      original_query: message,
      agent_response: agentResponseText,
      required_link: requiredLink,
    };
  },
});

const luviaWorkflow = createWorkflow({
  id: 'luvia-workflow',
  inputSchema: luviaInputSchema,
  outputSchema: validateAgentOutputOutputSchema,
})
  .then(build_agent_response)
  .then(validate_agent_output);

luviaWorkflow.commit();

export { luviaWorkflow };
