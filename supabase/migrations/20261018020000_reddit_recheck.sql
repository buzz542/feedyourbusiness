-- M3 Reddit deletion re-check (docs/PLAN.md 2.3.6, 7.7): about 72 hours after collection, each
-- stored Reddit post is re-collected once through the vendor and deleted here if it is gone. These
-- functions list the posts due (collected inside a past window, not yet expired), each attributed
-- to the product that linked it first, so a post shared by two products is re-checked once.

create index posts_source_collected_idx on public.posts (source, collected_at);

-- The product that linked a post first; it pays for the post's re-check.
create function public.first_linked_product(p_post_id uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  select pp.product_id
    from public.product_posts pp
   where pp.post_id = p_post_id
   order by pp.created_at, pp.product_id
   limit 1
$$;

create function public.reddit_recheck_products(p_from timestamptz, p_to timestamptz)
returns table (id uuid)
language sql
stable
set search_path = ''
as $$
  select distinct public.first_linked_product(p.id)
    from public.posts p
   where p.source = 'reddit'
     and p.collected_at >= p_from and p.collected_at < p_to
     and p.delete_after > now()
     and public.first_linked_product(p.id) is not null
$$;

create function public.reddit_recheck_posts(
  p_product_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_limit integer
)
returns table (external_id text, url text)
language sql
stable
set search_path = ''
as $$
  select p.external_id, p.url
    from public.posts p
   where p.source = 'reddit'
     and p.collected_at >= p_from and p.collected_at < p_to
     and p.delete_after > now()
     and public.first_linked_product(p.id) = p_product_id
   order by p.collected_at, p.id
   limit greatest(p_limit, 0)
$$;

revoke all on function public.first_linked_product(uuid) from public, anon, authenticated;
revoke all on function public.reddit_recheck_products(timestamptz, timestamptz)
  from public, anon, authenticated;
revoke all on function public.reddit_recheck_posts(uuid, timestamptz, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.first_linked_product(uuid) to service_role;
grant execute on function public.reddit_recheck_products(timestamptz, timestamptz) to service_role;
grant execute on function public.reddit_recheck_posts(uuid, timestamptz, timestamptz, integer)
  to service_role;
