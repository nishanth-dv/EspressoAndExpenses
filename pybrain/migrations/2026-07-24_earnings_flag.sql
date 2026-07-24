-- Migration — earnings-avoidance flag on grow_signals, plus a PostgREST reload.
--
-- Idempotent: safe to run any number of times. Paste into the Supabase SQL
-- editor and Run, then re-trigger the workflow.
--
-- The batch writes `earnings_in` (days until the symbol's next results, when
-- within the hold window) on daily/BTST signals. Without the column the write
-- fails PGRST204; the final notify makes it visible to the API immediately.

alter table grow_signals add column if not exists earnings_in int;

notify pgrst, 'reload schema';
