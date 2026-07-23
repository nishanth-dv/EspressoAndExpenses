-- Migration — market-sentiment columns on grow_scans, plus a defensive
-- re-assert of the recent grow_signals columns, and a PostgREST cache reload.
--
-- Idempotent: every statement is "add column if not exists" / notify, so it is
-- safe to run any number of times. Paste into the Supabase SQL editor and Run.
--
-- Why the re-asserts: the batch writes `plan`/`trade_type` on every signal row
-- and `vix`/`sentiment` on every scan row. If any of those columns are missing,
-- the write fails with PGRST204 ("could not find the column in the schema
-- cache"). Re-asserting them here guarantees the DB is current, and the final
-- notify forces PostgREST to refresh so new columns are visible immediately.

-- grow_signals: actionable trade plan (added with "signals -> calls")
alter table grow_signals add column if not exists plan jsonb;
alter table grow_signals add column if not exists trade_type text;

-- grow_scans: market sentiment (India VIX regime), stored per scan
alter table grow_scans add column if not exists vix numeric;
alter table grow_scans add column if not exists sentiment text;

-- Force PostgREST to pick up the new columns immediately
notify pgrst, 'reload schema';
