import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

const frustrationDetectorInputSchema = z.object({
  message: z.string().describe('User message to analyze'),
  conversation_history: z.string().optional().describe('Recent conversation history'),
});

const frustrationDetectorOutputSchema = z.object({
  is_frustrated: z.boolean().describe('True if user shows signs of frustration'),
  frustration_level: z.enum(['none', 'mild', 'moderate', 'high']).describe('Level of frustration'),
  frustration_indicators: z.array(z.string()).describe('List of detected frustration indicators'),
  recommended_action: z.string().describe('Recommended action for the agent'),
  should_escalate: z.boolean().describe('True if should escalate to human support'),
});

// Frustration patterns with weights
const frustrationPatterns = [
  // High frustration (weight: 3)
  { pattern: /não (funciona|consigo|consegui)/i, weight: 3, indicator: 'Não consegue realizar ação' },
  { pattern: /ninguém (responde|ajuda|atende)/i, weight: 3, indicator: 'Falta de resposta/ajuda' },
  { pattern: /péssim[oa]/i, weight: 3, indicator: 'Adjetivo muito negativo' },
  { pattern: /horrível/i, weight: 3, indicator: 'Adjetivo muito negativo' },
  { pattern: /absurd[oa]/i, weight: 3, indicator: 'Indignação' },
  { pattern: /vergonha/i, weight: 3, indicator: 'Indignação' },
  { pattern: /desist/i, weight: 3, indicator: 'Intenção de desistir' },
  { pattern: /canc?el/i, weight: 3, indicator: 'Intenção de cancelar' },
  { pattern: /reembols/i, weight: 3, indicator: 'Pedido de reembolso' },
  { pattern: /proces+o|advogado|procon|justiça/i, weight: 3, indicator: 'Ameaça legal' },
  { pattern: /roub/i, weight: 3, indicator: 'Acusação de roubo' },
  { pattern: /golpe/i, weight: 3, indicator: 'Acusação de golpe' },

  // Moderate frustration (weight: 2)
  { pattern: /não (entendi|entendo)/i, weight: 2, indicator: 'Confusão' },
  { pattern: /isso não ajud/i, weight: 2, indicator: 'Resposta não útil' },
  { pattern: /já falei|já disse/i, weight: 2, indicator: 'Repetição de informação' },
  { pattern: /não era isso/i, weight: 2, indicator: 'Resposta incorreta' },
  { pattern: /errad[oa]/i, weight: 2, indicator: 'Erro identificado' },
  { pattern: /mesmo problema/i, weight: 2, indicator: 'Problema persistente' },
  { pattern: /ainda não/i, weight: 2, indicator: 'Expectativa não atendida' },
  { pattern: /desde (ontem|semana|mês)/i, weight: 2, indicator: 'Problema duradouro' },
  { pattern: /dias? esperando/i, weight: 2, indicator: 'Longa espera' },
  { pattern: /cansad[oa]/i, weight: 2, indicator: 'Cansaço/exaustão' },
  { pattern: /frust/i, weight: 2, indicator: 'Frustração explícita' },

  // Mild frustration (weight: 1)
  { pattern: /\?{2,}/i, weight: 1, indicator: 'Múltiplas interrogações' },
  { pattern: /!{2,}/i, weight: 1, indicator: 'Múltiplas exclamações' },
  { pattern: /(?:oi|olá|alô)\s*\?/i, weight: 1, indicator: 'Cobrança de resposta' },
  { pattern: /alguém a[ií]/i, weight: 1, indicator: 'Cobrança de resposta' },
  { pattern: /pode me ajudar\??$/i, weight: 1, indicator: 'Pedido de ajuda urgente' },
  { pattern: /urgente/i, weight: 1, indicator: 'Urgência' },
  { pattern: /preciso muito/i, weight: 1, indicator: 'Necessidade forte' },
  { pattern: /por favor{2,}|pfv{2,}/i, weight: 1, indicator: 'Múltiplos pedidos' },
  { pattern: /😤|😡|🤬|😠|💢/i, weight: 1, indicator: 'Emoji de raiva' },
];

// Positive patterns that reduce frustration score
const positivePatterns = [
  { pattern: /obrigad[oa]/i, weight: -1 },
  { pattern: /agradeç/i, weight: -1 },
  { pattern: /grat[oa]|gratidão/i, weight: -1 },
  { pattern: /💛|❤️|🙏|😊|🥰/i, weight: -1 },
  { pattern: /maravilhos[oa]/i, weight: -1 },
  { pattern: /excel[eê]nte/i, weight: -1 },
  { pattern: /consegui!?$/i, weight: -2 },
  { pattern: /resolvido/i, weight: -2 },
  { pattern: /funcionou/i, weight: -2 },
];

export const frustration_detector = createTool({
  id: 'frustration-detector',
  description: 'Detects user frustration level and recommends appropriate response strategy',
  inputSchema: frustrationDetectorInputSchema,
  outputSchema: frustrationDetectorOutputSchema,
  execute: async (inputData) => {
    const { message, conversation_history } = inputData;
    const lowerMessage = message.toLowerCase();

    let totalScore = 0;
    const indicators: string[] = [];

    // Critical indicators that always require escalation
    const criticalIndicators = ['Ameaça legal', 'Acusação de roubo', 'Acusação de golpe'];
    let hasCriticalIndicator = false;

    // Check frustration patterns
    for (const { pattern, weight, indicator } of frustrationPatterns) {
      if (pattern.test(message)) {
        totalScore += weight;
        indicators.push(indicator);
        if (criticalIndicators.includes(indicator)) {
          hasCriticalIndicator = true;
        }
      }
    }

    // Check positive patterns
    for (const { pattern, weight } of positivePatterns) {
      if (pattern.test(message)) {
        totalScore += weight;
      }
    }

    // Analyze conversation history for repeated issues
    if (conversation_history) {
      const historyLines = conversation_history.split('\n');
      const userMessages = historyLines.filter(line => line.startsWith('Usuário:'));

      // Check if user has sent similar messages before (repetition = frustration)
      const recentUserMessages = userMessages.slice(-3);
      for (const prevMsg of recentUserMessages) {
        const prevContent = prevMsg.replace('Usuário: ', '').toLowerCase();
        // Check for similar content (user repeating themselves)
        if (prevContent.length > 10 &&
            (lowerMessage.includes(prevContent.substring(0, 20)) ||
             prevContent.includes(lowerMessage.substring(0, 20)))) {
          totalScore += 2;
          indicators.push('Repetindo mensagem anterior');
          break;
        }
      }

      // Check if user sent multiple messages without AI response
      const lastMessages = historyLines.slice(-5);
      let consecutiveUserMessages = 0;
      for (const line of lastMessages) {
        if (line.startsWith('Usuário:')) {
          consecutiveUserMessages++;
        } else {
          consecutiveUserMessages = 0;
        }
      }
      if (consecutiveUserMessages >= 3) {
        totalScore += 2;
        indicators.push('Múltiplas mensagens sem resposta');
      }
    }

    // Determine frustration level
    let frustrationLevel: 'none' | 'mild' | 'moderate' | 'high' = 'none';
    if (totalScore >= 5) {
      frustrationLevel = 'high';
    } else if (totalScore >= 3) {
      frustrationLevel = 'moderate';
    } else if (totalScore >= 1) {
      frustrationLevel = 'mild';
    }

    // Determine recommended action
    let recommendedAction = '';
    let shouldEscalate = false;

    // Critical indicators always escalate, regardless of frustration level
    if (hasCriticalIndicator) {
      shouldEscalate = true;
      if (frustrationLevel !== 'high') {
        frustrationLevel = 'high'; // Upgrade to high if critical indicator present
      }
    }

    switch (frustrationLevel) {
      case 'high':
        recommendedAction = 'Reconheça a frustração IMEDIATAMENTE. Peça desculpas pelo transtorno. Ofereça solução concreta ou escale para suporte humano. NÃO use frases genéricas.';
        shouldEscalate = true;
        break;
      case 'moderate':
        recommendedAction = 'Demonstre empatia genuína. Foque em resolver o problema específico. Evite respostas automáticas. Se não puder resolver, encaminhe para humano.';
        if (!shouldEscalate) {
          shouldEscalate = indicators.includes('Problema persistente') || indicators.includes('Problema duradouro');
        }
        break;
      case 'mild':
        recommendedAction = 'Responda de forma clara e direta. Evite perguntas desnecessárias. Foque na solução.';
        break;
      default:
        recommendedAction = 'Prossiga normalmente com empatia.';
    }

    const isFrustrated = frustrationLevel !== 'none';

    console.log(`\x1b[${isFrustrated ? '31' : '32'}m[FrustrationDetector]\x1b[0m Level: ${frustrationLevel}, Score: ${totalScore}, Indicators: ${indicators.join(', ') || 'none'}`);

    return {
      is_frustrated: isFrustrated,
      frustration_level: frustrationLevel,
      frustration_indicators: indicators,
      recommended_action: recommendedAction,
      should_escalate: shouldEscalate,
    };
  },
});
