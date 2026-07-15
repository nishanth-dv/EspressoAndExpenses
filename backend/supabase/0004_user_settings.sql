-- Phase 7: the non-collection config (preferences, categories, lists,
-- investmentTypes, autoRead, notificationDismissals, meta, insights, …) as a
-- single per-user jsonb. The collections live in their own normalized tables;
-- this holds everything else so the whole dataset can be assembled from storage.

create table if not exists user_settings (
  user_id    text primary key,
  settings   jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table user_settings enable row level security;
