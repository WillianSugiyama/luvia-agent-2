import { describe, it, expect, vi } from 'vitest';
import { frustration_detector } from '../frustration-detector-tool';

// Silence console.log during tests
vi.spyOn(console, 'log').mockImplementation(() => {});

describe('frustration_detector', () => {
  describe('Critical Indicators (Always Escalate)', () => {
    it('escalates legal threat (procon)', async () => {
      const result = await frustration_detector.execute({
        message: 'Vou procurar o procon se não resolverem',
      });

      expect(result.is_frustrated).toBe(true);
      expect(result.frustration_level).toBe('high'); // Critical indicators upgrade to high
      expect(result.frustration_indicators).toContain('Ameaça legal');
      expect(result.should_escalate).toBe(true);
    });

    it('escalates legal threat (advogado)', async () => {
      const result = await frustration_detector.execute({
        message: 'Vou chamar meu advogado',
      });

      expect(result.should_escalate).toBe(true);
      expect(result.frustration_level).toBe('high');
    });

    it('escalates legal threat (justiça)', async () => {
      const result = await frustration_detector.execute({
        message: 'Vou entrar na justiça',
      });

      expect(result.should_escalate).toBe(true);
      expect(result.frustration_level).toBe('high');
    });

    it('escalates scam accusations (golpe)', async () => {
      const result = await frustration_detector.execute({
        message: 'Isso é um golpe!',
      });

      expect(result.is_frustrated).toBe(true);
      expect(result.frustration_level).toBe('high');
      expect(result.frustration_indicators).toContain('Acusação de golpe');
      expect(result.should_escalate).toBe(true);
    });

    it('escalates theft accusations (roubo)', async () => {
      const result = await frustration_detector.execute({
        message: 'Vocês me roubaram!',
      });

      expect(result.frustration_level).toBe('high');
      expect(result.frustration_indicators).toContain('Acusação de roubo');
      expect(result.should_escalate).toBe(true);
    });
  });

  describe('High Frustration Detection (Score >= 5)', () => {
    it('detects high frustration with multiple indicators', async () => {
      const result = await frustration_detector.execute({
        message: 'Isso não funciona! É um absurdo! Péssimo atendimento!',
      });

      expect(result.is_frustrated).toBe(true);
      expect(result.frustration_level).toBe('high');
      expect(result.should_escalate).toBe(true);
    });

    it('detects combined negative patterns', async () => {
      const result = await frustration_detector.execute({
        message: 'Ninguém responde, isso é horrível, vocês são uma vergonha',
      });

      expect(result.frustration_level).toBe('high');
    });
  });

  describe('Moderate Frustration Detection (Score 3-4)', () => {
    it('detects "não funciona" as moderate', async () => {
      const result = await frustration_detector.execute({
        message: 'Isso não funciona',
      });

      expect(result.is_frustrated).toBe(true);
      expect(result.frustration_level).toBe('moderate');
      expect(result.frustration_indicators).toContain('Não consegue realizar ação');
    });

    it('detects confusion patterns', async () => {
      const result = await frustration_detector.execute({
        message: 'Não entendi o que você quis dizer',
      });

      expect(result.is_frustrated).toBe(true);
      expect(['mild', 'moderate']).toContain(result.frustration_level);
      expect(result.frustration_indicators).toContain('Confusão');
    });

    it('detects repetition frustration', async () => {
      const result = await frustration_detector.execute({
        message: 'Já falei isso três vezes!',
      });

      expect(result.is_frustrated).toBe(true);
      expect(result.frustration_indicators).toContain('Repetição de informação');
    });

    it('detects incorrect response frustration', async () => {
      const result = await frustration_detector.execute({
        message: 'Não era isso que eu perguntei',
      });

      expect(result.is_frustrated).toBe(true);
      expect(result.frustration_indicators).toContain('Resposta incorreta');
    });

    it('detects persistent problem', async () => {
      const result = await frustration_detector.execute({
        message: 'É o mesmo problema de antes',
      });

      expect(result.is_frustrated).toBe(true);
      expect(result.frustration_indicators).toContain('Problema persistente');
      // Note: score 2 = mild, escalation only happens at moderate+
    });

    it('escalates persistent problem when combined with more frustration', async () => {
      const result = await frustration_detector.execute({
        message: 'É o mesmo problema de antes e ainda não funciona!',
      });

      expect(result.is_frustrated).toBe(true);
      expect(result.frustration_level).toBe('high'); // Score: 2 + 2 + 3 = 7
      expect(result.should_escalate).toBe(true);
    });

    it('detects long waiting frustration', async () => {
      const result = await frustration_detector.execute({
        message: 'Estou esperando desde ontem uma resposta',
      });

      expect(result.is_frustrated).toBe(true);
      expect(result.frustration_indicators).toContain('Problema duradouro');
      // Note: score 2 = mild, escalation only happens at moderate+
    });

    it('escalates long waiting when combined with legal threat', async () => {
      const result = await frustration_detector.execute({
        message: 'Estou esperando desde ontem, vou no procon',
      });

      expect(result.is_frustrated).toBe(true);
      expect(result.frustration_level).toBe('high'); // Critical indicator
      expect(result.should_escalate).toBe(true);
    });

    it('detects explicit frustration word', async () => {
      const result = await frustration_detector.execute({
        message: 'Estou muito frustrado com isso',
      });

      expect(result.is_frustrated).toBe(true);
      expect(result.frustration_indicators).toContain('Frustração explícita');
    });

    it('detects days waiting pattern', async () => {
      const result = await frustration_detector.execute({
        message: 'Já são 3 dias esperando',
      });

      expect(result.is_frustrated).toBe(true);
      expect(result.frustration_indicators).toContain('Longa espera');
    });

    it('detects cancellation intent', async () => {
      const result = await frustration_detector.execute({
        message: 'Quero cancelar tudo agora mesmo',
      });

      expect(result.is_frustrated).toBe(true);
      expect(result.frustration_indicators).toContain('Intenção de cancelar');
    });

    it('detects refund request', async () => {
      const result = await frustration_detector.execute({
        message: 'Quero meu reembolso',
      });

      expect(result.is_frustrated).toBe(true);
      expect(result.frustration_indicators).toContain('Pedido de reembolso');
    });

    it('detects give up intent', async () => {
      const result = await frustration_detector.execute({
        message: 'Vou desistir disso',
      });

      expect(result.is_frustrated).toBe(true);
      expect(result.frustration_indicators).toContain('Intenção de desistir');
    });
  });

  describe('Mild Frustration Detection (Score 1-2)', () => {
    it('detects multiple question marks', async () => {
      const result = await frustration_detector.execute({
        message: 'Vocês vão me responder???',
      });

      expect(result.is_frustrated).toBe(true);
      expect(result.frustration_level).toBe('mild');
      expect(result.frustration_indicators).toContain('Múltiplas interrogações');
    });

    it('detects multiple exclamation marks', async () => {
      const result = await frustration_detector.execute({
        message: 'Responde logo!!!',
      });

      expect(result.is_frustrated).toBe(true);
      expect(result.frustration_indicators).toContain('Múltiplas exclamações');
    });

    it('detects response nudge with greeting', async () => {
      const result = await frustration_detector.execute({
        message: 'Oi?',
      });

      expect(result.is_frustrated).toBe(true);
      expect(result.frustration_indicators).toContain('Cobrança de resposta');
    });

    it('detects "alguém aí" pattern', async () => {
      const result = await frustration_detector.execute({
        message: 'Alguém aí pode me ajudar?',
      });

      expect(result.is_frustrated).toBe(true);
      expect(result.frustration_indicators).toContain('Cobrança de resposta');
    });

    it('detects urgency', async () => {
      const result = await frustration_detector.execute({
        message: 'É urgente, preciso de ajuda',
      });

      expect(result.is_frustrated).toBe(true);
      expect(result.frustration_indicators).toContain('Urgência');
    });

    it('detects angry emojis', async () => {
      const result = await frustration_detector.execute({
        message: 'Não gostei disso 😡',
      });

      expect(result.is_frustrated).toBe(true);
      expect(result.frustration_indicators).toContain('Emoji de raiva');
    });
  });

  describe('No Frustration Detection', () => {
    it('returns none for neutral message', async () => {
      const result = await frustration_detector.execute({
        message: 'Oi, gostaria de saber o preço do produto',
      });

      expect(result.is_frustrated).toBe(false);
      expect(result.frustration_level).toBe('none');
      expect(result.frustration_indicators).toHaveLength(0);
      expect(result.should_escalate).toBe(false);
    });

    it('returns none for simple question', async () => {
      const result = await frustration_detector.execute({
        message: 'Qual é a forma de pagamento?',
      });

      expect(result.is_frustrated).toBe(false);
      expect(result.frustration_level).toBe('none');
    });

    it('returns none for greeting', async () => {
      const result = await frustration_detector.execute({
        message: 'Boa tarde!',
      });

      expect(result.is_frustrated).toBe(false);
      expect(result.frustration_level).toBe('none');
    });
  });

  describe('Positive Patterns Reduce Score', () => {
    it('reduces frustration when user says thank you', async () => {
      const result = await frustration_detector.execute({
        message: 'Obrigado pela ajuda!',
      });

      expect(result.is_frustrated).toBe(false);
      expect(result.frustration_level).toBe('none');
    });

    it('reduces frustration when user says problem solved', async () => {
      const result = await frustration_detector.execute({
        message: 'Consegui! Resolvido, obrigado!',
      });

      expect(result.is_frustrated).toBe(false);
      expect(result.frustration_level).toBe('none');
    });

    it('reduces frustration with positive emojis', async () => {
      const result = await frustration_detector.execute({
        message: 'Perfeito! 😊❤️ Muito obrigada',
      });

      expect(result.is_frustrated).toBe(false);
      expect(result.frustration_level).toBe('none');
    });

    it('balances negative with positive', async () => {
      // "não entendi" (weight 2) vs "obrigado" (weight -1) = score 1 = mild
      const result = await frustration_detector.execute({
        message: 'Não entendi, mas obrigado pela paciência',
      });

      expect(result.frustration_level).toBe('mild');
    });
  });

  describe('Conversation History Analysis', () => {
    it('detects repeated messages as frustration', async () => {
      const history = `Usuário: Como faço para acessar o curso?
Assistente: Você pode acessar pelo link enviado no email.
Usuário: Como faço para acessar o curso?`;

      const result = await frustration_detector.execute({
        message: 'Como faço para acessar o curso?',
        conversation_history: history,
      });

      expect(result.is_frustrated).toBe(true);
      expect(result.frustration_indicators).toContain('Repetindo mensagem anterior');
    });

    it('detects multiple messages without response', async () => {
      const history = `Assistente: Como posso ajudar?
Usuário: Oi
Usuário: Alguém?
Usuário: ???`;

      const result = await frustration_detector.execute({
        message: 'Vão me responder?',
        conversation_history: history,
      });

      expect(result.is_frustrated).toBe(true);
      expect(result.frustration_indicators).toContain('Múltiplas mensagens sem resposta');
    });
  });

  describe('Recommended Actions', () => {
    it('recommends immediate action for high frustration', async () => {
      const result = await frustration_detector.execute({
        message: 'Isso é uma vergonha! Vou no procon!',
      });

      expect(result.should_escalate).toBe(true);
      expect(result.recommended_action).toContain('IMEDIATAMENTE');
    });

    it('recommends empathy for moderate frustration', async () => {
      const result = await frustration_detector.execute({
        message: 'Não entendi e já estou cansado disso',
      });

      expect(result.frustration_level).toBe('moderate');
      expect(result.recommended_action).toContain('empatia');
    });

    it('recommends clear response for mild frustration', async () => {
      const result = await frustration_detector.execute({
        message: 'Pode me ajudar?',
      });

      expect(result.frustration_level).toBe('mild');
      expect(result.recommended_action).toContain('clara');
    });
  });
});
