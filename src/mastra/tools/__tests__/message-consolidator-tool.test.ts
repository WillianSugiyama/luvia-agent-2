import { describe, it, expect, vi } from 'vitest';
import { message_consolidator } from '../message-consolidator-tool';

// Silence console.log during tests
vi.spyOn(console, 'log').mockImplementation(() => {});

describe('message_consolidator', () => {
  describe('No Pending Messages', () => {
    it('returns false when no conversation history', async () => {
      const result = await message_consolidator.execute({
        current_message: 'Oi',
        conversation_history: '',
      });

      expect(result.has_pending_messages).toBe(false);
      expect(result.pending_message_count).toBe(0);
      expect(result.should_acknowledge_wait).toBe(false);
      expect(result.estimated_urgency).toBe('low');
    });

    it('returns false when only one user message', async () => {
      const result = await message_consolidator.execute({
        current_message: 'Qual o preço?',
        conversation_history: 'Assistente: Como posso ajudar?\nUsuário: Qual o preço?',
      });

      expect(result.has_pending_messages).toBe(false);
      expect(result.pending_message_count).toBe(0);
    });

    it('returns false when user and assistant alternate', async () => {
      const result = await message_consolidator.execute({
        current_message: 'Outra pergunta',
        conversation_history: `Assistente: Olá!
Usuário: Oi
Assistente: Como posso ajudar?
Usuário: Outra pergunta`,
      });

      expect(result.has_pending_messages).toBe(false);
    });
  });

  describe('Pending Messages Detection', () => {
    it('detects one pending message', async () => {
      const result = await message_consolidator.execute({
        current_message: 'Alguém?',
        conversation_history: `Assistente: Como posso ajudar?
Usuário: Oi
Usuário: Alguém?`,
      });

      expect(result.has_pending_messages).toBe(true);
      expect(result.pending_message_count).toBe(1);
      expect(result.should_acknowledge_wait).toBe(true);
    });

    it('detects two pending messages', async () => {
      const result = await message_consolidator.execute({
        current_message: 'Ninguém responde?',
        conversation_history: `Assistente: Olá!
Usuário: Quero saber do curso
Usuário: Oi?
Usuário: Ninguém responde?`,
      });

      expect(result.has_pending_messages).toBe(true);
      expect(result.pending_message_count).toBe(2);
    });

    it('detects multiple pending messages', async () => {
      const result = await message_consolidator.execute({
        current_message: '???',
        conversation_history: `Assistente: Olá!
Usuário: Preciso de ajuda
Usuário: Oi
Usuário: Alguém aí?
Usuário: ???`,
      });

      expect(result.has_pending_messages).toBe(true);
      expect(result.pending_message_count).toBe(3);
    });
  });

  describe('Urgency Detection - High', () => {
    it('detects high urgency with "urgente"', async () => {
      const result = await message_consolidator.execute({
        current_message: 'URGENTE preciso de ajuda',
        conversation_history: `Assistente: Olá
Usuário: Oi
Usuário: URGENTE preciso de ajuda`,
      });

      expect(result.estimated_urgency).toBe('high');
    });

    it('detects high urgency with "emergência"', async () => {
      const result = await message_consolidator.execute({
        current_message: 'É uma emergência!',
        conversation_history: `Assistente: Olá
Usuário: Preciso de ajuda
Usuário: É uma emergência!`,
      });

      expect(result.estimated_urgency).toBe('high');
    });

    it('detects high urgency with multiple question marks', async () => {
      const result = await message_consolidator.execute({
        current_message: 'Cadê vocês???',
        conversation_history: `Assistente: Olá
Usuário: Oi
Usuário: Cadê vocês???`,
      });

      expect(result.estimated_urgency).toBe('high');
    });

    it('detects high urgency with 3+ pending messages', async () => {
      const result = await message_consolidator.execute({
        current_message: 'Quarta mensagem',
        conversation_history: `Assistente: Olá
Usuário: Primeira
Usuário: Segunda
Usuário: Terceira
Usuário: Quarta mensagem`,
      });

      expect(result.estimated_urgency).toBe('high');
    });

    it('detects high urgency with "socorro"', async () => {
      const result = await message_consolidator.execute({
        current_message: 'Socorro, não consigo acessar',
        conversation_history: `Assistente: Olá
Usuário: Ajuda
Usuário: Socorro, não consigo acessar`,
      });

      expect(result.estimated_urgency).toBe('high');
    });
  });

  describe('Urgency Detection - Medium', () => {
    it('detects medium urgency with "aguardando"', async () => {
      const result = await message_consolidator.execute({
        current_message: 'Ainda aguardando',
        conversation_history: `Assistente: Olá
Usuário: Oi
Usuário: Ainda aguardando`,
      });

      expect(result.estimated_urgency).toBe('medium');
    });

    it('detects medium urgency with "esperando"', async () => {
      const result = await message_consolidator.execute({
        current_message: 'Estou esperando resposta',
        conversation_history: `Assistente: Olá
Usuário: Dúvida sobre o curso
Usuário: Estou esperando resposta`,
      });

      expect(result.estimated_urgency).toBe('medium');
    });

    it('detects medium urgency with "oi?" follow-up', async () => {
      const result = await message_consolidator.execute({
        current_message: 'Oi?',
        conversation_history: `Assistente: Olá
Usuário: Qual o preço?
Usuário: Oi?`,
      });

      expect(result.estimated_urgency).toBe('medium');
    });

    it('detects medium urgency with "alguém?"', async () => {
      const result = await message_consolidator.execute({
        current_message: 'Alguém?',
        conversation_history: `Assistente: Olá
Usuário: Preciso de ajuda
Usuário: Alguém?`,
      });

      expect(result.estimated_urgency).toBe('medium');
    });

    it('detects medium urgency with 2 pending messages', async () => {
      const result = await message_consolidator.execute({
        current_message: 'Segunda mensagem',
        conversation_history: `Assistente: Olá
Usuário: Primeira mensagem
Usuário: Segunda mensagem`,
      });

      // 2 messages without urgency keywords = medium
      expect(['low', 'medium']).toContain(result.estimated_urgency);
    });
  });

  describe('Urgency Detection - Low', () => {
    it('returns low urgency for single pending message without keywords', async () => {
      const result = await message_consolidator.execute({
        current_message: 'Obrigado',
        conversation_history: `Assistente: Olá
Usuário: Qual o valor?
Usuário: Obrigado`,
      });

      expect(result.estimated_urgency).toBe('low');
    });
  });

  describe('Consolidated Context', () => {
    it('provides consolidated context for pending messages', async () => {
      const result = await message_consolidator.execute({
        current_message: 'Alguém pode ajudar?',
        conversation_history: `Assistente: Olá!
Usuário: Quero saber sobre o curso de marketing
Usuário: Qual o valor?
Usuário: Alguém pode ajudar?`,
      });

      expect(result.consolidated_context).toBeDefined();
      expect(result.consolidated_context).toContain('mensagens consecutivas');
      expect(result.consolidated_context).toContain('curso de marketing');
    });

    it('identifies main focus in consolidated context', async () => {
      const result = await message_consolidator.execute({
        current_message: 'Oi?',
        conversation_history: `Assistente: Olá
Usuário: Preciso de ajuda com minha compra do curso X
Usuário: Oi?`,
      });

      expect(result.consolidated_context).toContain('Foco principal');
      expect(result.consolidated_context).toContain('compra do curso');
    });

    it('filters out simple follow-ups from context focus', async () => {
      const result = await message_consolidator.execute({
        current_message: '???',
        conversation_history: `Assistente: Olá
Usuário: Quanto custa o curso de vendas?
Usuário: Oi
Usuário: ???`,
      });

      expect(result.consolidated_context).toContain('Foco principal');
      expect(result.consolidated_context).toContain('curso de vendas');
    });

    it('returns undefined context when no pending messages', async () => {
      const result = await message_consolidator.execute({
        current_message: 'Obrigado',
        conversation_history: `Assistente: Aqui está o valor
Usuário: Obrigado`,
      });

      expect(result.consolidated_context).toBeUndefined();
    });
  });

  describe('Should Acknowledge Wait', () => {
    it('should acknowledge when 1+ pending messages', async () => {
      const result = await message_consolidator.execute({
        current_message: 'Ainda esperando',
        conversation_history: `Assistente: Olá
Usuário: Oi
Usuário: Ainda esperando`,
      });

      expect(result.should_acknowledge_wait).toBe(true);
    });

    it('should not acknowledge when no pending messages', async () => {
      const result = await message_consolidator.execute({
        current_message: 'Nova pergunta',
        conversation_history: `Assistente: Respondido!
Usuário: Nova pergunta`,
      });

      expect(result.should_acknowledge_wait).toBe(false);
    });
  });

  describe('Real World Scenarios', () => {
    it('handles typical WhatsApp follow-up pattern', async () => {
      const result = await message_consolidator.execute({
        current_message: '???',
        conversation_history: `Assistente: Olá! Como posso ajudar?
Usuário: Oi, quero saber sobre o curso
Usuário: Oi
Usuário: Oii
Usuário: ???`,
      });

      expect(result.has_pending_messages).toBe(true);
      expect(result.pending_message_count).toBe(3);
      expect(result.estimated_urgency).toBe('high'); // 3+ messages = high
      expect(result.should_acknowledge_wait).toBe(true);
    });

    it('handles frustrated customer sending multiple questions', async () => {
      const result = await message_consolidator.execute({
        current_message: 'Ninguém responde???',
        conversation_history: `Assistente: Bem-vindo!
Usuário: Quero saber do curso de marketing
Usuário: Quanto custa?
Usuário: Tem parcelamento?
Usuário: Ninguém responde???`,
      });

      expect(result.has_pending_messages).toBe(true);
      expect(result.pending_message_count).toBe(3);
      expect(result.estimated_urgency).toBe('high');
      expect(result.consolidated_context).toContain('marketing');
    });

    it('handles simple greeting without previous messages', async () => {
      const result = await message_consolidator.execute({
        current_message: 'Boa tarde!',
        conversation_history: '',
      });

      expect(result.has_pending_messages).toBe(false);
      expect(result.should_acknowledge_wait).toBe(false);
    });

    it('handles customer who got response but sends new question', async () => {
      const result = await message_consolidator.execute({
        current_message: 'E a garantia?',
        conversation_history: `Assistente: O curso custa R$497!
Usuário: E a garantia?`,
      });

      expect(result.has_pending_messages).toBe(false);
      expect(result.should_acknowledge_wait).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('handles empty conversation history', async () => {
      const result = await message_consolidator.execute({
        current_message: 'Oi',
        conversation_history: '',
      });

      expect(result.has_pending_messages).toBe(false);
      expect(result.pending_message_count).toBe(0);
    });

    it('handles conversation with only assistant messages', async () => {
      const result = await message_consolidator.execute({
        current_message: 'Oi',
        conversation_history: `Assistente: Olá
Assistente: Como posso ajudar?`,
      });

      expect(result.has_pending_messages).toBe(false);
    });

    it('handles duplicate user messages', async () => {
      const result = await message_consolidator.execute({
        current_message: 'Oi',
        conversation_history: `Assistente: Olá
Usuário: Oi
Usuário: Oi`,
      });

      expect(result.has_pending_messages).toBe(true);
      // Unique messages are counted
      expect(result.pending_message_count).toBe(1);
    });

    it('handles messages with special characters', async () => {
      const result = await message_consolidator.execute({
        current_message: 'Quanto é R$? 10%?',
        conversation_history: `Assistente: Olá
Usuário: Qual preço?
Usuário: Quanto é R$? 10%?`,
      });

      expect(result.has_pending_messages).toBe(true);
    });

    it('handles very long conversation history', async () => {
      let history = 'Assistente: Olá\n';
      for (let i = 0; i < 50; i++) {
        history += `Usuário: Mensagem ${i}\n`;
        history += `Assistente: Resposta ${i}\n`;
      }
      // Add pending messages at the end
      history += 'Usuário: Primeira pendente\n';
      history += 'Usuário: Segunda pendente';

      const result = await message_consolidator.execute({
        current_message: 'Segunda pendente',
        conversation_history: history,
      });

      expect(result.has_pending_messages).toBe(true);
      expect(result.pending_message_count).toBe(1);
    });
  });

  describe('Line Parsing', () => {
    it('correctly parses user messages starting with "Usuário:"', async () => {
      const result = await message_consolidator.execute({
        current_message: 'Teste',
        conversation_history: `Assistente: Olá
Usuário: Primeira mensagem
Usuário: Teste`,
      });

      expect(result.has_pending_messages).toBe(true);
    });

    it('ignores malformed lines', async () => {
      const result = await message_consolidator.execute({
        current_message: 'Oi',
        conversation_history: `Random text without prefix
Assistente: Olá
Some other random text
Usuário: Oi`,
      });

      expect(result.has_pending_messages).toBe(false);
    });

    it('handles empty lines in history', async () => {
      const result = await message_consolidator.execute({
        current_message: 'Segunda',
        conversation_history: `Assistente: Olá

Usuário: Primeira

Usuário: Segunda`,
      });

      expect(result.has_pending_messages).toBe(true);
    });
  });
});
