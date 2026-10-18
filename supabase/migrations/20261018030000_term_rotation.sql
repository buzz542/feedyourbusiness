-- M3 term rotation (docs/PLAN.md 7.3 step 2): a product's active, unpaused terms for one source,
-- least recently collected for that source first (never collected first of all), then in the order
-- they were added. Reddit takes the first 12 a day, so every term is reached within a few days; free
-- sources take them all.

create function public.collect_terms(p_product_id uuid, p_source text, p_limit integer)
returns table (id uuid, term text)
language sql
stable
set search_path = ''
as $$
  select t.id, t.term
    from public.search_terms t
    left join lateral (
      select max(ts.day) as last_day
        from public.term_stats ts
       where ts.term_id = t.id and ts.source = p_source
    ) s on true
   where t.product_id = p_product_id
     and t.active
     and not t.paused
   order by s.last_day asc nulls first, t.created_at, t.id
   limit greatest(p_limit, 0)
$$;

revoke all on function public.collect_terms(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.collect_terms(uuid, text, integer) to service_role;
