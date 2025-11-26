import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

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

const fetchCustomerPurchasesInputSchema = z.object({
  team_id: z.string(),
  customer_phone: z.string(),
});

const fetchCustomerPurchasesOutputSchema = z.object({
  purchased_products: z.array(
    z.object({
      product_id: z.string(),
      product_name: z.string(),
      purchase_date: z.string(),
      event_type: z.enum(['APPROVED', 'REFUND']),
    })
  ),
  has_multiple_products: z.boolean(),
});

interface CustomerEventRow {
  product_id: string;
  event_type: string;
  created_at: string;
}

interface ProductEmbeddingRow {
  product_id: string;
  metadata: { nome?: string };
}

export const fetch_customer_purchases = createTool({
  id: 'fetch-customer-purchases',
  description: 'Fetches all products purchased (APPROVED status) by a customer',
  inputSchema: fetchCustomerPurchasesInputSchema,
  outputSchema: fetchCustomerPurchasesOutputSchema,
  execute: async (inputData, context) => {
    const { team_id, customer_phone } = inputData;
    const logger = context?.mastra?.logger;

    console.log(`\x1b[36m[FetchPurchases]\x1b[0m Fetching purchases for customer=${customer_phone}, team=${team_id}`);

    const supabase = getSupabaseClient();

    // Fetch all customer events (APPROVED or REFUND)
    const { data: events, error: eventsError } = await supabase
      .from('customer_events')
      .select('product_id, event_type, created_at')
      .eq('team_id', team_id)
      .eq('customer_phone', customer_phone)
      .in('event_type', ['approved', 'refund'])
      .order('created_at', { ascending: false });

    if (eventsError) {
      console.error(`\x1b[31m[FetchPurchases]\x1b[0m Error fetching events: ${eventsError.message}`);
      if (logger) {
        logger.error(`Failed to fetch customer events: ${eventsError.message}`);
      }
      throw eventsError;
    }

    const eventRows = (events ?? []) as CustomerEventRow[];

    if (eventRows.length === 0) {
      console.log(`\x1b[33m[FetchPurchases]\x1b[0m No purchases found for customer`);
      return {
        purchased_products: [],
        has_multiple_products: false,
      };
    }

    // Get unique product IDs (latest event per product)
    const productMap = new Map<string, { event_type: string; created_at: string }>();

    for (const event of eventRows) {
      if (!productMap.has(event.product_id)) {
        productMap.set(event.product_id, {
          event_type: event.event_type,
          created_at: event.created_at,
        });
      }
    }

    const uniqueProductIds = Array.from(productMap.keys());

    console.log(`\x1b[36m[FetchPurchases]\x1b[0m Found ${uniqueProductIds.length} unique products`);

    // Fetch product names from product_embeddings
    const { data: products, error: productsError } = await supabase
      .from('product_embeddings')
      .select('product_id, metadata')
      .eq('team_id', team_id)
      .in('product_id', uniqueProductIds);

    if (productsError) {
      console.error(`\x1b[31m[FetchPurchases]\x1b[0m Error fetching product metadata: ${productsError.message}`);
      if (logger) {
        logger.error(`Failed to fetch product metadata: ${productsError.message}`);
      }
      throw productsError;
    }

    const productRows = (products ?? []) as ProductEmbeddingRow[];

    // Map product names
    const productNameMap = new Map<string, string>();
    for (const product of productRows) {
      const name = product.metadata?.nome ?? product.product_id;
      productNameMap.set(product.product_id, name);
    }

    // Build result
    const purchasedProducts = uniqueProductIds.map((productId) => {
      const event = productMap.get(productId)!;
      return {
        product_id: productId,
        product_name: productNameMap.get(productId) ?? productId,
        purchase_date: event.created_at,
        event_type: event.event_type as 'APPROVED' | 'REFUND',
      };
    });

    // Filter out refund products (customer no longer owns them)
    const activeProducts = purchasedProducts.filter((p) => p.event_type === 'approved');

    console.log(`\x1b[32m[FetchPurchases]\x1b[0m Customer owns ${activeProducts.length} active products`);
    if (logger) {
      logger.info(`Customer owns ${activeProducts.length} active products (${uniqueProductIds.length} total events)`);
    }

    return {
      purchased_products: activeProducts,
      has_multiple_products: activeProducts.length > 1,
    };
  },
});
