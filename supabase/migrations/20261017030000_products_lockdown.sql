-- Owners write only their product's profile fields (docs/PLAN.md 4.3; .claude/rules/privacy.md:
-- narrow column grants for anything a user may write). Status and confirmed_at change only through
-- confirm_product() and server code, so nothing is collected for a product its owner has not
-- confirmed. A product is deleted only with its account, so deleting and recreating it cannot reset
-- the per-product model spend cap (8.1).
revoke insert, update, delete on public.products from authenticated;
grant insert (owner_id, url, name) on public.products to authenticated;
grant update (url, name, one_liner, description, audience, subreddits, relevance_threshold)
  on public.products to authenticated;
drop policy products_delete_own on public.products;
