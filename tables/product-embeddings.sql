create table public.product_embeddings (
  id uuid not null default extensions.uuid_generate_v4 (),
  team_id uuid not null,
  product_id uuid not null,
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
            (
              (
                (COALESCE(source_text, ''::text) || ' '::text) || COALESCE((metadata ->> 'nome'::text), ''::text)
              ) || ' '::text
            ) || COALESCE((metadata ->> 'descricao'::text), ''::text)
          ) || ' '::text
        ) || COALESCE((metadata ->> 'categoria'::text), ''::text)
      )
    )
  ) STORED null,
  constraint product_embeddings_pkey primary key (id),
  constraint product_embeddings_team_id_product_id_key unique (team_id, product_id),
  constraint product_embeddings_team_product_uniq unique (team_id, product_id),
  constraint product_embeddings_product_id_fkey foreign KEY (product_id) references infoprodutos (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_product_embeddings_fts on public.product_embeddings using gin (source_text_tsv) TABLESPACE pg_default;

create index IF not exists idx_product_embeddings_vector on public.product_embeddings using hnsw (embedding vector_cosine_ops) TABLESPACE pg_default;

create index IF not exists idx_product_embeddings_team_id on public.product_embeddings using btree (team_id) TABLESPACE pg_default;

create index IF not exists idx_product_embeddings_team_product on public.product_embeddings using btree (team_id, product_id_plataforma) TABLESPACE pg_default;

create index IF not exists product_embeddings_team_id_product_id_idx on public.product_embeddings using btree (team_id, product_id) TABLESPACE pg_default;

create index IF not exists product_embeddings_embedding_idx on public.product_embeddings using ivfflat (embedding)
with
  (lists = '100') TABLESPACE pg_default;