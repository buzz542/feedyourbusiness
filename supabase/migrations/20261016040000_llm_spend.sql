-- Spend sums for the model spend caps (docs/PLAN.md 8.1): one product's spend this month, or
-- everyone's today (no product given). A function, so the sum never depends on how many rows an API
-- call may return.
create function public.llm_spend_since(p_since timestamptz, p_product_id uuid default null)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(cost_usd), 0)
  from public.llm_usage
  where created_at >= p_since
    and (p_product_id is null or product_id = p_product_id)
$$;
revoke all on function public.llm_spend_since(timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.llm_spend_since(timestamptz, uuid) to service_role;
