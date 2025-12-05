import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { luviaWorkflow } from './workflows/luvia-workflow';
import {
  salesAgent,
  supportAgent,
  clarificationAgent,
} from './agents/sales-support-agents';
import { docsAgent } from './agents/docs-agent';
import { dontKnowAgent } from './agents/dont-know-agent';
import { guardrailAgent } from './agents/guardrail-agent';
import { deepAgent } from './agents/deep-agent';
import { productHistoryConfirmationAgent } from './agents/product-history-confirmation-agent';
import { Observability } from "@mastra/observability";
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const currentFile = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFile);
const dbPath = join(currentDir, '..', '..', 'data', 'mastra.db');

// Use LIBSQL_URL env var for cloud database (Turso), fallback to local file
const libsqlUrl = process.env.LIBSQL_URL || `file:${dbPath}`;
console.log('[Mastra] Using LibSQL URL:', libsqlUrl.startsWith('file:') ? 'local file' : 'remote');

export const mastra = new Mastra({
  workflows: { luviaWorkflow },
  agents: {
    salesAgent,
    supportAgent,
    clarificationAgent,
    docsAgent,
    dontKnowAgent,
    guardrailAgent,
    deepAgent,
    productHistoryConfirmationAgent,
  },
  storage: new LibSQLStore({
    id: 'main',
    url: libsqlUrl,
    ...(process.env.LIBSQL_AUTH_TOKEN && { authToken: process.env.LIBSQL_AUTH_TOKEN }),
  }),
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
  observability: new Observability({
    default: { enabled: true },
  }),
});
