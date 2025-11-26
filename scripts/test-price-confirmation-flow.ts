#!/usr/bin/env bun
/**
 * Test script to verify the price confirmation flow
 *
 * Tests:
 * 1. User asks "qtn custa?" with customer history
 * 2. System shows confirmation with ACTUAL product name (not placeholder)
 * 3. User confirms with "Sim"
 * 4. System returns price with correct formatting (reais, not centavos)
 */

const API_URL = 'http://localhost:3000/api/chat';

// Use test credentials from environment or defaults
const TEST_TEAM_ID = process.env.TEST_TEAM_ID || '287dca6a-f936-42df-b265-e25f97314259';
const TEST_CUSTOMER_PHONE = process.env.TEST_CUSTOMER_PHONE || '5511999999999';

interface ChatResponse {
  workflow_run_id: string;
  response?: string;
  agent_response?: string;  // backward compat
  error?: string;
}

async function sendMessage(message: string, userConfirmation?: boolean): Promise<ChatResponse> {
  const body: any = {
    team_id: TEST_TEAM_ID,
    message,
    phone: TEST_CUSTOMER_PHONE,
  };

  if (userConfirmation !== undefined) {
    body.user_confirmation = userConfirmation;
  }

  console.log(`\n📤 Sending: "${message}"${userConfirmation !== undefined ? ` (confirmation: ${userConfirmation})` : ''}`);

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  return response.json();
}

async function runTest() {
  console.log('🧪 Testing Price Confirmation Flow\n');
  console.log(`Team ID: ${TEST_TEAM_ID}`);
  console.log(`Customer Phone: ${TEST_CUSTOMER_PHONE}`);
  console.log('─'.repeat(80));

  try {
    // Step 1: Ask "qtn custa?"
    console.log('\n📋 STEP 1: User asks "qtn custa?"');
    const step1 = await sendMessage('qtn custa');

    const step1Response = step1.response || step1.agent_response;
    console.log(`\n📥 Response (${step1Response?.length || 0} chars):`);
    console.log(step1Response);

    // Check if response contains actual product name (not placeholder)
    const hasPlaceholder = step1Response?.includes('[PRODUTO SUGERIDO]') ||
                          step1Response?.includes('[nome do produto sugerido]') ||
                          step1Response?.includes('[produto sugerido]');

    if (hasPlaceholder) {
      console.log('\n❌ FAIL: Response contains placeholder instead of actual product name!');
      return;
    }

    // Check if response has a product name (any text in bold)
    const hasBoldText = step1Response?.includes('**') &&
                       step1Response.split('**').length > 2;

    if (!hasBoldText) {
      console.log('\n⚠️  WARNING: Response does not contain product name in bold format');
    } else {
      // Extract product name between ** **
      const parts = step1Response!.split('**');
      const productName = parts[1] || 'N/A';
      console.log(`\n✅ PASS: Product name found: "${productName.substring(0, 50)}..."`);
    }

    // Step 2: Confirm with "Sim"
    console.log('\n─'.repeat(80));
    console.log('\n📋 STEP 2: User confirms with "Sim"');
    const step2 = await sendMessage('Sim', true);

    const step2Response = step2.response || step2.agent_response;
    console.log(`\n📥 Response (${step2Response?.length || 0} chars):`);
    console.log(step2Response);

    if (!step2Response || step2Response.trim().length === 0) {
      console.log('\n❌ FAIL: Empty response after confirmation!');
      return;
    }

    // Check for price formatting
    const hasBRLPrice = step2Response?.includes('R$');

    if (!hasBRLPrice) {
      console.log('\n⚠️  WARNING: Response does not contain price in BRL format (R$)');
    } else {
      console.log('\n✅ PASS: Response contains price in BRL format');

      // Extract prices to verify format
      const priceRegex = /R\$\s*([\d.]+,\d{2})/g;
      const prices = [...step2Response.matchAll(priceRegex)];

      if (prices.length > 0) {
        console.log(`\n💰 Prices found (${prices.length}):`);
        prices.forEach((match, i) => {
          console.log(`  ${i + 1}. R$ ${match[1]}`);
        });

        // Check if any price looks like centavos format (< R$ 100,00)
        const suspiciousPrices = prices.filter(m => {
          const numStr = m[1].replace('.', '').replace(',', '.');
          const num = parseFloat(numStr);
          return num < 100;
        });

        if (suspiciousPrices.length > 0) {
          console.log(`\n⚠️  WARNING: Found suspiciously low prices (might be centavos format):`);
          suspiciousPrices.forEach(m => console.log(`  R$ ${m[1]}`));
        }
      }
    }

    console.log('\n─'.repeat(80));
    console.log('\n✅ TEST COMPLETE');

  } catch (error: any) {
    console.error('\n❌ TEST FAILED:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
  }
}

runTest().catch(console.error);
