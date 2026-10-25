-- M6 rivals (docs/PLAN.md 6.5, 4.5): weekly rival insights, kept after the posts expire (counts and
-- our own summaries; no names, no quotes), plus read functions for the Rivals tab that run as the
-- caller, so row-level security decides what comes back. purge_expired already clears this
-- table's example ids (collection_hardening).

create table public.rival_insights (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  competitor_id uuid references public.competitors (id) on delete cascade,
  tool_name text check (char_length(tool_name) <= 60),        -- discovered tools, product names only
  week date not null,                                         -- Monday of the ISO week, UK time
  issue text not null check (issue in ('pricing', 'reliability', 'missing_feature', 'support',
    'usability', 'performance', 'integration', 'other')),
  complaints integer not null check (complaints >= 0),
  switching integer not null check (switching >= 0),
  trend text not null default 'flat' check (trend in ('up', 'down', 'flat', 'new')),
  summary text not null check (char_length(summary) <= 600),
  example_post_ids uuid[] not null default '{}' check (cardinality(example_post_ids) <= 3),
  created_at timestamptz not null default now(),
  check (competitor_id is not null or tool_name is not null)
);
create unique index rival_insights_week_uq on public.rival_insights
  (product_id, coalesce(competitor_id::text, lower(tool_name)), week, issue);
create index rival_insights_product_week_idx on public.rival_insights (product_id, week desc);
create index rival_insights_competitor_idx on public.rival_insights (competitor_id);

alter table public.rival_insights enable row level security;
revoke all on public.rival_insights from anon, authenticated;
grant select on public.rival_insights to authenticated;

create policy rival_insights_select_own on public.rival_insights
  for select to authenticated
  using (
    exists (
      select 1 from public.products p
      where p.id = rival_insights.product_id and p.owner_id = (select auth.uid())
    )
  );

-- This week's complaints and switchers per rival (tracked competitor or discovered tool) and
-- issue, counted from our labels: complaints are negative or mixed posts, switching is the flag.
create function public.rival_counts(p_product uuid, p_since timestamptz, p_until timestamptz)
returns table (
  competitor_id uuid,
  tool_name text,
  issue text,
  complaints integer,
  switching integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select pp.competitor_id,
         case when pp.competitor_id is null then min(pp.tool_mentioned) end,
         pp.rival_issue,
         (count(*) filter (where pp.rival_sentiment in ('negative', 'mixed')))::integer,
         (count(*) filter (where pp.switching))::integer
  from public.product_posts pp
  join public.posts p on p.id = pp.post_id
  where pp.product_id = p_product
    and pp.created_at >= p_since and pp.created_at < p_until
    and pp.rival_issue is not null
    and (pp.competitor_id is not null or pp.tool_mentioned is not null)
  group by pp.competitor_id,
           case when pp.competitor_id is null then lower(pp.tool_mentioned) end,
           pp.rival_issue
$$;

-- Tools people mention that the maker does not track: not a competitor's name or alias, and not
-- the product itself. Product names only (the classifier refuses people, handles and links).
create function public.discovered_tools(p_product uuid, p_since timestamptz, p_until timestamptz)
returns table (tool_name text, mentions integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select min(pp.tool_mentioned), count(*)::integer
  from public.product_posts pp
  join public.posts p on p.id = pp.post_id
  join public.products pr on pr.id = pp.product_id
  where pp.product_id = p_product
    and pp.created_at >= p_since and pp.created_at < p_until
    and pp.competitor_id is null
    and pp.tool_mentioned is not null
    and lower(pp.tool_mentioned) <> lower(pr.name)
    and not exists (
      select 1 from public.competitors c
      where c.product_id = p_product
        and (lower(c.name) = lower(pp.tool_mentioned)
          or lower(pp.tool_mentioned) = any (select lower(a) from unnest(c.aliases) as a))
    )
  group by lower(pp.tool_mentioned)
  order by count(*) desc, min(pp.tool_mentioned)
  limit 20
$$;

-- People looking to switch: Reply card rows with switching intent, newest first (same columns as
-- reply_feed, so the Rivals tab shows them with the Reply card).
create function public.rival_switchers(
  p_product uuid,
  p_competitor uuid default null,
  p_limit integer default 20
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
  from public.reply_feed_rows(p_product, null, null, p_competitor, 40::smallint, null) r
  where r.switching and r.state <> 'hidden'
  order by r.created_at desc, r.id
  limit least(greatest(coalesce(p_limit, 20), 1), 100)
$$;

revoke all on function public.rival_counts(uuid, timestamptz, timestamptz) from public, anon;
revoke all on function public.discovered_tools(uuid, timestamptz, timestamptz) from public, anon;
revoke all on function public.rival_switchers(uuid, uuid, integer) from public, anon;
grant execute on function public.rival_counts(uuid, timestamptz, timestamptz) to authenticated, service_role;
grant execute on function public.discovered_tools(uuid, timestamptz, timestamptz) to authenticated, service_role;
grant execute on function public.rival_switchers(uuid, uuid, integer) to authenticated, service_role;
