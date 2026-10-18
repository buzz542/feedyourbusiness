-- M4 classification (docs/PLAN.md 6.4): the labels the classifier adds to a product's post. No
-- author data: a tool or company name (never a person), our own paraphrased summary (never a
-- quote), and the highlight as offsets into the stored excerpt. The owner still updates only
-- `state` (the column grant from the M0 migration is unchanged).

alter table public.product_posts
  add column competitor_id uuid references public.competitors (id) on delete set null,
  add column tool_mentioned text check (char_length(tool_mentioned) <= 60),
  add column rival_issue text check (rival_issue in ('pricing', 'reliability', 'missing_feature',
    'support', 'usability', 'performance', 'integration', 'other')),
  add column rival_sentiment text check (rival_sentiment in ('negative', 'mixed', 'positive')),
  add column switching boolean not null default false,
  add column rival_summary text check (char_length(rival_summary) <= 200),
  add column highlight_start smallint check (highlight_start between 0 and 280),
  add column highlight_end smallint check (highlight_end between 1 and 280),
  add column term_id uuid references public.search_terms (id) on delete set null,
  add constraint product_posts_highlight_range
    check ((highlight_start is null) = (highlight_end is null)
      and (highlight_end is null or highlight_end > highlight_start));

create index product_posts_today_idx on public.product_posts (product_id, created_at desc)
  where state in ('new', 'saved');
create index product_posts_rival_idx on public.product_posts (product_id, competitor_id, created_at desc)
  where competitor_id is not null;
-- Foreign keys with ON DELETE SET NULL get an index each (the advisors flag unindexed ones).
create index product_posts_competitor_id_idx on public.product_posts (competitor_id);
create index product_posts_term_id_idx on public.product_posts (term_id);
