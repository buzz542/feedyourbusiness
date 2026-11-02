-- Migration `reply_feed` (docs/PLAN.md 4.4, 5.2): one view the Reply tab reads, joining a product's
-- labels to the post's content. security_invoker, so the reader's own RLS applies to both tables:
-- an owner sees only their products' links, and only posts still inside retention (2.3.4). The
-- service role bypasses RLS, so its readers (the daily email) filter delete_after themselves. It
-- exposes no author column (D5), and no function is added.

create view public.feed_items with (security_invoker = true) as
select
  pp.id,
  pp.product_id,
  pp.state,
  pp.relevance,
  pp.category,
  pp.reason,
  pp.created_at,
  pp.highlight_start,
  pp.highlight_end,
  pp.competitor_id,
  pp.tool_mentioned,
  pp.switching,
  pp.rival_issue,
  pp.rival_sentiment,
  p.source,
  p.url,
  p.excerpt,
  p.posted_at,
  p.community
from public.product_posts pp
join public.posts p on p.id = pp.post_id;

revoke all on public.feed_items from public, anon, authenticated, service_role;
grant select on public.feed_items to authenticated, service_role;
