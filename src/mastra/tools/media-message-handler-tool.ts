import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

const mediaMessageHandlerInputSchema = z.object({
  message: z.string().describe('User message to analyze'),
  message_type: z.enum(['text', 'image', 'audio', 'video', 'document', 'sticker', 'unknown']).optional().describe('Message type from platform'),
});

const mediaMessageHandlerOutputSchema = z.object({
  is_media_message: z.boolean().describe('True if message contains media'),
  media_type: z.enum(['image', 'link', 'audio', 'video', 'document', 'sticker', 'none']).describe('Type of media detected'),
  contains_link: z.boolean().describe('True if message contains URL'),
  extracted_links: z.array(z.string()).describe('List of URLs found in message'),
  needs_clarification: z.boolean().describe('True if agent should ask for more context'),
  clarification_message: z.string().optional().describe('Message to ask for clarification'),
  can_process: z.boolean().describe('True if message can be processed normally'),
  processing_note: z.string().optional().describe('Note about how to process the message'),
});

// URL patterns
const urlPattern = /https?:\/\/[^\s<>\"\']+/gi;
const domainPattern = /(?:www\.)?([a-zA-Z0-9-]+(?:\.[a-zA-Z]{2,})+)/gi;

// Common e-commerce/checkout domains
const checkoutDomains = [
  'pay.hotmart.com',
  'go.hotmart.com',
  'kiwify.com.br',
  'pay.kiwify.com.br',
  'eduzz.com',
  'monetizze.com.br',
  'lastlink.com',
  'stripe.com',
  'paypal.com',
  'pagar.me',
  'pagseguro.com',
];

// Common image hosting domains
const imageHostingDomains = [
  'imgur.com',
  'i.imgur.com',
  'ibb.co',
  'postimg.cc',
  'prnt.sc',
  'prntscr.com',
  'gyazo.com',
  'drive.google.com',
  'photos.google.com',
];

export const media_message_handler = createTool({
  id: 'media-message-handler',
  description: 'Detects and handles media messages (images, links, audio, etc.)',
  inputSchema: mediaMessageHandlerInputSchema,
  outputSchema: mediaMessageHandlerOutputSchema,
  execute: async (inputData) => {
    const { message, message_type } = inputData;

    // Check for links in message
    const links = message.match(urlPattern) || [];
    const containsLink = links.length > 0;

    // Determine media type
    let mediaType: 'image' | 'link' | 'audio' | 'video' | 'document' | 'sticker' | 'none' = 'none';
    let isMediaMessage = false;
    let needsClarification = false;
    let clarificationMessage: string | undefined;
    let canProcess = true;
    let processingNote: string | undefined;

    // Check explicit message type first
    if (message_type && message_type !== 'text' && message_type !== 'unknown') {
      isMediaMessage = true;
      mediaType = message_type as any;

      if (message_type === 'image') {
        needsClarification = true;
        clarificationMessage = 'Vi que você enviou uma imagem! 📸 Infelizmente não consigo visualizar imagens diretamente. Pode me descrever o que está na imagem ou qual sua dúvida sobre ela?';
        canProcess = false;
        processingNote = 'Image message - cannot process visually';
      } else if (message_type === 'audio') {
        needsClarification = true;
        clarificationMessage = 'Recebi seu áudio! 🎙️ Infelizmente não consigo ouvir áudios no momento. Pode me enviar sua pergunta por escrito?';
        canProcess = false;
        processingNote = 'Audio message - cannot transcribe';
      } else if (message_type === 'video') {
        needsClarification = true;
        clarificationMessage = 'Recebi seu vídeo! 🎬 Infelizmente não consigo assistir vídeos. Pode me descrever o conteúdo ou sua dúvida?';
        canProcess = false;
        processingNote = 'Video message - cannot process';
      } else if (message_type === 'sticker') {
        // Stickers are usually just acknowledgments, continue normally
        canProcess = true;
        processingNote = 'Sticker message - treating as acknowledgment';
      } else if (message_type === 'document') {
        needsClarification = true;
        clarificationMessage = 'Recebi seu documento! 📄 Pode me dizer o que gostaria de saber sobre ele?';
        canProcess = false;
        processingNote = 'Document message - cannot read';
      }
    }

    // Check for links
    if (containsLink) {
      isMediaMessage = true;
      mediaType = 'link';

      // Analyze link types
      const isCheckoutLink = links.some(link =>
        checkoutDomains.some(domain => link.toLowerCase().includes(domain))
      );

      const isImageLink = links.some(link =>
        imageHostingDomains.some(domain => link.toLowerCase().includes(domain)) ||
        /\.(jpg|jpeg|png|gif|webp|bmp)(\?.*)?$/i.test(link)
      );

      if (isCheckoutLink) {
        canProcess = true;
        processingNote = 'Checkout/payment link detected - user may be sharing purchase proof';

        // Check if message has additional context
        const messageWithoutLinks = message.replace(urlPattern, '').trim();
        if (messageWithoutLinks.length < 10) {
          needsClarification = true;
          clarificationMessage = 'Vi que você enviou um link de pagamento! 💳 Pode me dizer mais sobre o que precisa? Está tendo algum problema com a compra?';
        }
      } else if (isImageLink) {
        canProcess = false;
        needsClarification = true;
        clarificationMessage = 'Vi que você enviou um link de imagem! 🖼️ Infelizmente não consigo visualizar imagens. Pode me descrever o que está na imagem?';
        processingNote = 'Image link - cannot view';
      } else {
        // Generic link - may or may not need clarification
        const messageWithoutLinks = message.replace(urlPattern, '').trim();
        if (messageWithoutLinks.length < 10) {
          needsClarification = true;
          clarificationMessage = 'Recebi o link que você enviou! 🔗 Pode me explicar o que gostaria de saber sobre ele?';
          processingNote = 'Link only - needs context';
        } else {
          canProcess = true;
          processingNote = 'Link with context - can process';
        }
      }
    }

    // Check for image extensions in text (user might be describing what they sent)
    const hasImageExtension = /\.(jpg|jpeg|png|gif|webp|bmp|pdf|doc|docx)/i.test(message);
    if (hasImageExtension && !containsLink) {
      processingNote = 'Message mentions file extension - user might be describing a file';
    }

    console.log(`\x1b[36m[MediaMessageHandler]\x1b[0m Type: ${mediaType}, IsMedia: ${isMediaMessage}, CanProcess: ${canProcess}, NeedsClarification: ${needsClarification}`);

    return {
      is_media_message: isMediaMessage,
      media_type: mediaType,
      contains_link: containsLink,
      extracted_links: links,
      needs_clarification: needsClarification,
      clarification_message: clarificationMessage,
      can_process: canProcess,
      processing_note: processingNote,
    };
  },
});
