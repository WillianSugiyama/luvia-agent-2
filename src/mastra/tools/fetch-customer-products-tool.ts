import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { executeWithLogging } from '../utils/supabase-logger';

interface CustomerEventRow {
  product_id: string;
  event_type: string;
  created_at: string;
}

interface ProductEmbeddingRow {
  product_id: string;
  metadata: {
    nome: string;
    product_id_plataforma?: string;
  };
}

let supabaseClient: SupabaseClient | null = null;

const getSupabaseClient = () => {
  if (!supabaseClient) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_KEY;

    if (!url || !key) {
      throw new Error('Supabase credentials are not configured');
    }

    supabaseClient = createClient(url, key);
  }

  return supabaseClient;
};

const fetchCustomerProductsInputSchema = z.object({
  team_id: z.string(),
  customer_phone: z.string(),
});

const fetchCustomerProductsOutputSchema = z.object({
  has_products: z.boolean(),
  products: z.array(z.object({
    product_id: z.string(), // Internal UUID
    product_id_plataforma: z.string(), // Platform ID (Hotmart, etc)
    product_name: z.string(),
    event_type: z.string(),
    created_at: z.string(),
  })),
  total_count: z.number(),
});

export const fetch_customer_products = createTool({
  id: 'fetch-customer-products',
  description: 'Fetches all products associated with a customer from customer_events, matching by product_id_plataforma',
  inputSchema: fetchCustomerProductsInputSchema,
  outputSchema: fetchCustomerProductsOutputSchema,
  execute: async (inputData, context) => {
    const { team_id, customer_phone } = inputData;
    const logger = context?.mastra?.logger;

    console.log('fetch_customer_products 2', customer_phone, team_id);

    if (!customer_phone) {
      console.log('----------TESTING E TALZ 2');
      return {
        has_products: false,
        products: [],
        total_count: 0,
      };
    }

    const supabase = getSupabaseClient();

    // 1. Fetch all customer events (APPROVED, ABANDONED, REFUND)
    console.log(`\x1b[36m[FetchCustomerProducts]\x1b[0m Querying customer_events for team_id=${team_id}, customer_phone=${customer_phone}`);

    const { data: eventsData, error: eventsError, count } = await supabase
      .from('customer_events')
      .select('product_id, event_type, created_at')
      .eq('team_id', team_id)
      .eq('customer_phone', customer_phone)
      .order('created_at', { ascending: false })

    console.log('eventsData', eventsData);
    console.log('count', count);
    console.log('eventsError', eventsError);


    if (eventsError) {
      console.error(`\x1b[31m[FetchCustomerProducts]\x1b[0m Query failed:`, eventsError);
    } else {
      console.log(`\x1b[32m[FetchCustomerProducts]\x1b[0m Query OK: ${eventsData?.length ?? 0} events found`);
    }

    if (eventsError) {
      throw eventsError;
    }

    if (!eventsData || eventsData.length === 0) {
      if (logger) {
        logger.info(`No products found for customer ${customer_phone}`);
      }
      return {
        has_products: false,
        products: [],
        total_count: 0,
      };
    }

    // 2. Get unique platform product IDs
    const platformProductIds = [...new Set(eventsData.map(e => e.product_id))];

    console.log(`\x1b[36m[FetchCustomerProducts]\x1b[0m Found ${platformProductIds.length} unique platform product IDs:`, platformProductIds);

    // 3. Fetch product metadata from product_embeddings matching by product_id_plataforma
    console.log(`\x1b[36m[FetchCustomerProducts]\x1b[0m Fetching product_embeddings for team_id=${team_id}`);

    const { data: productsData, error: productsError } = await supabase
      .from('product_embeddings')
      .select('product_id, metadata')
      .eq('team_id', team_id);

    if (productsError) {
      console.error(`\x1b[31m[FetchCustomerProducts]\x1b[0m Product embeddings query failed:`, productsError);
    } else {
      console.log(`\x1b[32m[FetchCustomerProducts]\x1b[0m Product embeddings OK: ${productsData?.length ?? 0} products found`);
    }

    if (productsError) {
      throw productsError;
    }

    // 4. Build map of platform_id -> internal_id + name
    const platformToProductMap = new Map<string, { product_id: string; product_name: string }>();

    console.log(`\x1b[36m[FetchCustomerProducts]\x1b[0m Matching platform IDs...`);

    for (const product of productsData || []) {
      // Try both field names (produto_plataforma_id is the correct one in DB)
      const platformId = (product.metadata as any).produto_plataforma_id || product.metadata.product_id_plataforma;
      console.log(`\x1b[90m[FetchCustomerProducts]\x1b[0m   Product "${product.metadata.nome}" has platform_id: ${platformId}`);

      if (platformId && platformProductIds.includes(platformId)) {
        console.log(`\x1b[32m[FetchCustomerProducts]\x1b[0m   ✓ MATCH! Platform ID ${platformId} found in customer events`);
        platformToProductMap.set(platformId, {
          product_id: product.product_id,
          product_name: product.metadata.nome,
        });
      }
    }

    console.log(`\x1b[36m[FetchCustomerProducts]\x1b[0m Total matches: ${platformToProductMap.size}`);

    // 5. Group events by platform product ID and keep latest event per product
    const latestEventsByProduct = new Map<string, CustomerEventRow>();

    for (const event of eventsData) {
      if (!latestEventsByProduct.has(event.product_id)) {
        latestEventsByProduct.set(event.product_id, event);
      }
    }

    // 6. Build final result
    const products = Array.from(latestEventsByProduct.values())
      .map(event => {
        const productInfo = platformToProductMap.get(event.product_id);
        if (!productInfo) {
          return null;
        }

        return {
          product_id: productInfo.product_id,
          product_id_plataforma: event.product_id,
          product_name: productInfo.product_name,
          event_type: event.event_type,
          created_at: event.created_at,
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);

    console.log(`\x1b[32m[FetchCustomerProducts]\x1b[0m ✅ Final result: ${products.length} products matched for customer`);
    products.forEach(p => {
      console.log(`\x1b[32m[FetchCustomerProducts]\x1b[0m   - ${p.product_name} (${p.event_type}) [platform_id: ${p.product_id_plataforma}]`);
    });

    return {
      has_products: products.length > 0,
      products,
      total_count: products.length,
    };
  },
});
