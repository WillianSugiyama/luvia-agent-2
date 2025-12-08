import { parse } from 'csv-parse/sync';
import fs from 'fs';

interface Message {
  id: string;
  conversation_id: string;
  sender_type: 'contact' | 'ai_agent' | 'human';
  content: string;
  message_type: string;
  created_at: string;
  contact_phone: string;
}

interface ConversationAnalysis {
  conversation_id: string;
  contact_phone: string;
  messages: Message[];
  issues: string[];
  patterns: string[];
}

// Read and parse CSV
const csvPath = '/Users/williansugiyama/Downloads/messages_mari_tortella.csv';
const csvContent = fs.readFileSync(csvPath, 'utf-8');

console.log('Parsing CSV...');
const records = parse(csvContent, {
  columns: true,
  skip_empty_lines: true,
  relax_quotes: true,
  relax_column_count: true,
}) as Message[];

console.log(`Total messages: ${records.length}`);

// Group by conversation
const conversations = new Map<string, Message[]>();
for (const record of records) {
  const convId = record.conversation_id;
  if (!conversations.has(convId)) {
    conversations.set(convId, []);
  }
  conversations.get(convId)!.push(record);
}

console.log(`Total conversations: ${conversations.size}`);

// Analyze conversations for issues
const issues = {
  noResponse: [] as string[],           // User message with no AI response
  lateResponse: [] as string[],          // Very late AI response
  repetitiveResponses: [] as string[],   // AI repeating same response
  multipleMessages: [] as string[],      // AI sending too many messages in sequence
  noContext: [] as string[],             // AI seems to not understand context
  genericResponses: [] as string[],      // AI giving generic/vague responses
  wrongProduct: [] as string[],          // AI talking about wrong product
  inappropriateOffer: [] as string[],    // AI offering when shouldn't
  frustrationIndicators: [] as string[], // User showing frustration
  unknownIntent: [] as string[],         // AI couldn't understand user
  humanEscalation: [] as string[],       // Cases that needed human help
  imageHandling: [] as string[],         // Issues with image messages
  linkHandling: [] as string[],          // Issues with links
  greetingIssues: [] as string[],        // Issues with greetings
  contextLoss: [] as string[],           // Lost context between messages
};

const patterns = {
  supportRequests: 0,
  salesInquiries: 0,
  accessIssues: 0,
  priceQuestions: 0,
  greetingsOnly: 0,
  thankYouMessages: 0,
  frustrationMessages: 0,
  imageMessages: 0,
  linkMessages: 0,
};

const problematicConversations: ConversationAnalysis[] = [];

// Frustration indicators
const frustrationPatterns = [
  /não (entendi|consegui|funciona)/i,
  /ninguém (responde|ajuda)/i,
  /isso (não|nao) ajud/i,
  /repet(ir|iu|indo)/i,
  /mesmo problema/i,
  /já falei/i,
  /não era isso/i,
  /errad[oa]/i,
  /cansad[oa]/i,
  /desist/i,
  /péssim[oa]/i,
  /horrível/i,
  /\?\?+/,  // Multiple question marks
  /!!+/,    // Multiple exclamation marks
];

// Generic AI responses
const genericPatterns = [
  /te entendo perfeitamente/i,
  /fico por aqui/i,
  /qualquer dúvida/i,
  /conte comigo/i,
  /whatsapp oficial/i,
  /suporte humano/i,
];

// Analyze each conversation
for (const [convId, messages] of conversations) {
  const sortedMessages = messages.sort((a, b) =>
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  const convIssues: string[] = [];
  const convPatterns: string[] = [];

  let consecutiveAiMessages = 0;
  let lastSenderType = '';
  let lastAiResponses: string[] = [];
  let userMessageWithoutResponse = false;

  for (let i = 0; i < sortedMessages.length; i++) {
    const msg = sortedMessages[i];
    const content = msg.content || '';
    const lowerContent = content.toLowerCase();

    // Track patterns
    if (msg.message_type === 'image') patterns.imageMessages++;
    if (content.match(/^https?:\/\//)) patterns.linkMessages++;
    if (lowerContent.match(/^(oi|olá|bom dia|boa tarde|boa noite)[\s!,.]?$/)) patterns.greetingsOnly++;
    if (lowerContent.match(/(obrigad|agradeç|grat[oa])/)) patterns.thankYouMessages++;
    if (lowerContent.match(/(acesso|login|entrar|não consigo acessar)/)) patterns.accessIssues++;
    if (lowerContent.match(/(preço|valor|quanto custa|pagar)/)) patterns.priceQuestions++;
    if (lowerContent.match(/(ajuda|socorro|preciso|suporte)/)) patterns.supportRequests++;
    if (lowerContent.match(/(comprar|adquirir|quero|interessad)/)) patterns.salesInquiries++;

    // Check for frustration
    for (const pattern of frustrationPatterns) {
      if (pattern.test(content)) {
        patterns.frustrationMessages++;
        convIssues.push(`Frustração detectada: "${content.substring(0, 100)}..."`);
        break;
      }
    }

    // Track AI response patterns
    if (msg.sender_type === 'ai_agent') {
      consecutiveAiMessages++;
      lastAiResponses.push(content);

      // Check for repetitive responses
      if (lastAiResponses.length >= 2) {
        const lastTwo = lastAiResponses.slice(-2);
        if (lastTwo[0].toLowerCase() === lastTwo[1].toLowerCase()) {
          convIssues.push(`Resposta repetida: "${content.substring(0, 50)}..."`);
        }
      }

      // Check for generic responses
      let genericCount = 0;
      for (const pattern of genericPatterns) {
        if (pattern.test(content)) genericCount++;
      }
      if (genericCount >= 2) {
        convIssues.push(`Resposta genérica: "${content.substring(0, 100)}..."`);
      }

      // Check for too many consecutive AI messages
      if (consecutiveAiMessages > 4) {
        convIssues.push(`AI enviou ${consecutiveAiMessages} mensagens seguidas`);
      }

      userMessageWithoutResponse = false;
    } else if (msg.sender_type === 'contact') {
      if (consecutiveAiMessages > 0) {
        consecutiveAiMessages = 0;
        lastAiResponses = [];
      }

      // Check if previous user message had no response
      if (userMessageWithoutResponse && lastSenderType === 'contact') {
        convIssues.push(`Mensagem sem resposta: "${sortedMessages[i-1]?.content?.substring(0, 50)}..."`);
      }

      userMessageWithoutResponse = true;

      // Check for image messages
      if (msg.message_type === 'image') {
        convPatterns.push('Usuário enviou imagem');
      }

      // Check for links
      if (content.match(/^https?:\/\//)) {
        convPatterns.push('Usuário enviou link');
      }
    }

    lastSenderType = msg.sender_type;
  }

  // Check if conversation ended with user message (no response)
  if (lastSenderType === 'contact' && userMessageWithoutResponse) {
    convIssues.push('Conversa terminou sem resposta do AI');
  }

  // Store problematic conversations
  if (convIssues.length > 0) {
    problematicConversations.push({
      conversation_id: convId,
      contact_phone: sortedMessages[0]?.contact_phone || '',
      messages: sortedMessages,
      issues: convIssues,
      patterns: convPatterns,
    });
  }
}

// Print results
console.log('\n========== ANÁLISE DE GAPS ==========\n');

console.log('📊 ESTATÍSTICAS GERAIS:');
console.log(`  Total de conversas: ${conversations.size}`);
console.log(`  Total de mensagens: ${records.length}`);
console.log(`  Conversas problemáticas: ${problematicConversations.length}`);

console.log('\n📈 PADRÕES IDENTIFICADOS:');
console.log(`  Saudações simples: ${patterns.greetingsOnly}`);
console.log(`  Agradecimentos: ${patterns.thankYouMessages}`);
console.log(`  Problemas de acesso: ${patterns.accessIssues}`);
console.log(`  Perguntas sobre preço: ${patterns.priceQuestions}`);
console.log(`  Pedidos de suporte: ${patterns.supportRequests}`);
console.log(`  Interesse em compra: ${patterns.salesInquiries}`);
console.log(`  Mensagens com frustração: ${patterns.frustrationMessages}`);
console.log(`  Mensagens com imagem: ${patterns.imageMessages}`);
console.log(`  Mensagens com link: ${patterns.linkMessages}`);

console.log('\n⚠️ TOP 20 CONVERSAS PROBLEMÁTICAS:');
const sortedProblems = problematicConversations
  .sort((a, b) => b.issues.length - a.issues.length)
  .slice(0, 20);

for (const conv of sortedProblems) {
  console.log(`\n-----------------------------------`);
  console.log(`Conversa: ${conv.conversation_id}`);
  console.log(`Telefone: ${conv.contact_phone}`);
  console.log(`Issues (${conv.issues.length}):`);
  for (const issue of conv.issues.slice(0, 5)) {
    console.log(`  - ${issue}`);
  }
  if (conv.issues.length > 5) {
    console.log(`  ... e mais ${conv.issues.length - 5} issues`);
  }

  // Show conversation sample
  console.log('\nAmostra da conversa:');
  const sampleMessages = conv.messages.slice(0, 10);
  for (const msg of sampleMessages) {
    const sender = msg.sender_type === 'contact' ? '👤 Usuário' : '🤖 AI';
    const content = msg.content?.substring(0, 100) || '[vazio]';
    console.log(`  ${sender}: ${content}${msg.content?.length > 100 ? '...' : ''}`);
  }
  if (conv.messages.length > 10) {
    console.log(`  ... e mais ${conv.messages.length - 10} mensagens`);
  }
}

// Summary of issue types
console.log('\n\n========== RESUMO DE PROBLEMAS ==========\n');

const issueCounts = new Map<string, number>();
for (const conv of problematicConversations) {
  for (const issue of conv.issues) {
    const issueType = issue.split(':')[0];
    issueCounts.set(issueType, (issueCounts.get(issueType) || 0) + 1);
  }
}

const sortedIssues = [...issueCounts.entries()]
  .sort((a, b) => b[1] - a[1]);

console.log('Tipos de problemas mais comuns:');
for (const [issue, count] of sortedIssues.slice(0, 10)) {
  console.log(`  ${issue}: ${count}`);
}

// Save detailed report to file
const reportPath = '/Users/williansugiyama/Documents/Projects/luvia/luvia-agent/conversation-analysis-report.json';
fs.writeFileSync(reportPath, JSON.stringify({
  summary: {
    totalConversations: conversations.size,
    totalMessages: records.length,
    problematicConversations: problematicConversations.length,
    patterns,
    issueCounts: Object.fromEntries(issueCounts),
  },
  topProblematicConversations: sortedProblems.map(c => ({
    ...c,
    messages: c.messages.map(m => ({
      sender_type: m.sender_type,
      content: m.content?.substring(0, 500),
      created_at: m.created_at,
    })),
  })),
}, null, 2));

console.log(`\n\n✅ Relatório detalhado salvo em: ${reportPath}`);
