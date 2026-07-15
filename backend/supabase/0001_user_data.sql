create table if not exists public.user_data (
  user_id    text primary key,
  email      text,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_data enable row level security;
