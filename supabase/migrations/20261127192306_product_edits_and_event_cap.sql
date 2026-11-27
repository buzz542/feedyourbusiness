-- product_edits_and_event_cap (code review of the redesign, 27 Nov 2026).

-- 1. The product page saves a confirmed product's profile and its search terms in one
--    transaction, as the owner: security invoker, so RLS and the column grants decide, as with
--    apply_onboarding_edits (which edits drafts only). A failed term rolls the profile back, and a
--    product is never left with no terms. Removals run first, so the 40-term cap never blocks a swap.
create function public.apply_product_edits(
  p_product_id uuid,
  p_profile jsonb,
  p_terms jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  updated integer;
begin
  if jsonb_typeof(p_terms) <> 'array' or jsonb_array_length(p_terms) = 0 then
    raise exception 'a product keeps at least one search term' using errcode = 'check_violation';
  end if;

  update public.products set
    name = p_profile ->> 'name',
    url = p_profile ->> 'url',
    one_liner = p_profile ->> 'one_liner',
    description = p_profile ->> 'description',
    audience = p_profile ->> 'audience',
    relevance_threshold = (p_profile ->> 'relevance_threshold')::smallint
  where id = p_product_id and status <> 'draft';
  get diagnostics updated = row_count;
  if updated = 0 then
    raise exception 'no confirmed product to edit' using errcode = 'P0002';
  end if;

  delete from public.search_terms t
   where t.product_id = p_product_id
     and lower(t.term) <> all (
       select lower(e ->> 'term') from jsonb_array_elements(p_terms) as e);
  update public.search_terms t set term = e ->> 'term'
    from jsonb_array_elements(p_terms) as e
   where t.product_id = p_product_id and lower(t.term) = lower(e ->> 'term')
     and t.term <> e ->> 'term';
  insert into public.search_terms (product_id, term, intent)
    select p_product_id, e ->> 'term', e ->> 'intent' from jsonb_array_elements(p_terms) as e
     where not exists (select 1 from public.search_terms t
                        where t.product_id = p_product_id and lower(t.term) = lower(e ->> 'term'));
end;
$$;
revoke all on function public.apply_product_edits(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.apply_product_edits(uuid, jsonb, jsonb) to authenticated;

-- 2. The homepage's two anonymous events, under a daily cap per name (UTC day of p_now), so a
--    script posting in a loop can neither fill the table nor skew the counts past the cap.
--    Server-side only, with the service role.
create function public.record_public_event(
  p_name text,
  p_props jsonb,
  p_now timestamptz,
  p_daily_cap integer
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  day_start timestamptz := date_trunc('day', p_now at time zone 'UTC') at time zone 'UTC';
begin
  if p_name not in ('cta_clicked', 'example_viewed') then
    raise exception 'not a public event' using errcode = 'check_violation';
  end if;
  -- One counter per name and day at a time, so concurrent calls cannot both pass the cap.
  perform pg_advisory_xact_lock(hashtext('record_public_event:' || p_name));
  if (select count(*) from public.events
       where name = p_name and at >= day_start and at < day_start + interval '1 day')
     >= p_daily_cap then
    return false;
  end if;
  insert into public.events (user_id, name, props, at) values (null, p_name, p_props, p_now);
  return true;
end;
$$;
revoke all on function public.record_public_event(text, jsonb, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.record_public_event(text, jsonb, timestamptz, integer)
  to service_role;
