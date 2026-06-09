create table if not exists schema_migrations (
  id text primary key,
  applied_at timestamptz not null default now()
);

create table if not exists app_state (
  key text primary key,
  value_text text not null,
  value_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_app_state_updated_at on app_state (updated_at desc);
create index if not exists idx_app_state_deleted_at on app_state (deleted_at);

create table if not exists users (
  id text primary key,
  email text unique,
  name text,
  role text not null default 'user',
  password_hash text,
  credits integer not null default 0,
  raw_user jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists agents (
  id text primary key,
  name text not null,
  category text,
  type text,
  thumbnail text,
  system_prompt text,
  model_id text,
  temperature double precision,
  max_tokens integer,
  is_active boolean not null default true,
  raw_agent jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_agents_category on agents (category);
create index if not exists idx_agents_active on agents (is_active);

create table if not exists image_jobs (
  id text primary key,
  status text not null,
  media_type text,
  provider jsonb not null default '{}'::jsonb,
  request jsonb not null default '{}'::jsonb,
  result_url text,
  upstream_url text,
  error text,
  raw_job jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_image_jobs_status on image_jobs (status);
create index if not exists idx_image_jobs_media_type on image_jobs (media_type);
create index if not exists idx_image_jobs_created_at on image_jobs (created_at desc);

create table if not exists flow_projects (
  id text primary key,
  owner_user_id text references users(id) on delete set null,
  name text not null,
  raw_project jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists flow_items (
  id text primary key,
  project_id text references flow_projects(id) on delete cascade,
  owner_user_id text references users(id) on delete set null,
  kind text not null,
  title text,
  asset_url text,
  raw_item jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_flow_items_project_id on flow_items (project_id);
create index if not exists idx_flow_items_kind on flow_items (kind);

create table if not exists credit_ledger (
  id text primary key,
  user_id text references users(id) on delete set null,
  amount integer not null,
  reason text,
  reference_type text,
  reference_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_credit_ledger_user_id on credit_ledger (user_id);
create index if not exists idx_credit_ledger_created_at on credit_ledger (created_at desc);

create table if not exists credit_packages (
  id text primary key,
  name text not null,
  description text,
  credits integer not null default 0,
  bonus_credits integer not null default 0,
  price numeric(12, 2) not null default 0,
  purchase_url text,
  enabled boolean not null default true,
  sort_order integer not null default 0,
  raw_package jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_credit_packages_enabled on credit_packages (enabled);

create table if not exists redeem_codes (
  id text primary key,
  code text not null unique,
  package_id text references credit_packages(id) on delete set null,
  batch_name text,
  status text not null default 'unused',
  expires_at timestamptz,
  used_by_user_id text references users(id) on delete set null,
  used_at timestamptz,
  note text,
  raw_code jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_redeem_codes_code on redeem_codes (code);
create index if not exists idx_redeem_codes_status on redeem_codes (status);

create table if not exists credit_accounts (
  user_id text primary key references users(id) on delete cascade,
  balance integer not null default 0,
  total_earned integer not null default 0,
  total_spent integer not null default 0,
  raw_account jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists model_credit_rules (
  model_value text primary key,
  image_credits_by_resolution jsonb not null default '{}'::jsonb,
  video_credits_by_duration jsonb not null default '{}'::jsonb,
  video_credits_per_second integer,
  raw_rule jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists uploaded_assets (
  id text primary key,
  owner_user_id text references users(id) on delete set null,
  project_id text references flow_projects(id) on delete set null,
  kind text not null,
  url text not null,
  storage_key text,
  content_type text,
  byte_size bigint,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_uploaded_assets_project_id on uploaded_assets (project_id);
create index if not exists idx_uploaded_assets_kind on uploaded_assets (kind);

create table if not exists config_documents (
  name text primary key,
  body jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
