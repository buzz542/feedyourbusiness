-- A collect job's budget, reserved and settled exactly once per job (docs/PLAN.md 7.2, 7.3): the
-- reservation is written into the job's payload in the same transaction that consumes the budget,
-- so a job that crashes and runs again finds it already reserved and never charges twice.

-- 'reserved', 'already' (this job reserved before), 'refused' (over the product's daily limit) or
-- 'monthly_cap' (over the vendor's monthly records across all products, when p_monthly_cap is set).
create function public.reserve_job_budget(
  p_job_id uuid,
  p_product_id uuid,
  p_source text,
  p_day date,
  p_units integer,
  p_limit integer,
  p_monthly_cap integer default null,
  p_month_start date default null
)
returns text
language plpgsql
set search_path = ''
as $$
declare
  current jsonb;
begin
  select payload into current from public.jobs where id = p_job_id for update;
  if current is null then
    raise exception 'no such job' using errcode = 'P0002';
  end if;
  if current ? 'reserved' then
    return 'already';
  end if;
  if p_monthly_cap is not null
     and public.vendor_usage(p_source, p_month_start) + p_units > p_monthly_cap then
    return 'monthly_cap';
  end if;
  if not public.consume_budget(p_product_id, p_source, p_day, p_units, p_limit) then
    return 'refused';
  end if;
  update public.jobs
     set payload = payload || jsonb_build_object(
       'reserved', p_units, 'day', p_day, 'budget_product', p_product_id, 'budget_source', p_source)
   where id = p_job_id;
  return 'reserved';
end;
$$;

-- Gives back what the job reserved but did not use, and adds the cost, once. False when there is
-- nothing to settle (no reservation, or already settled).
create function public.settle_job_budget(p_job_id uuid, p_actual integer, p_cost_usd numeric)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  current jsonb;
begin
  select payload into current from public.jobs where id = p_job_id for update;
  if current is null or not (current ? 'reserved') or current ? 'settled' then
    return false;
  end if;
  perform public.settle_budget(
    (current ->> 'budget_product')::uuid,
    current ->> 'budget_source',
    (current ->> 'day')::date,
    (current ->> 'reserved')::integer,
    p_actual,
    p_cost_usd
  );
  update public.jobs set payload = payload || jsonb_build_object('settled', true) where id = p_job_id;
  return true;
end;
$$;

-- Products the daily collect runs for: confirmed, active (not paused) and owned by an entitled
-- account (trialing or active, as src/server/billing/constants.ts ENTITLED_STATUSES).
create function public.collectable_products()
returns table (id uuid)
language sql
stable
set search_path = ''
as $$
  select p.id
  from public.products p
  join public.profiles pr on pr.id = p.owner_id
  where p.status = 'active'
    and p.confirmed_at is not null
    and pr.subscription_status in ('trialing', 'active')
$$;

revoke all on function public.reserve_job_budget(uuid, uuid, text, date, integer, integer, integer, date)
  from public, anon, authenticated;
revoke all on function public.settle_job_budget(uuid, integer, numeric) from public, anon, authenticated;
revoke all on function public.collectable_products() from public, anon, authenticated;
grant execute on function public.reserve_job_budget(uuid, uuid, text, date, integer, integer, integer, date)
  to service_role;
grant execute on function public.settle_job_budget(uuid, integer, numeric) to service_role;
grant execute on function public.collectable_products() to service_role;
