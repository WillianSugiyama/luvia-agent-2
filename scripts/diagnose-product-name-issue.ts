#!/usr/bin/env bun
/**
 * Diagnostic script to investigate empty product_name issue
 *
 * This script checks:
 * 1. Database structure of product_embeddings
 * 2. Customer events and their product_ids
 * 3. Matching between platform IDs
 * 4. Whether metadata.nome field exists
 *
 * Usage:
 * TEST_TEAM_ID=your-team-id TEST_CUSTOMER_PHONE=5511999999999 bun scripts/diagnose-product-name-issue.ts
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const TEST_TEAM_ID = process.env.TEST_TEAM_ID;
const TEST_CUSTOMER_PHONE = process.env.TEST_CUSTOMER_PHONE;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_KEY environment variables');
  process.exit(1);
}

if (!TEST_TEAM_ID || !TEST_CUSTOMER_PHONE) {
  console.error('❌ Missing TEST_TEAM_ID or TEST_CUSTOMER_PHONE environment variables');
  console.error('Usage: TEST_TEAM_ID=your-team-id TEST_CUSTOMER_PHONE=5511999999999 bun scripts/diagnose-product-name-issue.ts');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

console.log('🔍 Starting diagnosis...\n');
console.log(`Team ID: ${TEST_TEAM_ID}`);
console.log(`Customer Phone: ${TEST_CUSTOMER_PHONE}\n`);

// 1. Check customer events
console.log('📋 Step 1: Checking customer_events...');
const { data: events, error: eventsError } = await supabase
  .from('customer_events')
  .select('product_id, event_type, created_at')
  .eq('team_id', TEST_TEAM_ID)
  .eq('customer_phone', TEST_CUSTOMER_PHONE)
  .order('created_at', { ascending: false });

if (eventsError) {
  console.error('❌ Error fetching customer events:', eventsError);
  process.exit(1);
}

console.log(`✅ Found ${events?.length || 0} customer events`);
if (events && events.length > 0) {
  console.log('\nCustomer Events:');
  events.forEach((e, i) => {
    console.log(`  ${i + 1}. product_id: ${e.product_id}, event_type: ${e.event_type}, created_at: ${e.created_at}`);
  });

  // Get unique platform product IDs
  const platformProductIds = [...new Set(events.map(e => e.product_id))];
  console.log(`\n📦 Unique platform product IDs from events: ${platformProductIds.length}`);
  platformProductIds.forEach((id, i) => {
    console.log(`  ${i + 1}. ${id}`);
  });

  // 2. Check product_embeddings
  console.log('\n📋 Step 2: Checking product_embeddings...');
  const { data: products, error: productsError } = await supabase
    .from('product_embeddings')
    .select('product_id, metadata')
    .eq('team_id', TEST_TEAM_ID);

  if (productsError) {
    console.error('❌ Error fetching product embeddings:', productsError);
    process.exit(1);
  }

  console.log(`✅ Found ${products?.length || 0} products in product_embeddings`);

  if (products && products.length > 0) {
    console.log('\n🔍 Product Embeddings Structure (first 3):');
    products.slice(0, 3).forEach((p, i) => {
      console.log(`\n  Product ${i + 1}:`);
      console.log(`    - UUID: ${p.product_id}`);
      console.log(`    - metadata.nome: "${(p.metadata as any)?.nome || 'EMPTY'}"`);
      console.log(`    - metadata.produto_plataforma_id: "${(p.metadata as any)?.produto_plataforma_id || 'EMPTY'}"`);
      console.log(`    - metadata.product_id_plataforma: "${(p.metadata as any)?.product_id_plataforma || 'EMPTY'}"`);
      console.log(`    - metadata keys:`, Object.keys(p.metadata || {}));
    });

    // 3. Check matching
    console.log('\n📋 Step 3: Checking platform ID matching...');
    let matchCount = 0;
    let emptyNameCount = 0;

    products.forEach((p) => {
      const platformId = (p.metadata as any)?.produto_plataforma_id || (p.metadata as any)?.product_id_plataforma;
      const productName = (p.metadata as any)?.nome || '';

      if (platformId && platformProductIds.includes(platformId)) {
        matchCount++;
        const status = productName ? '✅' : '❌ EMPTY NAME';
        console.log(`\n  ${status} MATCH FOUND!`);
        console.log(`    - Platform ID: ${platformId}`);
        console.log(`    - Internal UUID: ${p.product_id}`);
        console.log(`    - Product Name: "${productName}"`);
        console.log(`    - Full metadata:`, JSON.stringify(p.metadata, null, 2));

        if (!productName) {
          emptyNameCount++;
        }
      }
    });

    console.log(`\n📊 Summary:`);
    console.log(`  - Customer has ${events.length} events`);
    console.log(`  - Unique platform product IDs: ${platformProductIds.length}`);
    console.log(`  - Products in embeddings: ${products.length}`);
    console.log(`  - Matched products: ${matchCount}`);
    console.log(`  - Matched products with EMPTY names: ${emptyNameCount}`);

    if (matchCount === 0) {
      console.log('\n⚠️  WARNING: No matches found between customer events and product embeddings!');
      console.log('This means the platform IDs don\'t match. Possible causes:');
      console.log('  1. Field name mismatch (produto_plataforma_id vs product_id_plataforma)');
      console.log('  2. Platform IDs in customer_events don\'t exist in product_embeddings');
      console.log('  3. Team ID mismatch');
    }

    if (emptyNameCount > 0) {
      console.log('\n❌ ISSUE IDENTIFIED: Product embeddings have matched products but metadata.nome is EMPTY!');
      console.log('Solution: The database needs to be updated to populate the "nome" field in metadata.');
    }
  } else {
    console.log('\n⚠️  No products found in product_embeddings for this team!');
  }
} else {
  console.log('\n⚠️  No customer events found for this customer.');
}

console.log('\n✅ Diagnosis complete!');
