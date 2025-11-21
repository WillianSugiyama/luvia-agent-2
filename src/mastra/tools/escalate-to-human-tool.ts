import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

const escalateToHumanInputSchema = z.object({
  conversation_id: z.string().describe('ID único da conversa'),
  reason: z.enum([
    'no_info',           // Sem informação suficiente
    'risk_detected',     // Risco de segurança detectado
    'user_requested',    // Usuário pediu atendente humano
    'sentiment_negative', // Sentimento muito negativo
    'pii_leak',          // Vazamento de PII detectado
    'hallucination',     // Alucinação grave detectada
    'unauthorized_promise', // Promessa não autorizada
  ]).describe('Motivo da escalação'),
  context: z.object({
    customer_phone: z.string().optional(),
    customer_email: z.string().optional(),
    customer_name: z.string().optional(),
    product_id: z.string().optional(),
    product_name: z.string().optional(),
    team_id: z.string(),
    last_messages: z.array(z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string(),
    })).optional(),
    additional_info: z.string().optional(),
  }),
  webhook_url: z.string().optional().describe('URL do webhook para notificação (usa env se não fornecido)'),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
});

const escalateToHumanOutputSchema = z.object({
  success: z.boolean(),
  ticket_id: z.string(),
  escalation_time: z.string(),
  webhook_called: z.boolean(),
  webhook_response: z.object({
    status: z.number(),
    message: z.string(),
  }).optional(),
  error: z.string().optional(),
});

// Mapeamento de razões para descrições amigáveis
const REASON_DESCRIPTIONS: Record<string, string> = {
  no_info: 'Informação insuficiente para responder',
  risk_detected: 'Risco de segurança detectado',
  user_requested: 'Cliente solicitou atendente humano',
  sentiment_negative: 'Sentimento negativo detectado',
  pii_leak: 'Vazamento de dados sensíveis',
  hallucination: 'Resposta com informações incorretas',
  unauthorized_promise: 'Promessa não autorizada detectada',
};

export const escalate_to_human_tool = createTool({
  id: 'escalate_to_human',
  description: 'Escala a conversa para um atendente humano via webhook, passando todo o contexto necessário',
  inputSchema: escalateToHumanInputSchema,
  outputSchema: escalateToHumanOutputSchema,
  execute: async (inputData, context) => {
    const logger = context?.mastra?.logger;
    const { conversation_id, reason, context: escalationContext, webhook_url, priority } = inputData;

    const ticketId = `ESC-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const escalationTime = new Date().toISOString();

    if (logger) {
      logger.info(`[Escalation] Creating human escalation ticket - ticket: ${ticketId}, reason: ${reason}, priority: ${priority}`);
    }

    // Preparar payload para webhook
    const webhookPayload = {
      ticket_id: ticketId,
      escalation_time: escalationTime,
      priority,
      reason: {
        code: reason,
        description: REASON_DESCRIPTIONS[reason] || reason,
      },
      customer: {
        phone: escalationContext.customer_phone,
        email: escalationContext.customer_email,
        name: escalationContext.customer_name,
      },
      product: {
        id: escalationContext.product_id,
        name: escalationContext.product_name,
      },
      team_id: escalationContext.team_id,
      conversation: {
        id: conversation_id,
        last_messages: escalationContext.last_messages || [],
        additional_info: escalationContext.additional_info,
      },
      metadata: {
        source: 'luvia-agent',
        version: '1.0',
      },
    };

    // Determinar URL do webhook
    const targetWebhookUrl = webhook_url || process.env.ESCALATION_WEBHOOK_URL;

    if (!targetWebhookUrl) {
      if (logger) {
        logger.warn(`[Escalation] No webhook URL configured, ticket created but not sent - ticket: ${ticketId}`);
      }

      return {
        success: true,
        ticket_id: ticketId,
        escalation_time: escalationTime,
        webhook_called: false,
        error: 'No webhook URL configured - ticket created locally only',
      };
    }

    // Chamar webhook
    try {
      const response = await fetch(targetWebhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Ticket-ID': ticketId,
          'X-Priority': priority,
        },
        body: JSON.stringify(webhookPayload),
      });

      const responseText = await response.text();

      if (logger) {
        logger.info(`[Escalation] Webhook called successfully - ticket: ${ticketId}, status: ${response.status}`);
      }

      return {
        success: response.ok,
        ticket_id: ticketId,
        escalation_time: escalationTime,
        webhook_called: true,
        webhook_response: {
          status: response.status,
          message: responseText.substring(0, 200), // Limita tamanho da resposta
        },
      };
    } catch (error: any) {
      if (logger) {
        logger.error(`[Escalation] Webhook call failed - ticket: ${ticketId}, error: ${error.message}`);
      }

      return {
        success: false,
        ticket_id: ticketId,
        escalation_time: escalationTime,
        webhook_called: true,
        error: `Webhook call failed: ${error.message}`,
      };
    }
  },
});
