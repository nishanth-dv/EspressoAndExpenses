-- Per-symbol bias (trend / momentum / money flow / range position) stamped on
-- every signal row by the nightly batch. Run in the Supabase SQL editor.

alter table grow_signals add column if not exists bias jsonb;

notify pgrst, 'reload schema';
