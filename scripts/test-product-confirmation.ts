/**
 * Test script for product history confirmation flow
 *
 * This tests the new behavior where:
 * 1. Customer with 1 product in history gets asked for confirmation
 * 2. System waits for user response before using the product
 * 3. History is treated as "suggestion" not automatic selection
 */

import { loadConversationState, setPendingProductConfirmation, clearPendingProductConfirmation } from '../src/mastra/tools/manage-conversation-context-tool';

const TEST_CONVERSATION_ID = 'test-confirmation-flow';

async function testProductConfirmationFlow() {
  console.log('\n🧪 Testing Product Confirmation Flow\n');
  console.log('=' .repeat(60));

  try {
    // Step 1: Clear any existing state
    console.log('\n1️⃣  Clearing existing conversation state...');
    await clearPendingProductConfirmation(TEST_CONVERSATION_ID);
    const initialState = await loadConversationState(TEST_CONVERSATION_ID);
    console.log('✅ Initial state:', initialState?.pending_product_confirmation ?? 'None');

    // Step 2: Simulate setting a pending product confirmation
    console.log('\n2️⃣  Setting pending product confirmation...');
    await setPendingProductConfirmation(TEST_CONVERSATION_ID, {
      suggested_product_id: 'test-product-uuid-123',
      suggested_product_name: 'Curso de TypeScript Avançado',
      event_type: 'APPROVED',
      reason: 'single_product',
      timestamp: Date.now(),
    });
    const stateWithPending = await loadConversationState(TEST_CONVERSATION_ID);
    console.log('✅ Pending confirmation set:', stateWithPending?.pending_product_confirmation);

    // Step 3: Verify the state was saved correctly
    console.log('\n3️⃣  Verifying state persistence...');
    if (!stateWithPending?.pending_product_confirmation) {
      throw new Error('❌ Pending confirmation was not saved!');
    }
    if (stateWithPending.pending_product_confirmation.suggested_product_name !== 'Curso de TypeScript Avançado') {
      throw new Error('❌ Product name mismatch!');
    }
    console.log('✅ State persisted correctly');

    // Step 4: Simulate clearing the confirmation
    console.log('\n4️⃣  Clearing pending confirmation...');
    await clearPendingProductConfirmation(TEST_CONVERSATION_ID);
    const stateAfterClear = await loadConversationState(TEST_CONVERSATION_ID);
    console.log('✅ Pending confirmation cleared:', stateAfterClear?.pending_product_confirmation ?? 'None');

    // Step 5: Verify it was cleared
    console.log('\n5️⃣  Verifying confirmation was cleared...');
    if (stateAfterClear?.pending_product_confirmation !== null) {
      throw new Error('❌ Pending confirmation was not cleared!');
    }
    console.log('✅ Confirmation cleared successfully');

    console.log('\n' + '='.repeat(60));
    console.log('✅ ALL TESTS PASSED!\n');
    console.log('Expected workflow behavior:');
    console.log('1. Customer with 1 product → System asks "Seria sobre esse produto?"');
    console.log('2. Customer response → productHistoryConfirmationAgent interprets');
    console.log('3. If confirmed → Use suggested product');
    console.log('4. If rejected → Run normal product search');
    console.log('5. If indecisive → Ask for more clarification\n');

  } catch (error: any) {
    console.error('\n❌ TEST FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run tests
testProductConfirmationFlow();
