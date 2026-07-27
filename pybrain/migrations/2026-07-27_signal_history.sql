-- Migration — per-symbol pattern history on grow_signals, plus a PostgREST reload.
--
-- Idempotent: safe to run any number of times. Paste into the Supabase SQL
-- editor and Run, then re-trigger the workflow.
--
-- The batch writes `history` for every signal: how that *same pattern* resolved
-- on that *same symbol* in its own past — {resolved, wins, hitRate,
-- medianWinBars, horizon}. medianWinBars answers "how many bars did it take to
-- get there". Without the column the write fails PGRST204; the notify makes it
-- visible to the API immediately.

alter table grow_signals add column if not exists history jsonb;

notify pgrst, 'reload schema';
