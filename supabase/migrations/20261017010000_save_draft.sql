-- The onboarding draft (docs/PLAN.md 4.3, 8.3), saved in one transaction: the URL it was drafted
-- from, the profile, the search terms and the draft's competitors. Runs as the caller (security invoker), so row-level security and
-- column grants decide what it may touch: only the caller's own product, and only while it is a draft.
-- A new draft replaces the earlier draft's terms and competitors; competitors the user added stay.
create function public.save_product_draft(
  p_product_id uuid,
  p_url text,
  p_name text,
  p_one_liner text,
  p_description text,
  p_audience text,
  p_subreddits text[],
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
     set url = p_url,
         name = p_name,
         one_liner = p_one_liner,
         description = p_description,
         audience = p_audience,
         subreddits = p_subreddits
   where id = p_product_id and status = 'draft' and confirmed_at is null;
  if not found then
    raise exception 'not a draft product' using errcode = 'P0002';
  end if;

  delete from public.search_terms where product_id = p_product_id;
  insert into public.search_terms (product_id, term, intent)
    select p_product_id, t.term, t.intent
    from jsonb_to_recordset(p_terms) as t(term text, intent text)
    on conflict do nothing;

  delete from public.competitors where product_id = p_product_id and origin = 'draft';
  insert into public.competitors (product_id, name, domain, origin)
    select p_product_id, c.name, c.domain, 'draft'
    from jsonb_to_recordset(p_competitors) as c(name text, domain text)
    on conflict do nothing;
end;
$$;
revoke all on function public.save_product_draft(uuid, text, text, text, text, text, text[], jsonb, jsonb)
  from public, anon;
grant execute on function public.save_product_draft(uuid, text, text, text, text, text, text[], jsonb, jsonb)
  to authenticated, service_role;
