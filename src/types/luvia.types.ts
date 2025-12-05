export type CustomerEventType = 'ABANDONED' | 'APPROVED' | 'REFUND' | 'purchase';

export interface CustomerEvent {
  id: string;
  team_id: string;
  customer_phone: string;
  event_type: CustomerEventType;
  product_id: string;
  created_at: string;
}

export interface ProductMetadata {
  nome: string;
  preco: number;
  link_checkout: string;
  pagina_vendas: string;
  cupom: string | null;
  product_id_plataforma?: string; // ID do produto na plataforma (Hotmart, etc) - usado para match com customer_events
  produto_plataforma_id?: string; // Same as above, but with Portuguese field name (actual DB field name)
}

export interface ProductEmbedding {
  id: string;
  team_id: string;
  metadata: ProductMetadata;
}

export type ProductRuleMetadata = Record<string, unknown>;

export interface ProductRuleEmbedding {
  id: string;
  team_id: string;
  product_id: string;
  metadata: ProductRuleMetadata;
}

export interface SalesFrameworkOutput {
  output: {
    max_caracteres: number;
    frameworks_utilizados: string[];
    deve_ofertar: boolean;
    timing_oferta: string;
    call_to_action: string;
    observacoes_especiais: string;
    instrucoes_execucao: string;
    source: string;
  };
}

export interface ProductHistoryItem {
  id: string;
  timestamp: number;
}

export interface PendingContextSwitch {
  from_product_id: string;
  from_product_name: string;
  to_product_id: string;
  to_product_name: string;
  from_mode: 'support' | 'sales';
  to_mode: 'support' | 'sales';
  timestamp: number;
}

export interface PendingProductConfirmation {
  suggested_product_id: string;
  suggested_product_name: string;
  event_type: 'ABANDONED' | 'APPROVED' | 'REFUND';
  reason: string; // 'customer_history' | 'single_product' | 'multi_product_selected'
  timestamp: number;
}

export interface MultiProductSelectionItem {
  index: number; // 1, 2, 3...
  product_id: string;
  product_name: string;
  event_type: string;
}

export interface PendingMultiProductSelection {
  products: MultiProductSelectionItem[];
  original_message: string; // The original user question/intent before product selection
  original_intent?: string; // The detected intent type (support, pricing, etc.)
  timestamp: number;
}

export interface ConversationState {
  conversation_id: string;
  current_product_id: string | null;
  product_history: ProductHistoryItem[];
  is_confirmed: boolean;
  last_intent: string | null;

  // Multi-product support fields
  purchased_products: string[];                   // Cache of customer's purchased products
  active_support_product_id: string | null;       // Product actively being supported
  support_mode_since: number | null;              // Timestamp when support mode started
  pending_context_switch: PendingContextSwitch | null; // Pending confirmation for context switch
  pending_product_confirmation: PendingProductConfirmation | null; // Pending confirmation for product from history
  pending_multi_product_selection: PendingMultiProductSelection | null; // Pending selection from multi-product list
}
