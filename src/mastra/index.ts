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
import { Observability } from "@mastra/observability";
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const currentFile = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFile);
const dbPath = join(currentDir, '..', '..', '.mastra', 'mastra.db');

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
  },
  storage: new LibSQLStore({
    id: 'main',
    // stores observability, scores, traces into persistent file storage
    url: `file:${dbPath}`,
  }),
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
  observability: new Observability({
    default: { enabled: true },
  }),
});
