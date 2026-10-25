-- M8 Settings (docs/PLAN.md 4.7): pause and resume collection. `status` is not a column users may
-- write (products_lockdown), so this one function moves a confirmed product between active and
-- paused, for its owner only. A draft never becomes active here (that is confirm_product).

create function public.set_collection_paused(p_product_id uuid, p_paused boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_status text;
begin
  update public.products p
     set status = case when p_paused then 'paused' else 'active' end
   where p.id = p_product_id
     and p.owner_id = (select auth.uid())
     and p.confirmed_at is not null
     and p.status in ('active', 'paused')
  returning p.status into next_status;
  if next_status is null then
    raise exception 'cannot change collection for this product' using errcode = 'P0002';
  end if;
  return next_status;
end;
$$;

revoke all on function public.set_collection_paused(uuid, boolean) from public, anon;
grant execute on function public.set_collection_paused(uuid, boolean) to authenticated, service_role;
