import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabaseClient: SupabaseClient | null = null;

const getSupabaseClient = () => {
  if (!supabaseClient) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_KEY;

    if (!url || !key) {
      throw new Error('Supabase credentials are not configured');
    }

    supabaseClient = createClient(url, key);
  }

  return supabaseClient;
};

const greetingHandlerInputSchema = z.object({
  message: z.string(),
  team_id: z.string(),
});

const greetingHandlerOutputSchema = z.object({
  is_greeting: z.boolean(),
  team_name: z.string().optional(),
  response: z.string().optional(),
});

const GREETING_PATTERNS = [
  /^(oi|olá|ola|oie|hey|opa|e aí|e ai|bom dia|boa tarde|boa noite|alô|alo)\s*[!.?]?\s*$/i,
];

export const greeting_handler = createTool({
  id: 'greeting-handler',
  description: 'Detects greetings and generates personalized welcome messages based on team data',
  inputSchema: greetingHandlerInputSchema,
  outputSchema: greetingHandlerOutputSchema,
  execute: async (inputData, context) => {
    const { message, team_id } = inputData;
    const logger = context?.mastra?.logger;

    // Check if message is a greeting
    const isGreeting = GREETING_PATTERNS.some(pattern => pattern.test(message.trim()));

    if (!isGreeting) {
      return {
        is_greeting: false,
      };
    }

    console.log(`\x1b[36m[GreetingHandler]\x1b[0m Detected greeting for team=${team_id}`);

    // Fetch team data
    const supabase = getSupabaseClient();
    const { data: teamData, error } = await supabase
      .from('teams')
      .select('name')
      .eq('id', team_id)
      .single();

    if (error) {
      console.error(`\x1b[31m[GreetingHandler]\x1b[0m Failed to fetch team data: ${error.message}`);
      if (logger) {
        logger.error(`Failed to fetch team data for ${team_id}: ${error.message}`);
      }

      // Return generic greeting if team fetch fails
      return {
        is_greeting: true,
        response: 'Olá! 👋 Como posso te ajudar hoje?',
      };
    }

    const teamName = teamData?.name || 'nossa equipe';
    const response = `Olá! 👋 Bem-vindo(a) ao suporte da ${teamName}. Como posso te ajudar hoje?`;

    console.log(`\x1b[32m[GreetingHandler]\x1b[0m Generated personalized greeting for team="${teamName}"`);
    if (logger) {
      logger.info(`Generated greeting for team ${teamName}`);
    }

    return {
      is_greeting: true,
      team_name: teamName,
      response,
    };
  },
});
