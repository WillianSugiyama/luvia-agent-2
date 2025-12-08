import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

const responseConsolidatorInputSchema = z.object({
  response: z.string().describe('AI response to consolidate'),
  max_length: z.number().optional().describe('Maximum response length (default: 1000)'),
});

const responseConsolidatorOutputSchema = z.object({
  consolidated_response: z.string().describe('Single consolidated response'),
  was_consolidated: z.boolean().describe('True if response was modified'),
  original_message_count: z.number().describe('Number of detected separate messages'),
  warnings: z.array(z.string()).describe('Any warnings about the response'),
});

export const response_consolidator = createTool({
  id: 'response-consolidator',
  description: 'Consolidates AI response to ensure single, concise message. Focuses on structural issues (multiple messages, length). Generic phrase prevention should be done via agent instructions.',
  inputSchema: responseConsolidatorInputSchema,
  outputSchema: responseConsolidatorOutputSchema,
  execute: async (inputData) => {
    const { response, max_length = 1000 } = inputData;
    const warnings: string[] = [];

    let consolidated = response;
    let wasConsolidated = false;

    // 0. DETECT AND REMOVE DUPLICATE TEXT (critical fix for streaming issues)
    // Check if the response contains the same text twice (common streaming bug)
    const detectDuplicate = (text: string): { hasDuplicate: boolean; cleanedText: string } => {
      const trimmed = text.trim();
      const len = trimmed.length;

      // Check for exact half duplication (text appears twice)
      if (len >= 20 && len % 2 === 0) {
        const half = len / 2;
        const firstHalf = trimmed.substring(0, half);
        const secondHalf = trimmed.substring(half);
        if (firstHalf === secondHalf) {
          return { hasDuplicate: true, cleanedText: firstHalf };
        }
      }

      // Check for near-duplication (with possible minor differences like whitespace)
      // Split by common patterns that might separate duplicates
      const splitPatterns = [/\n\n+/, /\s{3,}/, /(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÀÂÃÊÔÇ])/];
      for (const pattern of splitPatterns) {
        const parts = trimmed.split(pattern);
        if (parts.length === 2) {
          const part1 = parts[0].trim();
          const part2 = parts[1].trim();
          // Check if parts are very similar (>90% identical)
          if (part1.length > 20 && part2.length > 20) {
            const minLen = Math.min(part1.length, part2.length);
            const maxLen = Math.max(part1.length, part2.length);
            // Length similarity check
            if (minLen / maxLen > 0.8) {
              // Content similarity check (first 50 chars)
              const check1 = part1.substring(0, 50).toLowerCase();
              const check2 = part2.substring(0, 50).toLowerCase();
              if (check1 === check2) {
                return { hasDuplicate: true, cleanedText: part1.length >= part2.length ? part1 : part2 };
              }
            }
          }
        }
      }

      return { hasDuplicate: false, cleanedText: text };
    };

    const duplicateCheck = detectDuplicate(consolidated);
    if (duplicateCheck.hasDuplicate) {
      console.log(`\x1b[33m[ResponseConsolidator]\x1b[0m DUPLICATE TEXT DETECTED - removing duplicate`);
      warnings.push('Duplicate text detected and removed');
      consolidated = duplicateCheck.cleanedText;
      wasConsolidated = true;
    }

    // Count potential separate messages (triple+ newlines indicate message breaks)
    const tripleNewlines = (response.match(/\n{3,}/g) || []).length;
    const originalMessageCount = Math.max(1, tripleNewlines + 1);

    if (originalMessageCount > 1) {
      warnings.push(`Detected ${originalMessageCount} potential separate messages`);
      wasConsolidated = true;
    }

    // 1. Replace triple+ newlines with double newlines (consolidate multiple messages)
    consolidated = consolidated.replace(/\n{3,}/g, '\n\n');

    // 2. Normalize whitespace (but preserve paragraph breaks)
    consolidated = consolidated
      .split('\n\n')
      .map(para => para.replace(/\s+/g, ' ').trim())
      .filter(para => para.length > 0)
      .join('\n\n');

    // 3. Check for excessive length
    if (consolidated.length > max_length) {
      warnings.push(`Response exceeds max length (${consolidated.length} > ${max_length})`);

      // Try to truncate at a natural break point
      const sentences = consolidated.split(/(?<=[.!?])\s+/);
      let truncated = '';
      for (const sentence of sentences) {
        if ((truncated + sentence).length <= max_length - 50) {
          truncated += sentence + ' ';
        } else {
          break;
        }
      }

      if (truncated.length > 100) {
        consolidated = truncated.trim();
        wasConsolidated = true;
      }
    }

    // 4. Remove duplicate punctuation
    consolidated = consolidated.replace(/([.!?])\1+/g, '$1');

    // 5. Final trim
    consolidated = consolidated.trim();

    // 6. Check for excessive emojis
    const emojiCount = (consolidated.match(/[\u{1F300}-\u{1F9FF}]/gu) || []).length;
    if (emojiCount > 3) {
      warnings.push(`Excessive emojis detected (${emojiCount})`);
    }

    console.log(`\x1b[36m[ResponseConsolidator]\x1b[0m Original: ${response.length} chars, Consolidated: ${consolidated.length} chars, Modified: ${wasConsolidated}`);

    return {
      consolidated_response: consolidated,
      was_consolidated: wasConsolidated,
      original_message_count: originalMessageCount,
      warnings,
    };
  },
});
