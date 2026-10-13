-- Row-level security and grants (M0). RLS on every table, no exceptions.
--
-- Model:
--   * `anon` gets nothing. The marketing site and the instant preview go through server routes.
--   * `authenticated` gets owner-scoped access and only the columns it needs to write.
--   * The service role (server only) bypasses RLS. Billing, collection, suppression and
--     removal handling run there.
--   * Compliance tables have an explicit deny-all policy so the intent is visible.

-- Functions that must never be callable through the API.
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.audit_log_is_append_only() from public, anon, authenticated;

-- Start from zero for the API roles, then grant back exactly what is needed.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
-- EXECUTE for PUBLIC is a global default, so it cannot be revoked per schema.
alter default privileges revoke execute on functions from public;

alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.search_terms enable row level security;
alter table public.posts enable row level security;
alter table public.product_posts enable row level security;
alter table public.themes enable row level security;
alter table public.suppression enable row level security;
alter table public.removal_requests enable row level security;
alter table public.usage_ledger enable row level security;
alter table public.audit_log enable row level security;
alter table public.billing_events enable row level security;

-- ---------------------------------------------------------------------------
-- profiles: read own row; update only the marketing preference.
-- Billing columns are written by the Stripe webhook (service role) and are not
-- grantable to authenticated users.
-- ---------------------------------------------------------------------------

grant select on public.profiles to authenticated;
grant update (marketing_opt_in, marketing_opt_in_at) on public.profiles to authenticated;

create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- products and search_terms: owner has full control.
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on public.products to authenticated;

create policy products_select_own on public.products
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy products_insert_own on public.products
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy products_update_own on public.products
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy products_delete_own on public.products
  for delete to authenticated
  using (owner_id = (select auth.uid()));

grant select, insert, update, delete on public.search_terms to authenticated;

create policy search_terms_select_own on public.search_terms
  for select to authenticated
  using (
    exists (
      select 1 from public.products p
      where p.id = search_terms.product_id and p.owner_id = (select auth.uid())
    )
  );

create policy search_terms_insert_own on public.search_terms
  for insert to authenticated
  with check (
    exists (
      select 1 from public.products p
      where p.id = search_terms.product_id and p.owner_id = (select auth.uid())
    )
  );

create policy search_terms_update_own on public.search_terms
  for update to authenticated
  using (
    exists (
      select 1 from public.products p
      where p.id = search_terms.product_id and p.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.products p
      where p.id = search_terms.product_id and p.owner_id = (select auth.uid())
    )
  );

create policy search_terms_delete_own on public.search_terms
  for delete to authenticated
  using (
    exists (
      select 1 from public.products p
      where p.id = search_terms.product_id and p.owner_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- posts: readable only when one of the caller's products matched the post.
-- Never writable by API roles. Collection and purge run as the service role.
-- ---------------------------------------------------------------------------

grant select on public.posts to authenticated;

create policy posts_select_matched on public.posts
  for select to authenticated
  using (
    exists (
      select 1
      from public.product_posts pp
      join public.products p on p.id = pp.product_id
      where pp.post_id = posts.id and p.owner_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- product_posts: owner reads; owner may change only `state`.
-- ---------------------------------------------------------------------------

grant select on public.product_posts to authenticated;
grant update (state) on public.product_posts to authenticated;

create policy product_posts_select_own on public.product_posts
  for select to authenticated
  using (
    exists (
      select 1 from public.products p
      where p.id = product_posts.product_id and p.owner_id = (select auth.uid())
    )
  );

create policy product_posts_update_own on public.product_posts
  for update to authenticated
  using (
    exists (
      select 1 from public.products p
      where p.id = product_posts.product_id and p.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.products p
      where p.id = product_posts.product_id and p.owner_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- themes and usage_ledger: owner reads, service role writes.
-- ---------------------------------------------------------------------------

grant select on public.themes to authenticated;

create policy themes_select_own on public.themes
  for select to authenticated
  using (
    exists (
      select 1 from public.products p
      where p.id = themes.product_id and p.owner_id = (select auth.uid())
    )
  );

grant select on public.usage_ledger to authenticated;

create policy usage_ledger_select_own on public.usage_ledger
  for select to authenticated
  using (
    exists (
      select 1 from public.products p
      where p.id = usage_ledger.product_id and p.owner_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- Server-only tables: explicit deny-all for API roles.
-- ---------------------------------------------------------------------------

create policy suppression_deny_all on public.suppression
  for all to anon, authenticated using (false) with check (false);

create policy removal_requests_deny_all on public.removal_requests
  for all to anon, authenticated using (false) with check (false);

create policy audit_log_deny_all on public.audit_log
  for all to anon, authenticated using (false) with check (false);

create policy billing_events_deny_all on public.billing_events
  for all to anon, authenticated using (false) with check (false);
