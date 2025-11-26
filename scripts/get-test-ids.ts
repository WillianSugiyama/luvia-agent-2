/**
 * Helper script to get test IDs from database
 * Run with: bun scripts/get-test-ids.ts
 */

import { createClient } from '@supabase/supabase-js';

const getTestIds = async () => {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_KEY!
  );

  // Get a team_id from product_embeddings
  const { data: products } = await supabase
    .from('product_embeddings')
    .select('team_id, product_id, metadata')
    .limit(1)
    .single();

  if (products) {
    console.log('Test IDs found:');
    console.log(`TEST_TEAM_ID=${products.team_id}`);
    console.log(`TEST_PRODUCT_ID=${products.product_id}`);
    console.log(`\nProduct name: ${products.metadata?.name || 'N/A'}`);
  } else {
    console.log('No products found in database');
  }
};

getTestIds().catch(console.error);
