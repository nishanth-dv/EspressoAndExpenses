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
