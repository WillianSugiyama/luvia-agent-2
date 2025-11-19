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

export interface ConversationState {
  conversation_id: string;
  current_product_id: string | null;
  product_history: ProductHistoryItem[];
  is_confirmed: boolean;
  last_intent: string | null;
}
