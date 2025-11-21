import { createTool } from '@mastra/core/tools';
import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';
import { z } from 'zod';
import type { ConversationState, ProductHistoryItem } from '../../types/luvia.types';

const memory = new Memory({
  storage: new LibSQLStore({
    id: 'conversation-context',
    url: 'file:../mastra.db',
  }),
  options: {
    workingMemory: {
      enabled: true,
      scope: 'resource',
      template: `
# Luvia Conversation State

- conversation_id
- current_product_id
- product_history
- is_confirmed
- last_intent
      `.trim(),
    },
  },
});

const manageConversationContextInputSchema = z.object({
  conversation_id: z.string(),
  newly_identified_product_id: z.string(),
});

const manageConversationContextOutputSchema = z.object({
  current_product_id: z.string(),
  context_switched: z.boolean(),
  history_summary: z.string(),
});

export const loadConversationState = async (
  conversationId: string,
): Promise<ConversationState | null> => {
  const raw = await memory.getWorkingMemory({
    threadId: conversationId,
    resourceId: 'conversation-context',
    memoryConfig: {
      workingMemory: {
        enabled: true,
        scope: 'resource',
        template: '# Luvia Conversation State',
      },
    },
  });

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as ConversationState;
    return parsed;
  } catch {
    return null;
  }
};

const saveConversationState = async (conversationId: string, state: ConversationState) => {
  await memory.updateWorkingMemory({
    threadId: conversationId,
    resourceId: 'conversation-context',
    workingMemory: JSON.stringify(state),
    memoryConfig: {
      workingMemory: {
        enabled: true,
        scope: 'resource',
        template: '# Luvia Conversation State',
      },
    },
  });
};

const createInitialState = (
  conversationId: string,
  productId: string,
): ConversationState => ({
  conversation_id: conversationId,
  current_product_id: productId,
  product_history: [],
  is_confirmed: false,
  last_intent: null,
});

export const manageConversationContext = createTool({
  id: 'manage_conversation_context',
  description:
    'Manages conversation context by tracking the current product and product history across turns.',
  inputSchema: manageConversationContextInputSchema,
  outputSchema: manageConversationContextOutputSchema,
  execute: async (inputData) => {
    const { conversation_id, newly_identified_product_id } = inputData;

    let state = await loadConversationState(conversation_id);
    let contextSwitched = false;

    if (!state) {
      state = createInitialState(conversation_id, newly_identified_product_id);
    } else if (state.current_product_id !== newly_identified_product_id) {
      const historyItem: ProductHistoryItem = {
        id: state.current_product_id ?? '',
        timestamp: Date.now(),
      };

      // Only push if we had a previous product
      if (state.current_product_id) {
        state.product_history = [...state.product_history, historyItem];
      }

      state.current_product_id = newly_identified_product_id;
      contextSwitched = true;
    }

    await saveConversationState(conversation_id, state);

    let historySummary = '';

    if (contextSwitched) {
      const lastHistoryItem = state.product_history[state.product_history.length - 1];

      if (lastHistoryItem?.id) {
        historySummary = `Usuário falou sobre ${lastHistoryItem.id} anteriormente`;
      } else if (state.product_history.length > 0) {
        historySummary = 'Usuário falou sobre outros produtos anteriormente';
      }
    }

    return {
      current_product_id: state.current_product_id ?? newly_identified_product_id,
      context_switched: contextSwitched,
      history_summary: historySummary,
    };
  },
});
