-- Live random-entry baseline. Every scan also records N random (symbol, today)
-- entries from the same universe, graded forward with the same exits as real
-- signals. Without this the live track record reports absolute return, which
-- includes whatever the market did — the exact mistake the backtest made until
-- 2026-07-29. Run in the Supabase SQL editor.

create table if not exists grow_random (
  id text not null,
  scan_date date not null,
  interval text not null,
  symbol text not null,
  bar_time bigint not null,
  price numeric,
  outcome text,
  outcome_return numeric,
  outcome_bars int,
  graded_at timestamptz,
  primary key (id, scan_date)
);

create index if not exists grow_random_interval_idx on grow_random (interval, scan_date);
create index if not exists grow_random_ungraded_idx on grow_random (interval, scan_date) where outcome is null;

-- grow_track gains a 'random' scope alongside overall/band/direction/type, so
-- the UI can show edge = signal - random instead of an unbenchmarked number.
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
  from grow_signals where outcome is not null and outcome <> 'pending' and interval = p_interval group by type
  union all
  select 'random'::text, 'all'::text, count(*), count(*) filter (where outcome = 'win'),
         round(avg((outcome = 'win')::int), 3), round(avg(outcome_return), 4)
  from grow_random where outcome is not null and outcome <> 'pending' and interval = p_interval;
$$;

notify pgrst, 'reload schema';
