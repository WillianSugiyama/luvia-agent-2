import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

console.log('[Server] Starting server...');
console.log('[Server] NODE_ENV:', process.env.NODE_ENV);
console.log('[Server] PORT:', process.env.PORT);

import { mastra } from './mastra/index';
import { clearConversationState } from './mastra/tools/manage-conversation-context-tool';

console.log('[Server] Mastra loaded successfully');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
    const { team_id, message, phone, email, user_confirmation } = req.body ?? {};

    if (!team_id || !message) {
      return res.status(400).json({
        error: 'team_id and message are required',
      });
    }

    const luviaWorkflow = mastra.getWorkflow('luviaWorkflow');
    const run = await luviaWorkflow.createRun();

    const result = await run.start({
      inputData: {
        team_id,
        message,
        phone,
        email,
        user_confirmation,
      },
    });

    console.log('[Server] Workflow result status:', result.status);
    console.log('[Server] Workflow result.result:', JSON.stringify(result.result, null, 2));

    if (result.status !== 'success') {
      console.error('[Server] Workflow failed:', result.status, (result as any).error);
      return res.status(500).json({
        workflow_run_id: run.runId,
        status: result.status,
        error: result.status === 'failed' ? (result as any).error?.message ?? String((result as any).error) : 'Workflow did not complete successfully',
      });
    }

    const response = {
      workflow_run_id: run.runId,
      ...result.result,
    };

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
