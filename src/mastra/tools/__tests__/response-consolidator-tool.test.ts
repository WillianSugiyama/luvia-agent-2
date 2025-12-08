import { describe, it, expect, vi } from 'vitest';
import { response_consolidator } from '../response-consolidator-tool';

// Silence console.log during tests
vi.spyOn(console, 'log').mockImplementation(() => {});

describe('response_consolidator', () => {
  describe('Multiple Message Detection', () => {
    it('detects triple newlines as message separators', async () => {
      const result = await response_consolidator.execute({
        response: 'Primeira mensagem.\n\n\nSegunda mensagem.\n\n\nTerceira mensagem.',
      });

      expect(result.original_message_count).toBe(3);
      expect(result.warnings).toContain('Detected 3 potential separate messages');
    });

    it('consolidates triple newlines to double', async () => {
      const result = await response_consolidator.execute({
        response: 'Olá!\n\n\nAqui está a informação.\n\n\nQualquer coisa me avisa.',
      });

      expect(result.consolidated_response).not.toContain('\n\n\n');
      expect(result.was_consolidated).toBe(true);
    });

    it('handles single message correctly', async () => {
      const result = await response_consolidator.execute({
        response: 'Esta é uma mensagem simples sem quebras excessivas.',
      });

      expect(result.original_message_count).toBe(1);
      expect(result.warnings.filter(w => w.includes('Detected'))).toHaveLength(0);
    });

    it('preserves double newlines for paragraphs', async () => {
      const result = await response_consolidator.execute({
        response: 'Primeiro parágrafo.\n\nSegundo parágrafo.',
      });

      expect(result.consolidated_response).toContain('\n\n');
      expect(result.original_message_count).toBe(1);
    });
  });

  describe('Response Length Management', () => {
    it('truncates response exceeding max_length', async () => {
      const longResponse = 'Esta é uma frase. '.repeat(100);
      const result = await response_consolidator.execute({
        response: longResponse,
        max_length: 500,
      });

      expect(result.consolidated_response.length).toBeLessThanOrEqual(500);
      expect(result.warnings.some(w => w.includes('exceeds max length'))).toBe(true);
    });

    it('truncates at sentence boundary', async () => {
      const result = await response_consolidator.execute({
        response: 'Primeira frase completa. Segunda frase também completa. Terceira frase aqui.',
        max_length: 60,
      });

      // Should end with proper punctuation
      expect(result.consolidated_response).toMatch(/[.!?]$/);
    });

    it('handles response under max_length', async () => {
      const result = await response_consolidator.execute({
        response: 'Resposta curta.',
        max_length: 1000,
      });

      expect(result.consolidated_response).toBe('Resposta curta.');
      expect(result.warnings.every(w => !w.includes('exceeds'))).toBe(true);
    });

    it('uses default max_length of 1000', async () => {
      const response950 = 'a'.repeat(950) + '.';
      const result = await response_consolidator.execute({
        response: response950,
      });

      // Should not warn about length
      expect(result.warnings.every(w => !w.includes('exceeds'))).toBe(true);
    });
  });

  describe('Whitespace Cleanup', () => {
    it('removes excessive whitespace within paragraphs', async () => {
      const result = await response_consolidator.execute({
        response: 'Texto   com    muitos     espaços.',
      });

      expect(result.consolidated_response).not.toMatch(/  /);
    });

    it('trims leading and trailing whitespace', async () => {
      const result = await response_consolidator.execute({
        response: '   Texto com espaços ao redor.   ',
      });

      expect(result.consolidated_response).toBe('Texto com espaços ao redor.');
    });

    it('removes empty paragraphs', async () => {
      const result = await response_consolidator.execute({
        response: 'Parágrafo um.\n\n\n\n\nParágrafo dois.',
      });

      expect(result.consolidated_response).toBe('Parágrafo um.\n\nParágrafo dois.');
    });
  });

  describe('Duplicate Punctuation', () => {
    it('removes duplicate periods', async () => {
      const result = await response_consolidator.execute({
        response: 'Fim da frase..',
      });

      expect(result.consolidated_response).not.toContain('..');
    });

    it('removes duplicate exclamation marks', async () => {
      const result = await response_consolidator.execute({
        response: 'Incrível!!',
      });

      expect(result.consolidated_response).not.toContain('!!');
    });

    it('removes duplicate question marks', async () => {
      const result = await response_consolidator.execute({
        response: 'Você entendeu??',
      });

      expect(result.consolidated_response).not.toContain('??');
    });
  });

  describe('Emoji Detection', () => {
    it('warns about excessive emojis', async () => {
      const result = await response_consolidator.execute({
        response: 'Olá! 😊🎉🔥💯🚀 Tudo bem?',
      });

      expect(result.warnings.some(w => w.includes('Excessive emojis'))).toBe(true);
    });

    it('does not warn for few emojis', async () => {
      const result = await response_consolidator.execute({
        response: 'Olá! 😊 Tudo bem?',
      });

      expect(result.warnings.every(w => !w.includes('emoji'))).toBe(true);
    });
  });

  describe('Real World Scenarios', () => {
    it('consolidates multiple message response', async () => {
      const multiMessageResponse = `Olá!



Como posso ajudar?



Estou aqui para você.`;

      const result = await response_consolidator.execute({
        response: multiMessageResponse,
      });

      expect(result.original_message_count).toBe(3);
      expect(result.was_consolidated).toBe(true);
      expect(result.consolidated_response).not.toContain('\n\n\n');
    });

    it('preserves essential information', async () => {
      const result = await response_consolidator.execute({
        response: 'O link de acesso é: https://curso.com/acesso. Use o código ABC123.',
      });

      expect(result.consolidated_response).toContain('https://curso.com/acesso');
      expect(result.consolidated_response).toContain('ABC123');
    });

    it('handles checkout link properly', async () => {
      const result = await response_consolidator.execute({
        response: 'Aqui está seu link de checkout: https://pay.hotmart.com/ABC123',
      });

      expect(result.consolidated_response).toContain('https://pay.hotmart.com/ABC123');
    });
  });

  describe('Edge Cases', () => {
    it('handles empty response', async () => {
      const result = await response_consolidator.execute({
        response: '',
      });

      expect(result.consolidated_response).toBe('');
      expect(result.original_message_count).toBe(1);
    });

    it('handles response with special characters', async () => {
      const result = await response_consolidator.execute({
        response: 'O preço é R$ 99,90 (com desconto de 10%).',
      });

      expect(result.consolidated_response).toContain('R$ 99,90');
      expect(result.consolidated_response).toContain('10%');
    });

    it('handles single character response', async () => {
      const result = await response_consolidator.execute({
        response: '.',
      });

      expect(result.consolidated_response).toBe('.');
    });
  });
});
