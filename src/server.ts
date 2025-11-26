import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mastra } from './mastra/index';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

app.use(express.static(path.join(__dirname, '..', 'public')));

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

app.listen(port, () => {
  console.log(`Luvia chat server running at http://localhost:${port}`);
});
