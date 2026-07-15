-- Advisory market data: shared, non-personal rates served dynamically to the
-- engine (which runs on the client). Free, server-sourced, updatable without an
-- app redeploy. RLS-locked; the Worker (service role) reads it.

create table if not exists advisory_rates (
  key    text primary key,
  value  numeric,
  label  text,
  as_of  timestamptz not null default now(),
  source text
);

alter table advisory_rates enable row level security;

insert into advisory_rates (key, value, label, source) values
  ('savings',     3.5, 'Savings account',      'typical'),
  ('liquid_fund', 6.8, 'Liquid fund',          'typical'),
  ('arbitrage',   6.5, 'Arbitrage fund',       'typical'),
  ('fd_1y',       7.4, 'Best 1-yr FD',         'curated'),
  ('ppf',         7.1, 'PPF',                  'govt'),
  ('scss',        8.2, 'SCSS',                 'govt'),
  ('nsc',         7.7, 'NSC',                  'govt'),
  ('ssy',         8.2, 'Sukanya Samriddhi',    'govt'),
  ('gsec_10y',    7.0, '10-yr G-Sec',          'rbi'),
  ('repo',        6.5, 'RBI repo',             'rbi')
on conflict (key) do nothing;
