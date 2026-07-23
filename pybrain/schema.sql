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

alter table grow_signals add column if not exists interval text default '1d';
update grow_signals set interval = '1d' where interval is null;
alter table grow_signals add column if not exists plan jsonb;
alter table grow_signals add column if not exists trade_type text;

alter table grow_scans add column if not exists interval text default '1d';
update grow_scans set interval = '1d' where interval is null;
alter table grow_scans drop constraint if exists grow_scans_pkey;
alter table grow_scans add constraint grow_scans_pkey primary key (scan_date, interval);

-- Point-in-time candle store. Appended one bhavcopy (one trading day) at a time,
-- so it accumulates survivorship-free history (each day's file contains exactly
-- what traded that day, including since-delisted names). `batch.py --ingest`.
create table if not exists grow_candles (
  symbol text not null,
  interval text not null default '1d',
  bar_time bigint not null,
  open numeric,
  high numeric,
  low numeric,
  close numeric,
  volume numeric,
  deliv_per numeric,
  ingested_at timestamptz default now(),
  primary key (symbol, interval, bar_time)
);
create index if not exists grow_candles_scan_idx on grow_candles (interval, bar_time);

alter table grow_signals enable row level security;
alter table grow_scans enable row level security;
alter table grow_candles enable row level security;

-- Forward-grading (out-of-sample). The nightly batch fills these for past
-- signals once enough forward candles exist.
alter table grow_signals add column if not exists outcome text;
alter table grow_signals add column if not exists outcome_return numeric;
alter table grow_signals add column if not exists outcome_bars int;
alter table grow_signals add column if not exists graded_at timestamptz;

create index if not exists grow_signals_ungraded_idx on grow_signals (scan_date) where outcome is null;

-- Aggregated out-of-sample track record for one interval (default daily).
-- Only resolved (non-pending) signals.
create or replace function grow_track(p_interval text default '1d')
returns table (scope text, key text, resolved bigint, wins bigint, hit_rate numeric, avg_return numeric)
language sql stable as $$
  select 'overall'::text, 'all'::text, count(*), count(*) filter (where outcome = 'win'),
         round(avg((outcome = 'win')::int), 3), round(avg(outcome_return), 4)
  from grow_signals where outcome is not null and outcome <> 'pending' and interval = p_interval
  union all
  select 'band'::text, band, count(*), count(*) filter (where outcome = 'win'),
         round(avg((outcome = 'win')::int), 3), round(avg(outcome_return), 4)
  from grow_signals where outcome is not null and outcome <> 'pending' and interval = p_interval group by band
  union all
  select 'direction'::text, direction, count(*), count(*) filter (where outcome = 'win'),
         round(avg((outcome = 'win')::int), 3), round(avg(outcome_return), 4)
  from grow_signals where outcome is not null and outcome <> 'pending' and interval = p_interval group by direction
  union all
  select 'type'::text, type, count(*), count(*) filter (where outcome = 'win'),
         round(avg((outcome = 'win')::int), 3), round(avg(outcome_return), 4)
  from grow_signals where outcome is not null and outcome <> 'pending' and interval = p_interval group by type;
$$;

-- Force PostgREST to pick up any new columns immediately (avoids PGRST204
-- "could not find column in the schema cache" after adding columns above).
notify pgrst, 'reload schema';
