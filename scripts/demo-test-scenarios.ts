/**
 * Demo Test Scenarios for Client Presentation
 *
 * This script tests various conversation scenarios to demonstrate
 * the agent's capabilities.
 *
 * Usage: bun scripts/demo-test-scenarios.ts
 */

const BASE_URL = process.env.API_URL || 'http://localhost:3000';
const TEAM_ID = process.env.TEST_TEAM_ID || '287dca6a-f936-42df-b265-e25f97314259';

// Test phone numbers (use different ones for different customer scenarios)
const PHONES = {
  // Customer with multiple products
  MULTI_PRODUCT: '5567996261975',
  // Customer with single product
  SINGLE_PRODUCT: '5511988887777',
  // New customer (no products)
  NEW_CUSTOMER: '5511900000001',
};

interface TestScenario {
  name: string;
  description: string;
  phone: string;
  messages: string[];
  expectedBehavior: string;
}

const scenarios: TestScenario[] = [
  // ==================== GREETING SCENARIOS ====================
  {
    name: '1. Greeting - New Customer',
    description: 'New customer says hello',
    phone: PHONES.NEW_CUSTOMER,
    messages: ['Olá, tudo bem?'],
    expectedBehavior: 'Agent should greet back naturally and ask how to help',
  },
  {
    name: '2. Greeting - Existing Customer',
    description: 'Existing customer with products says hello',
    phone: PHONES.MULTI_PRODUCT,
    messages: ['Oi, tudo bem?'],
    expectedBehavior: 'Agent should greet back naturally (NOT immediately ask about products)',
  },
  {
    name: '3. Greeting + Follow-up Question',
    description: 'Customer greets then asks question',
    phone: PHONES.MULTI_PRODUCT,
    messages: [
      'Olá!',
      'Preciso de ajuda com meu curso',
    ],
    expectedBehavior: 'First: natural greeting. Second: ask which product (if multiple)',
  },

  // ==================== SUPPORT SCENARIOS ====================
  {
    name: '4. Access Problem - Single Product',
    description: 'Customer with 1 product cant access',
    phone: PHONES.SINGLE_PRODUCT,
    messages: ['Não consigo acessar o curso'],
    expectedBehavior: 'Should ask for confirmation of product, then help with access',
  },
  {
    name: '5. Access Problem - Multiple Products',
    description: 'Customer with multiple products needs access help',
    phone: PHONES.MULTI_PRODUCT,
    messages: ['Não tenho o link do curso'],
    expectedBehavior: 'Should ask which product they need help with',
  },
  {
    name: '6. Password Reset',
    description: 'Customer forgot password',
    phone: PHONES.SINGLE_PRODUCT,
    messages: ['Esqueci minha senha'],
    expectedBehavior: 'Should provide password reset instructions',
  },

  // ==================== SALES SCENARIOS ====================
  {
    name: '7. Price Inquiry - Abandoned Cart',
    description: 'Customer with abandoned cart asks about price',
    phone: PHONES.MULTI_PRODUCT,
    messages: ['Quanto custa o curso?'],
    expectedBehavior: 'Should show price of abandoned cart product and offer checkout link',
  },
  {
    name: '8. Purchase Intent',
    description: 'New customer wants to buy',
    phone: PHONES.NEW_CUSTOMER,
    messages: ['Quero comprar o curso de radiestesia'],
    expectedBehavior: 'Should provide product info and checkout link',
  },
  {
    name: '9. Payment Methods',
    description: 'Customer asks about payment',
    phone: PHONES.NEW_CUSTOMER,
    messages: ['Vocês aceitam PIX?'],
    expectedBehavior: 'Should explain available payment methods',
  },

  // ==================== FRUSTRATION SCENARIOS ====================
  {
    name: '10. Frustrated Customer - Mild',
    description: 'Customer showing mild frustration',
    phone: PHONES.SINGLE_PRODUCT,
    messages: ['Já tentei várias vezes e não funciona!!!'],
    expectedBehavior: 'Should acknowledge frustration and offer direct help',
  },
  {
    name: '11. Frustrated Customer - High (Legal Threat)',
    description: 'Customer threatening legal action',
    phone: PHONES.SINGLE_PRODUCT,
    messages: ['Vou procurar o Procon se não resolverem isso'],
    expectedBehavior: 'Should escalate to human immediately',
  },
  {
    name: '12. Frustrated Customer - Scam Accusation',
    description: 'Customer accusing of fraud',
    phone: PHONES.SINGLE_PRODUCT,
    messages: ['Isso é um golpe!'],
    expectedBehavior: 'Should escalate to human immediately',
  },

  // ==================== MEDIA SCENARIOS ====================
  {
    name: '13. Image Message',
    description: 'Customer sends image',
    phone: PHONES.SINGLE_PRODUCT,
    messages: ['[IMAGEM]'],
    expectedBehavior: 'Should ask customer to describe the image',
  },
  {
    name: '14. Audio Message',
    description: 'Customer sends audio',
    phone: PHONES.SINGLE_PRODUCT,
    messages: ['[ÁUDIO]'],
    expectedBehavior: 'Should ask customer to type the message',
  },

  // ==================== CONTEXT SWITCHING ====================
  {
    name: '15. Product Selection',
    description: 'Customer selects product from list',
    phone: PHONES.MULTI_PRODUCT,
    messages: [
      'Preciso de ajuda',
      '1',  // Selects first product
    ],
    expectedBehavior: 'Should recognize selection and proceed with that product',
  },
  {
    name: '16. Product Selection by Name',
    description: 'Customer mentions product name',
    phone: PHONES.MULTI_PRODUCT,
    messages: ['Quero ajuda com o Tratamento Coletivo'],
    expectedBehavior: 'Should identify the product and help with it',
  },

  // ==================== COMPLEX SCENARIOS ====================
  {
    name: '17. Multi-turn Conversation',
    description: 'Full conversation flow',
    phone: PHONES.NEW_CUSTOMER,
    messages: [
      'Oi!',
      'Quero saber sobre o curso de radiestesia',
      'Quanto custa?',
      'Aceita cartão?',
      'Ok, vou comprar',
    ],
    expectedBehavior: 'Should maintain context through the conversation',
  },
  {
    name: '18. Consecutive Messages',
    description: 'Customer sends multiple messages in sequence',
    phone: PHONES.SINGLE_PRODUCT,
    messages: [
      'Oi',
      'Preciso de ajuda',
      'É urgente',
    ],
    expectedBehavior: 'Should consolidate and respond to all messages appropriately',
  },
];

async function sendMessage(phone: string, message: string, isConfirmation = false): Promise<any> {
  const response = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      team_id: TEAM_ID,
      phone,
      message,
      user_confirmation: isConfirmation,
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  return response.json();
}

async function runScenario(scenario: TestScenario): Promise<void> {
  console.log('\n' + '='.repeat(80));
  console.log(`\x1b[36m${scenario.name}\x1b[0m`);
  console.log(`Description: ${scenario.description}`);
  console.log(`Expected: ${scenario.expectedBehavior}`);
  console.log('-'.repeat(80));

  for (let i = 0; i < scenario.messages.length; i++) {
    const msg = scenario.messages[i];
    console.log(`\n\x1b[33m[User ${i + 1}]:\x1b[0m ${msg}`);

    try {
      const result = await sendMessage(scenario.phone, msg);

      console.log(`\x1b[32m[Agent]:\x1b[0m ${result.response || '(sem resposta)'}`);
      console.log(`\x1b[90m  Agent: ${result.agent_used} | Status: ${result.workflow_status} | Escalate: ${result.needs_human}\x1b[0m`);

      // Small delay between messages
      if (i < scenario.messages.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error: any) {
      console.log(`\x1b[31m[Error]:\x1b[0m ${error.message}`);
    }
  }
}

async function main() {
  console.log('\n🧪 LUVIA AGENT - DEMO TEST SCENARIOS\n');
  console.log(`API URL: ${BASE_URL}`);
  console.log(`Team ID: ${TEAM_ID}`);
  console.log(`Total Scenarios: ${scenarios.length}`);

  // Check if specific scenario was requested
  const specificScenario = process.argv[2];

  if (specificScenario) {
    const scenarioNum = parseInt(specificScenario);
    const scenario = scenarios.find(s => s.name.startsWith(`${scenarioNum}.`));

    if (scenario) {
      await runScenario(scenario);
    } else {
      console.log(`\nScenario ${specificScenario} not found. Available scenarios:`);
      scenarios.forEach(s => console.log(`  ${s.name}`));
    }
  } else {
    // Run all scenarios
    for (const scenario of scenarios) {
      await runScenario(scenario);
      // Delay between scenarios
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('✅ Demo test scenarios completed');
  console.log('='.repeat(80) + '\n');
}

main().catch(console.error);
