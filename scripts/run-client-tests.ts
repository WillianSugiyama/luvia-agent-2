
import fs from 'node:fs/promises';
import path from 'node:path';
import { luviaWorkflow } from '../src/mastra/workflows/luvia-workflow';
import { mastra } from '../src/mastra/index';

const INPUT_FILE = path.join(process.cwd(), 'test/teste-clients.md');
const OUTPUT_FILE = path.join(process.cwd(), 'test/test-results-report.md');

interface ClientMessage {
  phone: string;
  date: string;
  message: string;
}

async function parseMarkdown(content: string): Promise<{ teamId: string; messages: ClientMessage[] }> {
  const teamIdMatch = content.match(/\*\*Team ID:\*\* ([a-f0-9-]+)/);
  const teamId = teamIdMatch ? teamIdMatch[1] : '';

  if (!teamId) {
    throw new Error('Team ID not found in markdown file.');
  }

  const messages: ClientMessage[] = [];
  const messageRegex = /### \d+\. Cliente: (\d+)\n\*\*Data:\*\* (.*?)\n> (.*)/g;
  
  let match;
  while ((match = messageRegex.exec(content)) !== null) {
    messages.push({
      phone: match[1],
      date: match[2],
      message: match[3].trim()
    });
  }

  // Also handle multiline messages if needed, or different formats, 
  // but the provided file seems to follow a strict pattern: "> message"
  // If the message spans multiple lines starting with >, we might need a smarter parser.
  // The example shows single lines mostly. " > " indicates blockquote. 
  // Example 47 has multiple ">" lines.
  
  // Let's refine the parser to handle multiple lines starting with >
  // We will split by "### N. Cliente" to get blocks
  
  const betterMessages: ClientMessage[] = [];
  const blocks = content.split(/^### \d+\. Cliente: /gm).slice(1); // Skip preamble

  for (const block of blocks) {
    const phoneMatch = block.match(/^(\d+)/);
    const dateMatch = block.match(/\*\*Data:\*\* (.*)/);
    
    if (phoneMatch) {
      const phone = phoneMatch[1];
      const date = dateMatch ? dateMatch[1].trim() : '';
      
      // Extract all lines starting with >
      const messageLines = block
        .split('\n')
        .filter(line => line.trim().startsWith('>'))
        .map(line => line.replace(/^>\s*/, '').trim());
      
      if (messageLines.length > 0) {
        betterMessages.push({
          phone,
          date,
          message: messageLines.join('\n')
        });
      }
    }
  }

  return { teamId, messages: betterMessages };
}

async function runTests() {
  console.log('Reading test file...');
  const content = await fs.readFile(INPUT_FILE, 'utf-8');
  const { teamId, messages } = await parseMarkdown(content);

  console.log(`Found Team ID: ${teamId}`);
  console.log(`Found ${messages.length} messages.`);

  let report = `# Relatório de Testes de Clientes\n\n**Data do Teste:** ${new Date().toLocaleString()}\n**Total de Mensagens:** ${messages.length}\n\n---`;

  for (const [index, msg] of messages.entries()) {
    console.log(`Processing message ${index + 1}/${messages.length} (Client: ${msg.phone})...`);
    
    const inputData = {
      team_id: teamId,
      message: msg.message,
      phone: msg.phone,
    };

    const startTime = Date.now();
    let result;
    let error;

    try {
      // Using mastra instance logic as per server.ts
      // server.ts uses 'luviaWorkflow' which matches the export name in index.ts key
      const wf = mastra.getWorkflow('luviaWorkflow');

      if (!wf) {
        throw new Error('Workflow not found');
      }

      const run = await wf.createRunAsync();
      const runResult = await run.start({ inputData });
      
      // Mapping the result structure
      // server.ts says: result = await run.start(...)
      // result.status, result.result
      result = runResult.result; 

      // Check for failure at run level
      if (runResult.status !== 'success') {
          throw new Error(runResult.error ? String(runResult.error) : 'Workflow failed');
      }

      // Need to adapt report generation to new result structure
      // result.results['validate_agent_output'] might be nested in runResult.result
      // If result.result IS the output of the last step? No, usually it's the output of the workflow (last step).
      // But let's preserve the logic: if result has .results, use it.
      // Actually, result.result usually contains the final output.
      // But I used `result.results['validate_agent_output']` before.
      
      // Let's assign the full runResult to result for inspection if needed, 
      // but specifically extract the step output we want.
      
      // runResult.results is typically map of stepId -> output.
      
      // Let's update the variable name to avoid confusion.
      // I'll rewrite the block.
      
    } catch (e) {
      error = e;
    }
    const duration = Date.now() - startTime;

    report += `\n\n## Mensagem ${index + 1}\n`;
    report += `- **Cliente:** ${msg.phone}\n`;
    report += `- **Data Original:** ${msg.date}\n`;
    report += `- **Input:** "${msg.message}"\n`;
    report += `- **Duração:** ${duration}ms\n`;

    if (error) {
      report += `- **Status:** ❌ ERRO\n`;
      report += `\n\`\`\`\n${error instanceof Error ? error.stack : error}\n\`\`\`\n`;
    } else if (result) {
       // Adaptation for run.start() result which might return the final output directly or a structure.
       // If using createRunAsync().start(), it returns { status, result, results, error }
       // 'result' is the final output (from the last step).
       // 'results' is the map of step outputs.
       
       // So 'result' variable here is actually holding 'runResult.result' (final output) 
       // OR 'runResult' if I assigned it incorrectly above. 
       // Wait, in my edit above I assigned `result = runResult.result;`.
       // So `result` is the output of the last step (validate_agent_output).
       
       const output = result; // validateAgentOutputOutputSchema
       
       if (output && typeof output.valid === 'boolean') {
         report += `- **Status:** ✅ SUCESSO\n`;
         report += `- **Valid:** ${output.valid ? 'Sim' : 'Não'}\n`;
         report += `- **Reason:** ${output.reason}\n`;
         report += `- **Resposta Final:**\n\n> ${output.corrected_response.replace(/\n/g, '\n> ')}\n`;
         
         if (output.missing_link) {
             report += `\n**⚠️ Aviso:** Link obrigatório estava ausente (Corrigido? ${output.valid ? 'Sim' : 'Não'}).\n`;
         }
       } else {
         report += `- **Status:** ⚠️ FORMATO INESPERADO\n`;
         report += `\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`\n`;
       }
    }
  }

  await fs.writeFile(OUTPUT_FILE, report, 'utf-8');
  console.log(`Report generated at: ${OUTPUT_FILE}`);
}

runTests().catch(console.error);

