-- M7 build_themes (docs/PLAN.md 6.6): theme kinds and stable keys, so a theme's trend is computed
-- against last week's row with the same key.

alter table public.themes
  add column kind text not null default 'ask'
    check (kind in ('ask', 'wish', 'pain', 'opportunity', 'rival_fix')),
  add column theme_key text check (theme_key ~ '^[a-z0-9-]{1,60}$');
create index themes_product_week_idx on public.themes (product_id, week desc);
