-- Advisory-grade aggregates. Called by the GraphQL resolvers via the service
-- role (which bypasses RLS), scoped to the passed user id.

create or replace function spending_by_category(
  p_user_id text,
  p_since   timestamptz default null
)
returns table(category text, total numeric)
language sql
stable
as $$
  select category, sum(amount) as total
  from transactions
  where user_id = p_user_id
    and transaction_type = 'expense'
    and (p_since is null or occurred_at >= p_since)
  group by category
  order by total desc nulls last;
$$;

create or replace function allocation_by_type(p_user_id text)
returns table(type text, invested numeric, current_value numeric)
language sql
stable
as $$
  select type,
         sum(invested_amount) as invested,
         sum(current_value)   as current_value
  from investments
  where user_id = p_user_id
  group by type
  order by invested desc nulls last;
$$;
