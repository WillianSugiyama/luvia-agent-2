import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

console.log('[Server] Starting server...');
console.log('[Server] NODE_ENV:', process.env.NODE_ENV);
console.log('[Server] PORT:', process.env.PORT);

import { mastra } from './mastra/index';
import { clearConversationState, appendMessageToHistory } from './mastra/tools/manage-conversation-context-tool';

console.log('[Server] Mastra loaded successfully');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Message consolidation system
// Buffers messages from the same user and waits before processing
const MESSAGE_BUFFER_TIMEOUT_MS = 3000; // Wait 3 seconds for more messages

interface BufferedMessage {
  messages: string[];
  timeout: NodeJS.Timeout;
  resolvers: Array<{ resolve: (value: any) => void; reject: (error: any) => void }>;
  requestData: {
    team_id: string;
    phone?: string;
    email?: string;
    user_confirmation?: boolean;
    message_type?: string;
  };
}

const messageBuffer = new Map<string, BufferedMessage>();

const getConversationKey = (team_id: string, phone?: string, email?: string): string => {
  const sanitizedPhone = phone ? phone.replace(/\D/g, '') : undefined;
  return sanitizedPhone || email || `team-${team_id}`;
};

const processBufferedMessages = async (conversationKey: string): Promise<void> => {
  const buffer = messageBuffer.get(conversationKey);
  if (!buffer) {
    console.error(`[Server] Buffer not found for: ${conversationKey}`);
    return;
  }

  // Remove from buffer before processing
  messageBuffer.delete(conversationKey);

  // Consolidate all messages into one
  const consolidatedMessage = buffer.messages.join('\n\n');
  console.log(`[Server] Processing ${buffer.messages.length} consolidated messages for: ${conversationKey}`);
  console.log(`[Server] Consolidated message: "${consolidatedMessage.substring(0, 100)}..."`);

  try {
    const luviaWorkflow = mastra.getWorkflow('luviaWorkflow');
    const run = await luviaWorkflow.createRun();

    const result = await run.start({
      inputData: {
        ...buffer.requestData,
        message: consolidatedMessage,
      },
    });

    console.log('[Server] Workflow result status:', result.status);
    console.log('[Server] Workflow result.result:', JSON.stringify(result.result, null, 2));

    let response: any;

    if (result.status !== 'success') {
      console.error('[Server] Workflow failed:', result.status, (result as any).error);
      response = {
        workflow_run_id: run.runId,
        status: result.status,
        error: result.status === 'failed' ? (result as any).error?.message ?? String((result as any).error) : 'Workflow did not complete successfully',
      };
    } else {
      response = {
        workflow_run_id: run.runId,
        ...result.result,
      };

      // Save assistant response to conversation history
      const assistantResponse = (result.result as any)?.response;
      if (assistantResponse) {
        await appendMessageToHistory(conversationKey, 'assistant', assistantResponse);
        console.log(`[Server] Saved assistant response to history for: ${conversationKey}`);
      }
    }

    // Resolve all waiting requests
    for (const { resolve } of buffer.resolvers) {
      resolve(response);
    }
  } catch (err: any) {
    console.error('Error processing buffered messages:', err);
    // Reject all waiting requests
    for (const { reject } of buffer.resolvers) {
      reject(err);
    }
  }
};

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

app.use(express.static(path.join(__dirname, '..', 'public')));

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/', (_req, res) => {
  res.json({
    service: 'Luvia Chat API',
    version: '1.0.0',
    endpoints: {
      chat: 'POST /api/chat',
      reset: 'POST /api/reset',
      health: 'GET /health'
    }
  });
});

app.post('/api/chat', async (req, res) => {
  try {
    const { team_id, message, phone, email, user_confirmation, message_type } = req.body ?? {};

    if (!team_id || !message) {
      return res.status(400).json({
        error: 'team_id and message are required',
      });
    }

    const conversationKey = getConversationKey(team_id, phone, email);
    const existingBuffer = messageBuffer.get(conversationKey);

    // Create a promise for this specific request
    const waitForResponse = new Promise<any>((resolve, reject) => {
      if (existingBuffer) {
        // Add message to existing buffer and reset timeout
        existingBuffer.messages.push(message);
        existingBuffer.resolvers.push({ resolve, reject });
        clearTimeout(existingBuffer.timeout);

        console.log(`[Server] Added message to buffer for ${conversationKey}. Total: ${existingBuffer.messages.length} messages, ${existingBuffer.resolvers.length} waiting requests`);

        // Create new timeout
        existingBuffer.timeout = setTimeout(() => {
          processBufferedMessages(conversationKey);
        }, MESSAGE_BUFFER_TIMEOUT_MS);
      } else {
        // Create new buffer entry
        console.log(`[Server] Creating new buffer for ${conversationKey}`);

        const timeout = setTimeout(() => {
          processBufferedMessages(conversationKey);
        }, MESSAGE_BUFFER_TIMEOUT_MS);

        messageBuffer.set(conversationKey, {
          messages: [message],
          timeout,
          resolvers: [{ resolve, reject }],
          requestData: {
            team_id,
            phone,
            email,
            user_confirmation,
            message_type,
          },
        });
      }
    });

    // Wait for the response (after timeout or when processing completes)
    const response = await waitForResponse;
    console.log('[Server] Sending response:', JSON.stringify(response, null, 2));
    return res.json(response);
  } catch (err: any) {
    console.error('Error in /api/chat:', err);
    return res.status(500).json({
      error: 'Internal server error',
      details: err?.message ?? String(err),
    });
  }
});

// Reset conversation endpoint
app.post('/api/reset', async (req, res) => {
  try {
    const { team_id, phone, email } = req.body ?? {};

    if (!team_id) {
      return res.status(400).json({
        error: 'team_id is required',
      });
    }

    // Conversation ID follows the same pattern as the workflow
    const sanitizedPhone = phone ? phone.replace(/\D/g, '') : undefined;
    const conversationId = sanitizedPhone || email || `team-${team_id}`;

    const success = await clearConversationState(conversationId);

    if (success) {
      return res.json({
        success: true,
        message: `Conversation reset successfully for: ${conversationId}`,
      });
    } else {
      return res.status(500).json({
        success: false,
        error: 'Failed to reset conversation',
      });
    }
  } catch (err: any) {
    console.error('Error in /api/reset:', err);
    return res.status(500).json({
      error: 'Internal server error',
      details: err?.message ?? String(err),
    });
  }
});

const host = '0.0.0.0';
app.listen(Number(port), host, () => {
  console.log(`Luvia chat server running at http://${host}:${port}`);
});
