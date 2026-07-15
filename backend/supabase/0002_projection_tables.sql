-- Phase 1: normalized projection tables. The user_data blob remains the source
-- of truth; the backend projects it into these tables on every save. All tables
-- are RLS-locked (no policies) so only the service role reaches them.

create table if not exists transactions (
  id                        text primary key,
  user_id                   text not null,
  transaction_type          text,
  amount                    numeric,
  category                  text,
  name                      text,
  payment_mode              text,
  occurred_at               timestamptz,
  created_at                timestamptz,
  account_id                text,
  from_account_id           text,
  to_account_id             text,
  card_id                   text,
  subscription_id           text,
  sip_investment_id         text,
  lic_policy_id             text,
  auto_deduct_investment_id text,
  repayment_for             text,
  reference                 text,
  raw                       jsonb not null
);
create index if not exists idx_tx_user_date on transactions (user_id, occurred_at desc);
create index if not exists idx_tx_user_type on transactions (user_id, transaction_type);
create index if not exists idx_tx_user_category on transactions (user_id, category);

create table if not exists investments (
  id              text primary key,
  user_id         text not null,
  type            text,
  name            text,
  ticker          text,
  invested_amount numeric,
  current_value   numeric,
  quantity        numeric,
  buy_price       numeric,
  current_price   numeric,
  start_date      timestamptz,
  raw             jsonb not null
);
create index if not exists idx_inv_user_type on investments (user_id, type);

create table if not exists accounts (
  id      text primary key,
  user_id text not null,
  name    text,
  bank    text,
  raw     jsonb not null
);
create index if not exists idx_acc_user on accounts (user_id);

create table if not exists subscriptions (
  id        text primary key,
  user_id   text not null,
  name      text,
  amount    numeric,
  cycle     text,
  status    text,
  raw       jsonb not null
);
create index if not exists idx_sub_user on subscriptions (user_id);

create table if not exists cards (
  id      text primary key,
  user_id text not null,
  name    text,
  raw     jsonb not null
);
create index if not exists idx_card_user on cards (user_id);

create table if not exists commitments (
  id      text primary key,
  user_id text not null,
  name    text,
  type    text,
  raw     jsonb not null
);
create index if not exists idx_commit_user on commitments (user_id);

create table if not exists lendings (
  id      text primary key,
  user_id text not null,
  name    text,
  raw     jsonb not null
);
create index if not exists idx_lend_user on lendings (user_id);

create table if not exists goals (
  id      text primary key,
  user_id text not null,
  name    text,
  raw     jsonb not null
);
create index if not exists idx_goal_user on goals (user_id);

create table if not exists notes (
  id          text primary key,
  user_id     text not null,
  scope       text,
  page_key    text,
  entity_type text,
  entity_id   text,
  pinned      boolean,
  remind_at   timestamptz,
  updated_at  timestamptz,
  raw         jsonb not null
);
create index if not exists idx_notes_user on notes (user_id);
create index if not exists idx_notes_user_entity on notes (user_id, entity_type, entity_id);

alter table transactions  enable row level security;
alter table investments   enable row level security;
alter table accounts      enable row level security;
alter table subscriptions enable row level security;
alter table cards         enable row level security;
alter table commitments   enable row level security;
alter table lendings      enable row level security;
alter table goals         enable row level security;
alter table notes         enable row level security;
