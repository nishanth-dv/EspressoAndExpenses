create table if not exists grow_signals (
  id text not null,
  scan_date date not null,
  symbol text,
  symbol_name text,
  type text,
  name text,
  category text,
  direction text,
  bar_time bigint,
  price numeric,
  title text,
  confidence int,
  band text,
  sort_value int,
  liquidity numeric,
  factors jsonb,
  meta jsonb,
  breakdown jsonb,
  generated_at timestamptz default now(),
  primary key (id, scan_date)
);

create index if not exists grow_signals_scan_idx on grow_signals (scan_date, sort_value desc);

create table if not exists grow_scans (
  scan_date date primary key,
  universe_size int,
  signal_count int,
  generated_at timestamptz default now()
);

alter table grow_signals enable row level security;
alter table grow_scans enable row level security;

-- Forward-grading (out-of-sample). The nightly batch fills these for past
-- signals once enough forward candles exist.
alter table grow_signals add column if not exists outcome text;
alter table grow_signals add column if not exists outcome_return numeric;
alter table grow_signals add column if not exists outcome_bars int;
alter table grow_signals add column if not exists graded_at timestamptz;

create index if not exists grow_signals_ungraded_idx on grow_signals (scan_date) where outcome is null;

-- Aggregated out-of-sample track record. Only resolved (non-pending) signals.
create or replace function grow_track()
returns table (scope text, key text, resolved bigint, wins bigint, hit_rate numeric, avg_return numeric)
language sql stable as $$
  select 'overall'::text, 'all'::text, count(*), count(*) filter (where outcome = 'win'),
         round(avg((outcome = 'win')::int), 3), round(avg(outcome_return), 4)
  from grow_signals where outcome is not null and outcome <> 'pending'
  union all
  select 'band'::text, band, count(*), count(*) filter (where outcome = 'win'),
         round(avg((outcome = 'win')::int), 3), round(avg(outcome_return), 4)
  from grow_signals where outcome is not null and outcome <> 'pending' group by band
  union all
  select 'direction'::text, direction, count(*), count(*) filter (where outcome = 'win'),
         round(avg((outcome = 'win')::int), 3), round(avg(outcome_return), 4)
  from grow_signals where outcome is not null and outcome <> 'pending' group by direction
  union all
  select 'type'::text, type, count(*), count(*) filter (where outcome = 'win'),
         round(avg((outcome = 'win')::int), 3), round(avg(outcome_return), 4)
  from grow_signals where outcome is not null and outcome <> 'pending' group by type;
$$;
