-- Migration `classification` (docs/PLAN.md 6.4): the classifier's labels on product_posts.
--
--   * Rival labels: the competitor or the tool a post names (a product or company, never a person),
--     the issue, the sentiment, switching intent and our own one-line paraphrase (never a quote).
--   * Highlight offsets into the excerpt (code points, as char_length counts), from an exact match
--     only; both or neither, and the end after the start.
--   * The search term that found the post, for the per-term view.
--   * A competitor or term from another product can never be attached (a trigger checks it).
--   * Customers still update only `state` (the column grant from rls_and_grants is unchanged), and
--     the new columns hold no author data, so `compliance:schema` still passes.

alter table public.product_posts
  add column competitor_id uuid references public.competitors (id) on delete set null,
  add column tool_mentioned text check (char_length(tool_mentioned) between 1 and 60),
  add column rival_issue text check (rival_issue in ('pricing', 'reliability', 'missing_feature',
    'support', 'usability', 'performance', 'integration', 'other')),
  add column rival_sentiment text check (rival_sentiment in ('negative', 'mixed', 'positive')),
  add column switching boolean not null default false,
  add column rival_summary text check (char_length(rival_summary) between 1 and 200),
  add column highlight_start smallint check (highlight_start between 0 and 280),
  add column highlight_end smallint check (highlight_end between 1 and 280),
  add column term_id uuid references public.search_terms (id) on delete set null,
  add constraint product_posts_highlight_range check (
    (highlight_start is null) = (highlight_end is null)
    and (highlight_end is null or highlight_end > highlight_start)),
  -- A rival label is whole or absent: issue, sentiment and summary together.
  add constraint product_posts_rival_whole check (
    (rival_issue is null) = (rival_sentiment is null)
    and (rival_issue is null) = (rival_summary is null)),
  -- Switching intent is part of a rival label.
  add constraint product_posts_switching_needs_rival check (not switching or rival_issue is not null);

create index product_posts_today_idx on public.product_posts (product_id, created_at desc)
  where state in ('new', 'saved');
create index product_posts_rival_idx on public.product_posts (product_id, competitor_id, created_at desc)
  where competitor_id is not null;
-- Foreign keys used by on delete set null.
create index product_posts_competitor_id_idx on public.product_posts (competitor_id)
  where competitor_id is not null;
create index product_posts_term_id_idx on public.product_posts (term_id) where term_id is not null;

-- A label points only at the product's own competitor and term. Runs as the writer (security
-- invoker); only the service role writes these columns.
create function private.product_posts_same_product() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.competitor_id is not null and not exists (
    select 1 from public.competitors c
     where c.id = new.competitor_id and c.product_id = new.product_id) then
    raise exception 'label: competitor of another product' using errcode = '23514';
  end if;
  if new.term_id is not null and not exists (
    select 1 from public.search_terms t
     where t.id = new.term_id and t.product_id = new.product_id) then
    raise exception 'label: term of another product' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.product_posts_same_product() from public, anon;
grant execute on function private.product_posts_same_product() to authenticated, service_role;

create trigger product_posts_same_product
  before insert or update of product_id, competitor_id, term_id on public.product_posts
  for each row execute function private.product_posts_same_product();
