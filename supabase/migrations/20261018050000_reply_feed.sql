-- M5 Reply tab (docs/PLAN.md 4.4): the feed and its counts in one round trip each. Read only, and
-- security invoker: the caller's row-level security decides what comes back, so another user's
-- rows and expired posts never do. No new table, column or grant on a table.

-- The rows of one product that pass every filter except the view.
create function public.reply_feed_rows(
  p_product uuid,
  p_category text,
  p_source text,
  p_competitor uuid,
  p_min_relevance smallint,
  p_query text
)
returns table (
  id uuid,
  relevance smallint,
  category text,
  reason text,
  state text,
  created_at timestamptz,
  highlight_start smallint,
  highlight_end smallint,
  tool_mentioned text,
  competitor_id uuid,
  competitor_name text,
  rival_issue text,
  rival_sentiment text,
  switching boolean,
  source text,
  community text,
  url text,
  excerpt text,
  posted_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select pp.id, pp.relevance, pp.category, pp.reason, pp.state, pp.created_at,
         pp.highlight_start, pp.highlight_end, pp.tool_mentioned, pp.competitor_id, c.name,
         pp.rival_issue, pp.rival_sentiment, pp.switching,
         p.source, p.community, p.url, p.excerpt, p.posted_at
  from public.product_posts pp
  join public.posts p on p.id = pp.post_id
  left join public.competitors c on c.id = pp.competitor_id
  where pp.product_id = p_product
    and (p_category is null or pp.category = p_category)
    and (p_source is null or p.source = p_source)
    and (p_competitor is null or pp.competitor_id = p_competitor)
    and pp.relevance >= greatest(coalesce(p_min_relevance, 40), 40)
    -- Text search within excerpts; % _ and \ in the search text match themselves.
    and (p_query is null or p.excerpt ilike
      '%' || replace(replace(replace(left(p_query, 100), '\', '\\'), '%', '\%'), '_', '\_') || '%')
$$;

-- Today: linked in the 24 hours before p_now, not replied or hidden. All: everything stored, not
-- hidden. Saved and Replied by state.
create function public.reply_in_view(p_view text, p_state text, p_created_at timestamptz,
  p_now timestamptz)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_view
    when 'today' then p_state in ('new', 'saved') and p_created_at > p_now - interval '24 hours'
    when 'all' then p_state <> 'hidden'
    when 'saved' then p_state = 'saved'
    when 'replied' then p_state = 'replied'
    else false
  end
$$;

create function public.reply_feed(
  p_product uuid,
  p_view text,
  p_category text default null,
  p_source text default null,
  p_competitor uuid default null,
  p_min_relevance smallint default 40,
  p_query text default null,
  p_limit integer default 50,
  p_offset integer default 0,
  p_now timestamptz default now()
)
returns table (
  id uuid,
  relevance smallint,
  category text,
  reason text,
  state text,
  created_at timestamptz,
  highlight_start smallint,
  highlight_end smallint,
  tool_mentioned text,
  competitor_id uuid,
  competitor_name text,
  rival_issue text,
  rival_sentiment text,
  switching boolean,
  source text,
  community text,
  url text,
  excerpt text,
  posted_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.*
  from public.reply_feed_rows(p_product, p_category, p_source, p_competitor, p_min_relevance,
    p_query) r
  where public.reply_in_view(p_view, r.state, r.created_at, p_now)
  -- Match score, then newest.
  order by r.relevance desc, r.posted_at desc, r.id
  limit least(greatest(coalesce(p_limit, 50), 1), 500)
  offset greatest(coalesce(p_offset, 0), 0)
$$;

create function public.reply_counts(
  p_product uuid,
  p_category text default null,
  p_source text default null,
  p_competitor uuid default null,
  p_min_relevance smallint default 40,
  p_query text default null,
  p_now timestamptz default now()
)
returns table (today integer, all_posts integer, saved integer, replied integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    (count(*) filter (where public.reply_in_view('today', r.state, r.created_at, p_now)))::integer,
    (count(*) filter (where public.reply_in_view('all', r.state, r.created_at, p_now)))::integer,
    (count(*) filter (where r.state = 'saved'))::integer,
    (count(*) filter (where r.state = 'replied'))::integer
  from public.reply_feed_rows(p_product, p_category, p_source, p_competitor, p_min_relevance,
    p_query) r
$$;

revoke all on function public.reply_feed_rows(uuid, text, text, uuid, smallint, text)
  from public, anon;
revoke all on function public.reply_in_view(text, text, timestamptz, timestamptz)
  from public, anon;
revoke all on function public.reply_feed(uuid, text, text, text, uuid, smallint, text, integer,
  integer, timestamptz) from public, anon;
revoke all on function public.reply_counts(uuid, text, text, uuid, smallint, text, timestamptz)
  from public, anon;
grant execute on function public.reply_feed_rows(uuid, text, text, uuid, smallint, text)
  to authenticated;
grant execute on function public.reply_in_view(text, text, timestamptz, timestamptz)
  to authenticated;
grant execute on function public.reply_feed(uuid, text, text, text, uuid, smallint, text, integer,
  integer, timestamptz) to authenticated;
grant execute on function public.reply_counts(uuid, text, text, uuid, smallint, text, timestamptz)
  to authenticated;
