-- Page-level access, keyed by email so it applies to every authenticated user
-- (Drive users included). `pages` = the gated page keys this user may reach.
-- No row ⇒ no gated access (default deny). RLS-locked; only the service role
-- (the Worker) reads it.

create table if not exists page_access (
  email      text primary key,
  pages      jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table page_access enable row level security;

-- Grant a user access to gated pages, e.g.:
-- insert into page_access (email, pages) values
--   ('someone@gmail.com', '["advisory"]'::jsonb)
-- on conflict (email) do update set pages = excluded.pages, updated_at = now();
