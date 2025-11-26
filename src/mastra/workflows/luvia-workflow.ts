import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { inputSchema as luviaInputSchema } from '../../schemas/input.schema';
import { validate_security_layer } from '../tools/security-tool';
import { advanced_product_search } from '../tools/advanced-product-search-tool';
import { manageConversationContext, loadConversationState, updatePurchasedProducts, setActiveSupportProduct, setPendingContextSwitch, setPendingProductConfirmation, clearPendingProductConfirmation } from '../tools/manage-conversation-context-tool';
import { get_enriched_context } from '../tools/get-enriched-context-tool';
import { interpret_user_message } from '../tools/interpret-message-tool';
import { detect_pii_tool } from '../tools/detect-pii-tool';
import { validate_promises_tool } from '../tools/validate-promises-tool';
import { escalate_to_human_tool } from '../tools/escalate-to-human-tool';
import { greeting_handler } from '../tools/greeting-handler-tool';
import { fetch_customer_purchases } from '../tools/fetch-customer-purchases-tool';
import { multi_product_clarification } from '../tools/multi-product-clarification-tool';
import { fetch_customer_products } from '../tools/fetch-customer-products-tool';
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
  // Multi-product clarification flag
  needs_multi_product_clarification: z.boolean().optional(),
  multi_product_clarification_message: z.string().optional(),
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

    // 2. Check for greetings (early return if detected)
    const greetingResult = await greeting_handler.execute(
      { message: safeMessage, team_id },
      { requestContext, mastra }
    ) as { is_greeting: boolean; team_name?: string; response?: string };

    if (greetingResult.is_greeting && greetingResult.response) {
      console.log(`[Step 1] Greeting detected - returning welcome message`);
      if (logger) {
        logger.info(`[Step 1] Greeting detected for team ${greetingResult.team_name}`);
      }

      // Return a minimal enriched context with the greeting response
      // We'll use a dummy product_id since it's required by schema
      return {
        original_message: message,
        sanitized_message: safeMessage,
        conversation_id: conversationId,
        team_id,
        customer_phone: sanitizedPhone,
        customer_email: email,
        product_id: 'greeting-response',
        product_name: 'Saudação',
        enriched_context: {
          product: {
            name: 'Saudação',
            price: '',
            checkout_link: '',
            description: greetingResult.response,
          },
          customer_status: 'new',
          rules: [],
          sales_strategy: {
            framework: 'greeting',
            instruction: greetingResult.response,
            cta_suggested: '',
            should_offer: false,
          },
        },
        is_ambiguous: false,
        needs_confirmation: false,
        intent: {
          interaction_type: 'greeting',
          has_clear_product: false,
          normalized_query: safeMessage,
        },
      };
    }

    // 3. Load Previous State
    const previousState = await loadConversationState(conversationId);

    // 3.5. Check for pending product confirmation (PRIORITY)
    if (previousState?.pending_product_confirmation) {
      console.log(`[Step 3.5] Pending product confirmation detected - suggested product: "${previousState.pending_product_confirmation.suggested_product_name}"`);

      // DON'T clear the pending confirmation yet - Step 2 needs it!
      // We'll clear it after the productHistoryConfirmationAgent processes the response

      // Load enriched context for the suggested product
      const enrichedContext = await get_enriched_context.execute(
        {
          product_id: previousState.pending_product_confirmation.suggested_product_id,
          team_id,
          customer_phone: sanitizedPhone ?? '',
          user_intent: safeMessage,
        },
        { requestContext, mastra }
      ) as { product: { name: string; price: string; checkout_link: string; description?: string }; customer_status: string; rules: string[]; sales_strategy: { framework: string; instruction: string; cta_suggested: string; should_offer: boolean } };

      // Use enriched product name (from database) instead of cached name
      // This ensures we always have the most up-to-date product name
      const productName = enrichedContext.product.name || previousState.pending_product_confirmation.suggested_product_name;

      console.log(`[Step 3.5] ✅ Product loaded: "${productName}" (price: ${enrichedContext.product.price})`);
      console.log(`[Step 3.5] Customer status: ${enrichedContext.customer_status}`);

      // Return enriched context with pending confirmation flag
      // Step 2 will use productHistoryConfirmationAgent to interpret the user's response
      return {
        original_message: message,
        sanitized_message: safeMessage,
        conversation_id: conversationId,
        team_id,
        customer_phone: sanitizedPhone,
        customer_email: email,
        product_id: previousState.pending_product_confirmation.suggested_product_id,
        product_name: productName, // Use the enriched product name
        enriched_context: enrichedContext,
        is_ambiguous: false,
        needs_confirmation: false,
        intent: {
          interaction_type: 'confirmation_response',
          has_clear_product: true,
          normalized_query: safeMessage,
        },
        needs_multi_product_clarification: false,
      };
    }

    // 4. Interpret Intent
    const intent = await interpret_user_message.execute(
      {
        message: safeMessage,
        previous_product_name: previousState?.current_product_id,
      },
      { requestContext, mastra }
    ) as { is_clarification_response: boolean; has_clear_product: boolean; product_name: string | null; normalized_query: string; interaction_type: string };

    console.log(`[Step 1] User message: "${safeMessage}"`);
    console.log(`[Step 1] Intent interpreted - type: ${intent.interaction_type}, has_clear_product: ${intent.has_clear_product}, product_name: "${intent.product_name}"`);

    // 5. Check Customer Products FIRST (before embedding search)
    let customerProducts: any[] = [];
    let shouldSkipEmbeddingSearch = false;
    let earlyReturnForProductSelection: any = null;
    let preSelectedProduct: { product_id: string; product_name: string } | null = null;

    if (sanitizedPhone && !user_confirmation) {
      console.log(`[Step 5] Checking customer products for phone: ${sanitizedPhone}`);

      // For pricing intents, only fetch ABANDONED products (not approved/refund)
      // Customer asking "quanto custa" should see abandoned carts, not purchased products
      const isPricingIntent = intent.interaction_type === 'pricing';
      const eventTypesFilter = isPricingIntent ? ['abandoned'] : undefined;

      if (isPricingIntent) {
        console.log(`[Step 5] Pricing intent detected - filtering for abandoned products only`);
      }

      const customerProductsResult = await fetch_customer_products.execute(
        { team_id, customer_phone: sanitizedPhone, event_types_filter: eventTypesFilter },
        { requestContext, mastra }
      ) as { has_products: boolean; products: any[]; total_count: number };

      customerProducts = customerProductsResult.products;

      if (customerProductsResult.has_products && customerProducts.length > 0) {
        console.log(`[Step 5] Customer has ${customerProducts.length} product(s)`);

        // Ask for product selection UNLESS it's clearly about purchasing a new product
        // When customer has products in history and asks about price, support, upgrade, refund, etc.
        // they're likely asking about products they already have
        const shouldAskAboutExistingProducts = intent.interaction_type !== 'purchase';

        if (shouldAskAboutExistingProducts && !previousState?.active_support_product_id) {
          // Case 1: Customer has exactly 1 product - ask for confirmation first
          if (customerProducts.length === 1) {
            const singleProduct = customerProducts[0];

            // Debug: Check if product_name is empty
            if (!singleProduct.product_name || singleProduct.product_name.trim() === '') {
              console.error(`[Step 5] ⚠️ ERROR: product_name is EMPTY for product_id: ${singleProduct.product_id}`);
              console.error(`[Step 5] Full product object:`, JSON.stringify(singleProduct, null, 2));
            }

            console.log(`[Step 5] Customer has 1 product - asking for confirmation: "${singleProduct.product_name}" (UUID: ${singleProduct.product_id}, platform: ${singleProduct.product_id_plataforma})`);

            // Set pending confirmation in state
            await setPendingProductConfirmation(conversationId, {
              suggested_product_id: singleProduct.product_id,
              suggested_product_name: singleProduct.product_name || 'produto',
              event_type: singleProduct.event_type,
              reason: 'single_product',
              timestamp: Date.now(),
            });

            // Build confirmation question based on event type
            const eventTypeText = singleProduct.event_type === 'approved'
              ? 'que você já comprou'
              : singleProduct.event_type === 'abandoned'
                ? 'no seu carrinho'
                : singleProduct.event_type === 'refund'
                  ? 'que você solicitou reembolso'
                  : 'no seu histórico';

            // Use product name or fallback
            const productDisplayName = singleProduct.product_name && singleProduct.product_name.trim() !== ''
              ? singleProduct.product_name
              : 'um produto';

            const confirmationMessage = `Olá! Vi que você tem ${productDisplayName === 'um produto' ? productDisplayName : `o produto **${productDisplayName}**`} ${eventTypeText}. Seria sobre esse produto que você quer falar? 😊`;

            console.log(`[Step 5] Confirmation message: ${confirmationMessage}`);

            // Early return with confirmation message
            earlyReturnForProductSelection = {
              original_message: message,
              sanitized_message: safeMessage,
              conversation_id: conversationId,
              team_id,
              customer_phone: sanitizedPhone,
              customer_email: email,
              product_id: '',
              product_name: '',
              enriched_context: {
                product: { name: '', price: '', checkout_link: '' },
                customer_status: 'UNKNOWN',
                rules: [],
                sales_strategy: {
                  framework: 'Genérico',
                  instruction: confirmationMessage,
                  cta_suggested: '',
                  should_offer: false,
                },
              },
              is_ambiguous: false,
              needs_confirmation: true,
              intent: {
                interaction_type: intent.interaction_type,
                has_clear_product: false,
                normalized_query: intent.normalized_query,
              },
              needs_multi_product_clarification: false,
              multi_product_clarification_message: confirmationMessage,
            };

            shouldSkipEmbeddingSearch = true;
          }
          // Case 2: Customer has 2+ products - ask which one
          else {
            console.log(`[Step 5] Customer has ${customerProducts.length} products - needs clarification`);

            // Build clarification message listing customer's products
            const productsList = customerProducts
              .map((p, i) => {
                // Debug: log event_type to identify unexpected values
                console.log(`[Step 5] Product "${p.product_name}" has event_type: "${p.event_type}" (type: ${typeof p.event_type})`);

                // Map event type to user-friendly label
                let statusLabel = 'Desconhecido';
                if (p.event_type === 'approved') {
                  statusLabel = 'Aprovado';
                } else if (p.event_type === 'abandoned') {
                  statusLabel = 'Carrinho Abandonado';
                } else if (p.event_type === 'refund') {
                  statusLabel = 'Reembolsado';
                } else {
                  console.warn(`[Step 5] ⚠️ Unexpected event_type: "${p.event_type}" for product "${p.product_name}"`);
                  statusLabel = `Desconhecido (${p.event_type})`;
                }

                return `${i + 1}. **${p.product_name}** (${statusLabel})`;
              })
              .join('\n');

            const clarificationMessage = `Olá! Vi que você tem os seguintes produtos:\n\n${productsList}\n\nSobre qual produto você gostaria de falar? 😊`;

            // Early return with clarification
            earlyReturnForProductSelection = {
              original_message: message,
              sanitized_message: safeMessage,
              conversation_id: conversationId,
              team_id,
              customer_phone: sanitizedPhone,
              customer_email: email,
              product_id: '',
              product_name: '',
              enriched_context: {
                product: { name: '', price: '', checkout_link: '' },
                customer_status: 'UNKNOWN',
                rules: [],
                sales_strategy: {
                  framework: 'Genérico',
                  instruction: '',
                  cta_suggested: '',
                  should_offer: false,
                },
              },
              is_ambiguous: false,
              needs_confirmation: false,
              intent: {
                interaction_type: intent.interaction_type,
                has_clear_product: false,
                normalized_query: intent.normalized_query,
              },
              needs_multi_product_clarification: true,
              multi_product_clarification_message: clarificationMessage,
            };

            shouldSkipEmbeddingSearch = true;
          }
        }
      } else {
        console.log(`[Step 5] No customer products found - will proceed to embedding search`);
      }
    }

    // If we need to ask which product, return early
    if (earlyReturnForProductSelection) {
      console.log(`[Step 5] Early return - asking customer to select from ${customerProducts.length} products`);
      return earlyReturnForProductSelection;
    }

    // 6. Product Search (embedding-based, only if not pre-selected from customer products)
    let best_match: { product_id: string; name: string; score: number };
    let is_ambiguous = false;
    let needs_confirmation = false;

    if (preSelectedProduct) {
      // Use pre-selected product from customer_events (Step 5)
      console.log(`[Step 6] SKIPPING embedding search - using pre-selected customer product`);
      best_match = {
        product_id: preSelectedProduct.product_id,
        name: preSelectedProduct.product_name,
        score: 1.0,
      };
      is_ambiguous = false;
      needs_confirmation = false;
    } else {
      // No pre-selected product - run embedding search
      console.log(`[Step 6] Running embedding search`);
      const messageForSearch = intent.product_name || intent.normalized_query || safeMessage;
      console.log(`[Step 6] Search query: "${messageForSearch}"`);

      const productSearchResult = await advanced_product_search.execute(
        {
          message: messageForSearch,
          team_id,
          customer_phone: sanitizedPhone,
        },
        { requestContext, mastra }
      ) as { best_match: { product_id: string; name: string; score: number }; is_ambiguous: boolean; needs_confirmation: boolean; alternatives: any[] };

      best_match = productSearchResult.best_match;
      is_ambiguous = productSearchResult.is_ambiguous;
      needs_confirmation = productSearchResult.needs_confirmation;

      // Resolve ambiguity based on context
      const hasPreviousProduct = !!previousState?.current_product_id;
      const isShortFollowUp =
        safeMessage.length <= 60 &&
        !/\b(curso|produto|congresso|treinamento)\b/i.test(safeMessage) &&
        !/\b(outro|outra|nao e|não é)\b/i.test(safeMessage);

      if (hasPreviousProduct && isShortFollowUp) {
        console.log(`[Step 6] Short follow-up detected - using previous product: ${previousState!.current_product_id}`);
        best_match = {
          product_id: previousState!.current_product_id!,
          name: best_match?.name ?? previousState!.current_product_id!,
          score: 1,
        };
        is_ambiguous = false;
        needs_confirmation = false;
      } else if (intent.has_clear_product) {
        console.log(`[Step 6] Clear product in intent - skipping confirmation`);
        is_ambiguous = false;
        needs_confirmation = false;
      }
    }

    // 7. Manage Conversation Context
    console.log(`[Step 7] Managing conversation context with product_id: ${best_match.product_id}`);
    const conversationContext = await manageConversationContext.execute(
      {
        conversation_id: conversationId,
        newly_identified_product_id: best_match.product_id,
      },
      { requestContext, mastra }
    ) as unknown as { current_product_id: string; context_switched: boolean; history_summary: string };

    const activeProductId = conversationContext.current_product_id;
    console.log(`[Step 7] Active product_id: ${activeProductId}`);

    // 8. Enrich Context
    console.log(`[Step 8] Enriching context for product_id: ${activeProductId}`);
    const enrichedContext = await get_enriched_context.execute(
      {
        product_id: activeProductId,
        team_id,
        customer_phone: sanitizedPhone ?? '',
        user_intent: safeMessage,
      },
      { requestContext, mastra }
    ) as { product: { name: string; price: string; checkout_link: string; description?: string }; customer_status: string; rules: string[]; sales_strategy: { framework: string; instruction: string; cta_suggested: string; should_offer: boolean } };

    console.log(`[Step 8] ✅ Context enriched - product: "${enrichedContext.product.name}", rules: ${enrichedContext.rules.length}, customer_status: ${enrichedContext.customer_status}`);
    if (enrichedContext.rules.length > 0) {
      console.log(`[Step 8] Rules loaded for product "${enrichedContext.product.name}":`);
      enrichedContext.rules.forEach((rule, i) => {
        console.log(`[Step 8]   ${i + 1}. ${rule.substring(0, 80)}${rule.length > 80 ? '...' : ''}`);
      });
    } else {
      console.log(`[Step 8] ⚠️  No rules found for product "${enrichedContext.product.name}"`);
    }

    if (logger) {
      logger.info(`[Step 8] Context enriched - product: ${enrichedContext.product.name}, rules_count: ${enrichedContext.rules.length}, customer_status: ${enrichedContext.customer_status}`);
    }

    // 9. Update purchased products cache in conversation state (keep for backwards compatibility)
    if (enrichedContext.customer_purchased_products.length > 0) {
      await updatePurchasedProducts(conversationId, enrichedContext.customer_purchased_products);
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
      needs_multi_product_clarification: false,
      multi_product_clarification_message: undefined,
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
    requestContext.set('team_id', inputData.team_id);
    requestContext.set('product_id', inputData.product_id);

    // Inject pending confirmation if it exists (for productHistoryConfirmationAgent)
    const conversationState = await loadConversationState(inputData.conversation_id);
    if (conversationState?.pending_product_confirmation) {
      requestContext.set('pending_product_confirmation', conversationState.pending_product_confirmation);
    }

    // Se for saudação, retorna diretamente a resposta pré-formatada
    if (inputData.intent.interaction_type === 'greeting') {
      const greetingResponse = inputData.enriched_context.sales_strategy.instruction;

      if (logger) {
        logger.info('[Step 2] Returning greeting response directly');
      }

      return {
        agent_response: greetingResponse,
        agent_used: 'greetingHandler',
        needs_human_escalation: false,
        context: inputData,
      };
    }

    // Se precisa confirmação de produto (single ou multiple), retorna mensagem diretamente
    // Isso evita que o clarificationAgent sobrescreva a mensagem com placeholder
    if (inputData.needs_confirmation && inputData.multi_product_clarification_message) {
      console.log('[Step 2] Returning product confirmation message directly (avoiding clarificationAgent)');
      if (logger) {
        logger.info('[Step 2] Returning product confirmation message');
      }

      return {
        agent_response: inputData.multi_product_clarification_message,
        agent_used: 'productConfirmation',
        needs_human_escalation: false,
        context: inputData,
      };
    }

    // Se precisa clarificação de múltiplos produtos, retorna mensagem diretamente
    if (inputData.needs_multi_product_clarification && inputData.multi_product_clarification_message) {
      if (logger) {
        logger.info('[Step 2] Returning multi-product clarification message');
      }

      return {
        agent_response: inputData.multi_product_clarification_message,
        agent_used: 'multiProductClarification',
        needs_human_escalation: false,
        context: inputData,
      };
    }

    // Handle pending product confirmation responses
    if (inputData.intent.interaction_type === 'confirmation_response') {
      console.log('[Step 2] Processing confirmation response via productHistoryConfirmationAgent');

      const conversationState = await loadConversationState(inputData.conversation_id);

      if (conversationState?.pending_product_confirmation) {
        // Set pending confirmation in requestContext for the agent
        requestContext.set('pending_product_confirmation', conversationState.pending_product_confirmation);

        if (logger) {
          logger.info(`[Step 2] Routing to productHistoryConfirmationAgent - product: ${conversationState.pending_product_confirmation.suggested_product_name}`);
        }

        try {
          const confirmationAgent = mastra.getAgent('productHistoryConfirmationAgent' as any);
          const result = await confirmationAgent.generate(
            [{ role: 'user', content: inputData.sanitized_message }],
            { requestContext }
          );

          const confirmationText = result.text ?? '';
          console.log(`[Step 2] Confirmation agent response: ${confirmationText.substring(0, 200)}...`);

          // Parse JSON response
          let confirmationResult: { confirmed: boolean; rejected: boolean; user_response_type: string; explanation: string };
          try {
            confirmationResult = JSON.parse(confirmationText);
          } catch (parseError) {
            console.error('[Step 2] Failed to parse confirmation agent response, treating as indecisive');
            confirmationResult = {
              confirmed: false,
              rejected: false,
              user_response_type: 'indecisive',
              explanation: 'Failed to parse response',
            };
          }

          console.log(`[Step 2] Confirmation result: ${confirmationResult.user_response_type} (confirmed=${confirmationResult.confirmed}, rejected=${confirmationResult.rejected})`);

          // Clear pending confirmation now that we've processed it
          await clearPendingProductConfirmation(inputData.conversation_id);

          if (confirmationResult.confirmed) {
            // User confirmed - continue with the suggested product (already loaded in enriched_context)
            console.log('[Step 2] User CONFIRMED - proceeding with suggested product');

            // Route to appropriate agent based on original intent
            // Use the enriched context that was already loaded in Step 1
            const deepAgent = mastra.getAgent('deepAgent' as any);

            // Build a detailed prompt with ALL product information
            const productName = inputData.enriched_context.product.name;
            const productPrice = inputData.enriched_context.product.price;
            const checkoutLink = inputData.enriched_context.product.checkout_link;
            const customerStatus = inputData.enriched_context.customer_status;

            const contextualPrompt = `
CONFIRMAÇÃO DE PRODUTO - O CLIENTE CONFIRMOU QUE QUER FALAR SOBRE ESTE PRODUTO:

PRODUTO:
- Nome: ${productName}
- Preço: ${productPrice}
- Link de Checkout: ${checkoutLink}

CLIENTE:
- Status: ${customerStatus}
- Pergunta Original: "${inputData.sanitized_message}"

CONTEXTO:
O cliente estava perguntando sobre preço ("${inputData.sanitized_message}") e nós perguntamos se ele estava se referindo ao produto "${productName}".
Ele confirmou que SIM, é sobre esse produto.

IMPORTANTE:
- Use o nome REAL do produto: "${productName}"
- Responda diretamente sobre o preço: ${productPrice}
- Se apropriado, ofereça o link de checkout
- NÃO use placeholders como "[PRODUTO SUGERIDO]" - use o nome REAL
            `.trim();

            console.log(`[Step 2] Calling deepAgent with confirmed product: "${productName}"`);
            console.log(`[Step 2] Contextual prompt length: ${contextualPrompt.length} chars`);

            const networkResult = await deepAgent.network(contextualPrompt, { requestContext });
            let response = '';
            let agentUsed = 'deepAgent';
            let chunkCount = 0;

            for await (const chunk of networkResult) {
              chunkCount++;
              console.log(`[Step 2] Chunk #${chunkCount}: type="${chunk.type}"`);

              if (chunk.type === 'network-execution-event-step-finish') {
                response = chunk.payload?.result ?? '';
                console.log(`[Step 2] Got result from step-finish: ${response.length} chars`);
              }
              if (chunk.type === 'routing-agent-end') {
                const payload = chunk.payload as any;
                if (payload?.agentName) {
                  agentUsed = payload.agentName;
                  console.log(`[Step 2] Routed to agent: ${agentUsed}`);
                }
              }

              // Log all chunk types for debugging
              if (chunk.type !== 'network-execution-event-step-finish' && chunk.type !== 'routing-agent-end') {
                console.log(`[Step 2] Other chunk type: ${chunk.type}, has payload: ${!!chunk.payload}`);
              }
            }

            console.log(`[Step 2] Total chunks received: ${chunkCount}`);
            console.log(`[Step 2] Deep agent response length: ${response.length} chars`);
            console.log(`[Step 2] Deep agent response (first 200 chars): ${response.substring(0, 200)}...`);

            return {
              agent_response: response,
              agent_used: agentUsed,
              needs_human_escalation: false,
              context: inputData,
            };
          } else if (confirmationResult.rejected) {
            // User rejected - they want to talk about a different product
            console.log('[Step 2] User REJECTED - they want a different product');

            const clarificationMessage = `Entendi! Sobre qual produto você gostaria de falar?`;

            return {
              agent_response: clarificationMessage,
              agent_used: 'clarificationAgent',
              needs_human_escalation: false,
              context: inputData,
            };
          } else {
            // Indecisive - ask for clarification
            console.log('[Step 2] User INDECISIVE - asking for clarification');

            const clarificationMessage = `Desculpe, não entendi bem. Você gostaria de falar sobre o **${conversationState.pending_product_confirmation.suggested_product_name}**? Por favor, responda com "sim" ou "não". 😊`;

            // Re-set pending confirmation (we didn't clear it because user was indecisive)
            await setPendingProductConfirmation(inputData.conversation_id, conversationState.pending_product_confirmation);

            return {
              agent_response: clarificationMessage,
              agent_used: 'clarificationAgent',
              needs_human_escalation: false,
              context: inputData,
            };
          }
        } catch (error: any) {
          console.error(`[Step 2] Error in productHistoryConfirmationAgent: ${error.message}`);
          if (logger) {
            logger.error(`[Step 2] productHistoryConfirmationAgent error: ${error.message}`);
          }

          // Clear pending confirmation on error
          await clearPendingProductConfirmation(inputData.conversation_id);

          // Fallback to clarification
          return {
            agent_response: 'Desculpe, não consegui processar sua resposta. Pode repetir?',
            agent_used: 'clarificationAgent',
            needs_human_escalation: false,
            context: inputData,
          };
        }
      } else {
        console.warn('[Step 2] confirmation_response intent but no pending_product_confirmation in state!');
        if (logger) {
          logger.warn('[Step 2] confirmation_response intent but no pending confirmation found in state');
        }
      }
    }

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

// Helper function to check if a string is a valid UUID
const isValidUUID = (str: string): boolean => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
};

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

    // Validate PII and Promises in parallel
    const shouldValidatePromises = isValidUUID(context.product_id);

    if (logger && shouldValidatePromises) {
      logger.info(`[Step 3] Validating promises for product_id: ${context.product_id}`);
    } else if (logger) {
      logger.info(`[Step 3] Skipping promise validation - product_id is not a valid UUID: "${context.product_id}"`);
    }

    const [piiResult, promisesResult] = await Promise.all([
      detect_pii_tool.execute(
        { text: agent_response },
        { mastra }
      ) as Promise<{ has_pii: boolean; findings: Array<{ value: string; type: string; masked: string; position: { start: number; end: number } }>; risk_score: number; sanitized_text: string }>,
      shouldValidatePromises
        ? validate_promises_tool.execute(
            {
              response_text: agent_response,
              team_id: context.team_id,
              product_id: context.product_id,
            },
            { mastra }
          ) as Promise<{ is_valid: boolean; unauthorized_promises: Array<{ promise_text: string; reason: string; severity: string }>; authorized_rules_used: string[]; confidence_score: number }>
        : Promise.resolve(null)
    ]);

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

    if (promisesResult && !promisesResult.is_valid) {
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
