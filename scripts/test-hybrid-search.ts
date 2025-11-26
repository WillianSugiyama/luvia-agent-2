/**
 * Test script to validate Supabase hybrid search RPCs
 * Run with: bun scripts/test-hybrid-search.ts
 */

import { searchProductsHybrid, searchProductRulesHybrid } from '../src/mastra/utils/supabase-hybrid-search';
import OpenAI from 'openai';

const testHybridSearch = async () => {
  console.log('🧪 Testing hybrid search RPCs...\n');

  // Initialize OpenAI for embeddings
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Test query
  const testQuery = 'curso de programação';

  console.log(`Query: "${testQuery}"\n`);

  // Generate embedding
  console.log('⏳ Generating embedding...');
  const embeddingResponse = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: testQuery,
  });
  const embedding = embeddingResponse.data[0].embedding;
  console.log(`✅ Embedding generated (${embedding.length} dimensions)\n`);

  // Test product search
  try {
    console.log('⏳ Testing match_products_hybrid RPC...');
    const productResults = await searchProductsHybrid({
      queryEmbedding: embedding,
      queryText: testQuery,
      teamId: process.env.TEST_TEAM_ID || 'test-team',
      matchThreshold: 0.15,
      bm25Weight: 0.3,
      vectorWeight: 0.7,
      resultLimit: 5,
    });

    console.log(`✅ Products RPC works! Found ${productResults.length} results`);
    if (productResults.length > 0) {
      const top = productResults[0];
      console.log(`   Top result: ${top.metadata?.name || 'N/A'} (score: ${top.combined_score.toFixed(3)})`);
      console.log(`   Breakdown: vector=${top.similarity.toFixed(3)}, bm25=${top.bm25_score.toFixed(3)}\n`);
    } else {
      console.log('   (No results found - this is OK if database is empty)\n');
    }
  } catch (error: any) {
    console.error('❌ Products RPC failed:', error.message);
    console.error('   This likely means the RPC does not exist or has wrong signature\n');
    throw error;
  }

  // Test rules search (only if we have a product_id)
  const testProductId = process.env.TEST_PRODUCT_ID;
  if (testProductId) {
    try {
      console.log('⏳ Testing match_product_rules_hybrid RPC...');
      const ruleResults = await searchProductRulesHybrid({
        queryEmbedding: embedding,
        queryText: testQuery,
        teamId: process.env.TEST_TEAM_ID || 'test-team',
        productId: testProductId,
        matchThreshold: 0.3,
        bm25Weight: 0.3,
        vectorWeight: 0.7,
        resultLimit: 5,
      });

      console.log(`✅ Rules RPC works! Found ${ruleResults.length} results`);
      if (ruleResults.length > 0) {
        const top = ruleResults[0];
        console.log(`   Top result score: ${top.combined_score.toFixed(3)}`);
        console.log(`   Breakdown: vector=${top.similarity.toFixed(3)}, bm25=${top.bm25_score.toFixed(3)}\n`);
      } else {
        console.log('   (No results found - this is OK if database is empty)\n');
      }
    } catch (error: any) {
      console.error('❌ Rules RPC failed:', error.message);
      console.error('   This likely means the RPC does not exist or has wrong signature\n');
      throw error;
    }
  } else {
    console.log('⚠️  Skipping rules RPC test (no TEST_PRODUCT_ID set)\n');
  }

  console.log('✅ All RPCs validated successfully!');
};

testHybridSearch().catch((error) => {
  console.error('\n❌ Test failed:', error);
  process.exit(1);
});
