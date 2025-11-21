create table public.customer_events (
  user_id text not null,
  team_id uuid not null,
  platform text null,
  event_type text null,
  event_timestamp timestamp without time zone null,
  customer_phone text null,
  customer_email text null,
  customer_name text null,
  product_name text null,
  created_at timestamp without time zone null,
  product_value numeric(10, 2) null default 0,
  product_id text null,
  id uuid not null default gen_random_uuid (),
  constraint customer_events_pkey primary key (id),
  constraint fk_customer_events_team_id foreign KEY (team_id) references teams (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_customer_events_metrics_analysis on public.customer_events using btree (
  team_id,
  event_type,
  customer_phone,
  event_timestamp desc,
  product_id,
  product_value
) TABLESPACE pg_default
where
  (
    (event_type = 'approved'::text)
    and (product_value > (0)::numeric)
  );

create index IF not exists idx_customer_events_phone on public.customer_events using btree (customer_phone) TABLESPACE pg_default;

create index IF not exists idx_customer_events_type on public.customer_events using btree (event_type) TABLESPACE pg_default;

create index IF not exists idx_customer_events_team_type_date on public.customer_events using btree (team_id, event_type, event_timestamp) TABLESPACE pg_default
where
  (event_type = 'purchase'::text);

create index IF not exists idx_customer_events_team_id on public.customer_events using btree (team_id) TABLESPACE pg_default;

create index IF not exists idx_customer_events_team_type_timestamp on public.customer_events using btree (team_id, event_type, event_timestamp desc) TABLESPACE pg_default
where
  (event_type = 'purchase'::text);

create index IF not exists idx_customer_events_approved_team_timestamp on public.customer_events using btree (team_id, event_timestamp, customer_phone) TABLESPACE pg_default
where
  (
    (event_type = 'approved'::text)
    and (customer_phone is not null)
  );

create index IF not exists idx_customer_events_timestamp on public.customer_events using btree (event_timestamp) TABLESPACE pg_default;

create index IF not exists idx_customer_events_phone_normalized on public.customer_events using btree (
  regexp_replace(
    customer_phone,
    '[^0-9]'::text,
    ''::text,
    'g'::text
  ),
  team_id,
  event_timestamp
) TABLESPACE pg_default
where
  (
    (event_type = 'approved'::text)
    and (customer_phone is not null)
  );

create index IF not exists idx_customer_events_team_product_email on public.customer_events using btree (team_id, product_id, customer_email) TABLESPACE pg_default;

create index IF not exists idx_customer_events_event_type_timestamp on public.customer_events using btree (event_type, event_timestamp) TABLESPACE pg_default;

create index IF not exists idx_customer_events_approved_team_product on public.customer_events using btree (team_id, product_id, event_timestamp desc) TABLESPACE pg_default
where
  (event_type = 'approved'::text);

create trigger associate_sale_conversation_trigger
after INSERT on customer_events for EACH row
execute FUNCTION associate_sale_with_conversation ();

create trigger normalize_customer_fields_trigger BEFORE INSERT
or
update on customer_events for EACH row
execute FUNCTION normalize_customer_fields ();

create trigger process_abandoned_conversion_trigger
after INSERT on customer_events for EACH row
execute FUNCTION process_abandoned_conversion ();

create trigger process_sale_with_messages_trigger
after INSERT on customer_events for EACH row
execute FUNCTION process_sale_with_messages ();