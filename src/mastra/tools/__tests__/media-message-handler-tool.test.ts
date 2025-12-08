import { describe, it, expect, vi } from 'vitest';
import { media_message_handler } from '../media-message-handler-tool';

// Silence console.log during tests
vi.spyOn(console, 'log').mockImplementation(() => {});

describe('media_message_handler', () => {
  describe('Image Message Detection', () => {
    it('detects image message type from platform', async () => {
      const result = await media_message_handler.execute({
        message: '',
        message_type: 'image',
      });

      expect(result.is_media_message).toBe(true);
      expect(result.media_type).toBe('image');
      expect(result.needs_clarification).toBe(true);
      expect(result.can_process).toBe(false);
      expect(result.clarification_message).toContain('imagem');
    });

    it('provides Portuguese clarification for images', async () => {
      const result = await media_message_handler.execute({
        message: 'Olha isso',
        message_type: 'image',
      });

      expect(result.clarification_message).toContain('enviou uma imagem');
      expect(result.clarification_message).toContain('descrever');
    });
  });

  describe('Audio Message Detection', () => {
    it('detects audio message type', async () => {
      const result = await media_message_handler.execute({
        message: '',
        message_type: 'audio',
      });

      expect(result.is_media_message).toBe(true);
      expect(result.media_type).toBe('audio');
      expect(result.needs_clarification).toBe(true);
      expect(result.can_process).toBe(false);
    });

    it('provides Portuguese clarification for audio', async () => {
      const result = await media_message_handler.execute({
        message: '',
        message_type: 'audio',
      });

      expect(result.clarification_message).toContain('áudio');
      expect(result.clarification_message).toContain('escrito');
    });
  });

  describe('Video Message Detection', () => {
    it('detects video message type', async () => {
      const result = await media_message_handler.execute({
        message: '',
        message_type: 'video',
      });

      expect(result.is_media_message).toBe(true);
      expect(result.media_type).toBe('video');
      expect(result.needs_clarification).toBe(true);
      expect(result.can_process).toBe(false);
    });

    it('provides Portuguese clarification for video', async () => {
      const result = await media_message_handler.execute({
        message: '',
        message_type: 'video',
      });

      expect(result.clarification_message).toContain('vídeo');
    });
  });

  describe('Document Message Detection', () => {
    it('detects document message type', async () => {
      const result = await media_message_handler.execute({
        message: '',
        message_type: 'document',
      });

      expect(result.is_media_message).toBe(true);
      expect(result.media_type).toBe('document');
      expect(result.needs_clarification).toBe(true);
      expect(result.can_process).toBe(false);
    });

    it('provides Portuguese clarification for document', async () => {
      const result = await media_message_handler.execute({
        message: '',
        message_type: 'document',
      });

      expect(result.clarification_message).toContain('documento');
    });
  });

  describe('Sticker Message Detection', () => {
    it('detects sticker message type', async () => {
      const result = await media_message_handler.execute({
        message: '',
        message_type: 'sticker',
      });

      expect(result.is_media_message).toBe(true);
      expect(result.media_type).toBe('sticker');
      expect(result.can_process).toBe(true); // Stickers can be processed as acknowledgments
      expect(result.needs_clarification).toBe(false);
    });
  });

  describe('Link Detection', () => {
    it('detects URL in message', async () => {
      const result = await media_message_handler.execute({
        message: 'Olha esse site https://example.com',
      });

      expect(result.is_media_message).toBe(true);
      expect(result.contains_link).toBe(true);
      expect(result.media_type).toBe('link');
      expect(result.extracted_links).toContain('https://example.com');
    });

    it('detects multiple URLs', async () => {
      const result = await media_message_handler.execute({
        message: 'Veja https://site1.com e https://site2.com',
      });

      expect(result.contains_link).toBe(true);
      expect(result.extracted_links).toHaveLength(2);
      expect(result.extracted_links).toContain('https://site1.com');
      expect(result.extracted_links).toContain('https://site2.com');
    });

    it('detects HTTP URLs', async () => {
      const result = await media_message_handler.execute({
        message: 'Link: http://example.com/page',
      });

      expect(result.contains_link).toBe(true);
      expect(result.extracted_links).toContain('http://example.com/page');
    });
  });

  describe('Checkout Link Detection', () => {
    it('detects Hotmart checkout link', async () => {
      const result = await media_message_handler.execute({
        message: 'https://pay.hotmart.com/ABC123',
      });

      expect(result.contains_link).toBe(true);
      expect(result.can_process).toBe(true);
      expect(result.processing_note).toContain('Checkout');
    });

    it('detects Kiwify checkout link', async () => {
      const result = await media_message_handler.execute({
        message: 'Comprei aqui https://pay.kiwify.com.br/XYZ',
      });

      expect(result.can_process).toBe(true);
      expect(result.processing_note).toContain('Checkout');
    });

    it('detects Eduzz checkout link', async () => {
      const result = await media_message_handler.execute({
        message: 'Link da compra: https://eduzz.com/checkout/123',
      });

      expect(result.processing_note).toContain('Checkout');
    });

    it('asks for context when checkout link is alone', async () => {
      const result = await media_message_handler.execute({
        message: 'https://pay.hotmart.com/ABC123',
      });

      expect(result.needs_clarification).toBe(true);
      expect(result.clarification_message).toContain('link de pagamento');
    });

    it('processes checkout link with context', async () => {
      const result = await media_message_handler.execute({
        message: 'Comprei o curso nesse link https://pay.hotmart.com/ABC123 mas não recebi acesso',
      });

      expect(result.needs_clarification).toBe(false);
      expect(result.can_process).toBe(true);
    });
  });

  describe('Image Hosting Link Detection', () => {
    it('detects imgur link', async () => {
      const result = await media_message_handler.execute({
        message: 'Olha https://imgur.com/abc123',
      });

      expect(result.needs_clarification).toBe(true);
      expect(result.clarification_message).toContain('imagem');
    });

    it('detects direct imgur image link', async () => {
      const result = await media_message_handler.execute({
        message: 'https://i.imgur.com/xyz.jpg',
      });

      expect(result.needs_clarification).toBe(true);
      expect(result.can_process).toBe(false);
    });

    it('detects image file extension in URL', async () => {
      const result = await media_message_handler.execute({
        message: 'https://example.com/image.png',
      });

      expect(result.needs_clarification).toBe(true);
      expect(result.clarification_message).toContain('imagem');
    });

    it('detects various image extensions', async () => {
      const extensions = ['jpg', 'jpeg', 'png', 'gif', 'webp'];

      for (const ext of extensions) {
        const result = await media_message_handler.execute({
          message: `https://example.com/photo.${ext}`,
        });

        expect(result.needs_clarification).toBe(true);
      }
    });

    it('detects prnt.sc screenshot link', async () => {
      const result = await media_message_handler.execute({
        message: 'https://prnt.sc/abc123',
      });

      expect(result.needs_clarification).toBe(true);
      expect(result.processing_note).toContain('Image link');
    });

    it('detects Google Drive link', async () => {
      const result = await media_message_handler.execute({
        message: 'https://drive.google.com/file/d/ABC123',
      });

      expect(result.needs_clarification).toBe(true);
    });
  });

  describe('Generic Link Handling', () => {
    it('asks for context when generic link is alone', async () => {
      const result = await media_message_handler.execute({
        message: 'https://random-site.com',
      });

      expect(result.needs_clarification).toBe(true);
      expect(result.clarification_message).toContain('link');
    });

    it('processes generic link with context', async () => {
      const result = await media_message_handler.execute({
        message: 'Estou tentando acessar https://random-site.com/curso mas dá erro 404',
      });

      expect(result.needs_clarification).toBe(false);
      expect(result.can_process).toBe(true);
    });
  });

  describe('Text Message (No Media)', () => {
    it('detects normal text message', async () => {
      const result = await media_message_handler.execute({
        message: 'Oi, gostaria de saber o preço do curso',
      });

      expect(result.is_media_message).toBe(false);
      expect(result.media_type).toBe('none');
      expect(result.contains_link).toBe(false);
      expect(result.needs_clarification).toBe(false);
      expect(result.can_process).toBe(true);
    });

    it('handles text message type explicitly', async () => {
      const result = await media_message_handler.execute({
        message: 'Qual o valor?',
        message_type: 'text',
      });

      expect(result.is_media_message).toBe(false);
      expect(result.can_process).toBe(true);
    });

    it('handles unknown message type as text', async () => {
      const result = await media_message_handler.execute({
        message: 'Pergunta normal',
        message_type: 'unknown',
      });

      expect(result.is_media_message).toBe(false);
    });
  });

  describe('File Extension Mentions', () => {
    it('notes when message mentions file extension', async () => {
      const result = await media_message_handler.execute({
        message: 'Mandei o arquivo documento.pdf',
      });

      expect(result.processing_note).toContain('file extension');
    });

    it('notes image extension mention', async () => {
      const result = await media_message_handler.execute({
        message: 'A foto comprovante.jpg mostra o pagamento',
      });

      expect(result.processing_note).toContain('file extension');
    });
  });

  describe('Real World Scenarios', () => {
    it('handles customer sending purchase proof image', async () => {
      const result = await media_message_handler.execute({
        message: '',
        message_type: 'image',
      });

      expect(result.needs_clarification).toBe(true);
      expect(result.clarification_message).toContain('descrever');
    });

    it('handles customer sending audio question', async () => {
      const result = await media_message_handler.execute({
        message: '',
        message_type: 'audio',
      });

      expect(result.needs_clarification).toBe(true);
      expect(result.clarification_message).toContain('escrito');
    });

    it('handles customer sharing checkout link with issue', async () => {
      const result = await media_message_handler.execute({
        message: 'Paguei aqui https://pay.hotmart.com/H123ABC mas ainda não recebi o acesso ao curso',
      });

      expect(result.can_process).toBe(true);
      expect(result.needs_clarification).toBe(false);
      expect(result.extracted_links).toContain('https://pay.hotmart.com/H123ABC');
    });

    it('handles screenshot link without context', async () => {
      const result = await media_message_handler.execute({
        message: 'https://prnt.sc/xyz123',
      });

      expect(result.needs_clarification).toBe(true);
      expect(result.clarification_message).toContain('imagem');
    });

    it('handles thumbs up sticker as acknowledgment', async () => {
      const result = await media_message_handler.execute({
        message: '',
        message_type: 'sticker',
      });

      expect(result.can_process).toBe(true);
      expect(result.processing_note).toContain('acknowledgment');
    });
  });

  describe('Edge Cases', () => {
    it('handles empty message with no type', async () => {
      const result = await media_message_handler.execute({
        message: '',
      });

      expect(result.is_media_message).toBe(false);
      expect(result.can_process).toBe(true);
    });

    it('handles message with query parameters in URL', async () => {
      const result = await media_message_handler.execute({
        message: 'https://site.com/image.jpg?size=large&quality=high',
      });

      expect(result.contains_link).toBe(true);
      expect(result.needs_clarification).toBe(true); // Image link
    });

    it('handles URL with fragment', async () => {
      const result = await media_message_handler.execute({
        message: 'https://site.com/page#section',
      });

      expect(result.contains_link).toBe(true);
    });

    it('does not detect email as URL', async () => {
      const result = await media_message_handler.execute({
        message: 'Meu email é teste@example.com',
      });

      expect(result.contains_link).toBe(false);
    });
  });
});
