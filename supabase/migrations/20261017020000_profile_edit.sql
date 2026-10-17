-- The onboarding review step (docs/PLAN.md 4.3). Both functions run as the caller (security
-- invoker): row-level security and column grants decide what they may touch, so only the caller's
-- own product changes.

-- Every edited field in one transaction. Terms whose text is unchanged keep their row (and their
-- paused flag); competitors named by id are edited, the rest of the product's competitors are
-- removed, and new ones are added as the user's own.
create function public.save_product_profile(
  p_product_id uuid,
  p_profile jsonb,
  p_terms jsonb,
  p_competitors jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if jsonb_array_length(p_terms) > 40 or jsonb_array_length(p_competitors) > 20 then
    raise exception 'too many terms or competitors' using errcode = '22023';
  end if;

  update public.products
     set name = p_profile ->> 'name',
         one_liner = p_profile ->> 'one_liner',
         description = p_profile ->> 'description',
         audience = p_profile ->> 'audience',
         subreddits = array(select jsonb_array_elements_text(coalesce(p_profile -> 'subreddits', '[]'))),
         relevance_threshold = (p_profile ->> 'relevance_threshold')::smallint
   where id = p_product_id;
  if not found then
    raise exception 'no such product' using errcode = 'P0002';
  end if;

  delete from public.search_terms s
   where s.product_id = p_product_id
     and not exists (
       select 1 from jsonb_to_recordset(p_terms) as t(term text, intent text) where t.term = s.term
     );
  update public.search_terms s
     set intent = t.intent
    from jsonb_to_recordset(p_terms) as t(term text, intent text)
   where s.product_id = p_product_id and s.term = t.term and s.intent is distinct from t.intent;
  insert into public.search_terms (product_id, term, intent)
    select p_product_id, t.term, t.intent
    from jsonb_to_recordset(p_terms) as t(term text, intent text)
    on conflict do nothing;

  delete from public.competitors c
   where c.product_id = p_product_id
     and c.id not in (
       select x.id from jsonb_to_recordset(p_competitors) as x(id uuid) where x.id is not null
     );
  update public.competitors c
     set name = x.name, domain = x.domain, aliases = coalesce(x.aliases, '{}')
    from jsonb_to_recordset(p_competitors) as x(id uuid, name text, domain text, aliases text[])
   where c.id = x.id and c.product_id = p_product_id;
  insert into public.competitors (product_id, name, domain, aliases, origin)
    select p_product_id, x.name, x.domain, coalesce(x.aliases, '{}'), 'user'
    from jsonb_to_recordset(p_competitors) as x(id uuid, name text, domain text, aliases text[])
   where x.id is null;
end;
$$;
revoke all on function public.save_product_profile(uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.save_product_profile(uuid, jsonb, jsonb, jsonb)
  to authenticated, service_role;

-- Step 5: the draft becomes active with confirmed_at, once it has a term to search for. Nothing is
-- collected before this, and nothing until the account is entitled (checked where jobs are made).
create function public.confirm_product(p_product_id uuid)
returns timestamptz
language plpgsql
security invoker
set search_path = ''
as $$
declare
  stamped timestamptz;
begin
  update public.products p
     set status = 'active', confirmed_at = now()
   where p.id = p_product_id
     and p.status = 'draft'
     and p.confirmed_at is null
     and exists (
       select 1 from public.search_terms s
       where s.product_id = p.id and s.active and not s.paused
     )
  returning p.confirmed_at into stamped;
  if stamped is null then
    raise exception 'cannot confirm this product' using errcode = 'P0002';
  end if;
  return stamped;
end;
$$;
revoke all on function public.confirm_product(uuid) from public, anon;
grant execute on function public.confirm_product(uuid) to authenticated, service_role;
