import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

const messageConsolidatorInputSchema = z.object({
  current_message: z.string().describe('Current user message'),
  conversation_history: z.string().describe('Recent conversation history'),
});

const messageConsolidatorOutputSchema = z.object({
  has_pending_messages: z.boolean().describe('True if user has unresponded previous messages'),
  pending_message_count: z.number().describe('Number of unresponded messages'),
  consolidated_context: z.string().optional().describe('Consolidated context from all pending messages'),
  should_acknowledge_wait: z.boolean().describe('True if agent should acknowledge the wait'),
  estimated_urgency: z.enum(['low', 'medium', 'high']).describe('Urgency level based on wait time and message content'),
});

// Urgency indicators
const urgencyPatterns = {
  high: [
    /urgente/i,
    /emergência/i,
    /socorro/i,
    /help/i,
    /please/i,
    /por favor{2,}/i,
    /\?{3,}/,  // Multiple question marks
    /!{3,}/,   // Multiple exclamation marks
  ],
  medium: [
    /aguardando/i,
    /esperando/i,
    /oi\??$/i,
    /olá\??$/i,
    /alguém\?/i,
    /pode me ajudar/i,
  ],
};

export const message_consolidator = createTool({
  id: 'message-consolidator',
  description: 'Detects and consolidates multiple user messages sent without response',
  inputSchema: messageConsolidatorInputSchema,
  outputSchema: messageConsolidatorOutputSchema,
  execute: async (inputData) => {
    const { current_message, conversation_history } = inputData;

    if (!conversation_history) {
      return {
        has_pending_messages: false,
        pending_message_count: 0,
        should_acknowledge_wait: false,
        estimated_urgency: 'low' as const,
      };
    }

    const lines = conversation_history.split('\n').filter(l => l.trim());

    // Find consecutive user messages at the end (before current)
    const userMessages: string[] = [];
    let lastAssistantIndex = -1;

    // Find the last assistant message
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].startsWith('Assistente:')) {
        lastAssistantIndex = i;
        break;
      }
    }

    // Collect user messages after the last assistant message
    for (let i = lastAssistantIndex + 1; i < lines.length; i++) {
      if (lines[i].startsWith('Usuário:')) {
        const content = lines[i].replace('Usuário: ', '').trim();
        if (content) {
          userMessages.push(content);
        }
      }
    }

    // Remove the current message from the count if it's already in history
    // (it was just added before this tool runs)
    const pendingCount = Math.max(0, userMessages.length - 1);
    const hasPendingMessages = pendingCount > 0;

    // Determine urgency
    let urgency: 'low' | 'medium' | 'high' = 'low';
    const allMessages = userMessages.join(' ').toLowerCase();

    for (const pattern of urgencyPatterns.high) {
      if (pattern.test(allMessages)) {
        urgency = 'high';
        break;
      }
    }

    if (urgency !== 'high') {
      for (const pattern of urgencyPatterns.medium) {
        if (pattern.test(allMessages)) {
          urgency = 'medium';
          break;
        }
      }
    }

    // Also increase urgency based on message count
    if (pendingCount >= 3) {
      urgency = 'high';
    } else if (pendingCount >= 2 && urgency === 'low') {
      urgency = 'medium';
    }

    // Build consolidated context
    let consolidatedContext: string | undefined;
    if (hasPendingMessages) {
      // Get unique messages (remove duplicates)
      const uniqueMessages = [...new Set(userMessages)];

      // Filter out simple follow-ups like "oi", "??", etc. for context
      const substantiveMessages = uniqueMessages.filter(msg => {
        const normalized = msg.toLowerCase().trim();
        // Keep if it's more than just a greeting/nudge
        return normalized.length > 10 ||
          !(/^(oi|olá|oii|ola|alô|hey|hello|\?+|!+|\.+)$/i.test(normalized));
      });

      if (substantiveMessages.length > 0) {
        consolidatedContext = `O cliente enviou ${userMessages.length} mensagens consecutivas:\n${userMessages.map((m, i) => `${i + 1}. "${m}"`).join('\n')}\n\nFoco principal: ${substantiveMessages[0]}`;
      }
    }

    // Should acknowledge wait if user sent 2+ messages
    const shouldAcknowledge = pendingCount >= 1;

    console.log(`\x1b[36m[MessageConsolidator]\x1b[0m Pending: ${pendingCount}, Urgency: ${urgency}, Acknowledge: ${shouldAcknowledge}`);

    return {
      has_pending_messages: hasPendingMessages,
      pending_message_count: pendingCount,
      consolidated_context: consolidatedContext,
      should_acknowledge_wait: shouldAcknowledge,
      estimated_urgency: urgency,
    };
  },
});
