create table public.product_rule_embeddings (
  id uuid not null default extensions.uuid_generate_v4 (),
  team_id uuid not null,
  product_id uuid not null,
  rule_id uuid not null,
  embedding public.vector null,
  metadata jsonb null default '{}'::jsonb,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  source_text text null,
  product_id_plataforma text null,
  source_text_tsv tsvector GENERATED ALWAYS as (
    to_tsvector(
      'portuguese'::regconfig,
      (
        (
          (
            (COALESCE(source_text, ''::text) || ' '::text) || COALESCE((metadata ->> 'rule_title'::text), ''::text)
          ) || ' '::text
        ) || COALESCE((metadata ->> 'categoria'::text), ''::text)
      )
    )
  ) STORED null,
  constraint product_rule_embeddings_pkey primary key (id),
  constraint product_rule_embeddings_team_id_product_id_rule_id_key unique (team_id, product_id, rule_id),
  constraint product_rule_embeddings_product_id_fkey foreign KEY (product_id) references infoprodutos (id) on delete CASCADE,
  constraint product_rule_embeddings_rule_id_fkey foreign KEY (rule_id) references regras_gerais (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_product_rule_embeddings_fts on public.product_rule_embeddings using gin (source_text_tsv) TABLESPACE pg_default;

create index IF not exists product_rule_embeddings_team_id_product_id_rule_id_idx on public.product_rule_embeddings using btree (team_id, product_id, rule_id) TABLESPACE pg_default;

create index IF not exists product_rule_embeddings_embedding_idx on public.product_rule_embeddings using ivfflat (embedding)
with
  (lists = '100') TABLESPACE pg_default;

create unique INDEX IF not exists product_rule_embeddings_team_prod_rule_idx on public.product_rule_embeddings using btree (team_id, product_id, rule_id) TABLESPACE pg_default;