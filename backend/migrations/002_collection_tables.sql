create table if not exists collection_sources (
  id text primary key,
  provider text not null,
  name text not null,
  query text not null,
  enabled boolean not null default true,
  target_category_id text,
  target_category_name text,
  target_tags jsonb not null default '[]'::jsonb,
  auto_publish boolean not null default false,
  filter_nsfw boolean not null default true,
  max_items_per_run integer not null default 50,
  schedule_every_hours double precision,
  last_run_at timestamptz,
  raw_source jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_collection_sources_enabled on collection_sources (enabled);
create index if not exists idx_collection_sources_schedule on collection_sources (schedule_every_hours, last_run_at);

create table if not exists collection_works (
  id text primary key,
  source_id text references collection_sources(id) on delete set null,
  provider text not null,
  source_work_id text,
  source_page_url text,
  original_image_url text not null,
  display_url text not null,
  thumbnail_url text,
  title text not null,
  prompt text not null default '',
  negative_prompt text,
  model text,
  aspect_ratio text not null default '1:1',
  width integer,
  height integer,
  category_id text not null default 'style',
  category_name text not null default '风格',
  tags jsonb not null default '[]'::jsonb,
  nsfw boolean not null default false,
  quality_score double precision not null default 0,
  recommendation_score double precision not null default 0,
  featured boolean not null default false,
  featured_at timestamptz,
  status text not null default 'pending',
  failed_count integer not null default 0,
  last_failed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  collected_at timestamptz not null default now(),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists idx_collection_works_provider_source_work
  on collection_works (provider, source_work_id)
  where source_work_id is not null and deleted_at is null;

create unique index if not exists idx_collection_works_provider_original_image_url
  on collection_works (provider, original_image_url)
  where deleted_at is null;

create index if not exists idx_collection_works_feed
  on collection_works (status, nsfw, featured desc, featured_at desc, recommendation_score desc, collected_at desc)
  where deleted_at is null;

create index if not exists idx_collection_works_category
  on collection_works (category_id, status, collected_at desc)
  where deleted_at is null;

create table if not exists collection_runs (
  id text primary key,
  source_id text references collection_sources(id) on delete set null,
  provider text not null,
  query text not null,
  status text not null default 'running',
  fetched integer not null default 0,
  added integer not null default 0,
  skipped integer not null default 0,
  error text,
  raw_run jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists idx_collection_runs_source_started on collection_runs (source_id, started_at desc);
create index if not exists idx_collection_runs_started on collection_runs (started_at desc);
