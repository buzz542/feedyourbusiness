import type { PGlite } from "@electric-sql/pglite";

/**
 * Everything about the `public` and `private` schemas that decides behavior: relations and RLS,
 * columns, constraints, indexes, functions (body, result, language, security, volatility,
 * settings), triggers, policies, views, and the privileges of the API roles. One row per item,
 * ordered byte-wise. The same query runs on Supabase (Postgres 17) and PGlite (Postgres 18), so
 * it avoids text whose formatting differs between versions: NOT NULL constraints (stored as
 * constraints only from 18) are left to the column's notnull flag, and functions are compared by
 * their body (and arguments with defaults) instead of `pg_get_functiondef`. The live databases were
 * checked against their rebuilt starting points with an earlier form of this query on 7 Nov 2026.
 */
export const CATALOG_SQL = `
with
api_roles(rolname) as (values ('anon'), ('authenticated'), ('service_role'), ('PUBLIC')),
ns as (select oid, nspname from pg_namespace where nspname in ('public', 'private')),
rels as (
  select c.oid, n.nspname, c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity, c.relacl,
         c.relowner, c.reloptions
  from pg_class c join ns n on n.oid = c.relnamespace
  where c.relkind in ('r', 'v', 'm', 'S', 'p')
),
acl_rows as (
  select 'relacl' as kind, r.nspname || '.' || r.relname as key, a.grantee, a.privilege_type
  from rels r, aclexplode(coalesce(r.relacl,
    acldefault((case when r.relkind = 'S' then 's' else 'r' end)::"char", r.relowner))) a
  union all
  select 'colacl', r.nspname || '.' || r.relname || '.' || att.attname, a.grantee, a.privilege_type
  from rels r join pg_attribute att on att.attrelid = r.oid and att.attnum > 0 and not att.attisdropped,
       aclexplode(att.attacl) a
  where att.attacl is not null
  union all
  select 'fnacl', n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         a.grantee, a.privilege_type
  from pg_proc p join ns n on n.oid = p.pronamespace,
       aclexplode(coalesce(p.proacl, acldefault('f'::"char", p.proowner))) a
  union all
  select 'nspacl', n.nspname, a.grantee, a.privilege_type
  from pg_namespace n0 join ns n on n.oid = n0.oid,
       aclexplode(coalesce(n0.nspacl, acldefault('n'::"char", n0.nspowner))) a
),
acl_named as (
  select kind, key,
         case when grantee = 0 then 'PUBLIC' else (select rolname from pg_roles where oid = grantee) end as role,
         privilege_type
  from acl_rows
),
out(kind, key, detail) as (
  select 'rel', nspname || '.' || relname,
         relkind::text || ' rls=' || relrowsecurity || ' force=' || relforcerowsecurity || ' opts=' ||
         coalesce(array_to_string(reloptions, ','), '')
  from rels
  union all
  select 'col', n.nspname || '.' || c.relname || '.' || a.attname,
         format_type(a.atttypid, a.atttypmod) || ' notnull=' || a.attnotnull || ' def=' ||
         coalesce(pg_get_expr(d.adbin, d.adrelid), '') || ' gen=' || a.attgenerated::text ||
         ' id=' || a.attidentity::text
  from pg_attribute a join pg_class c on c.oid = a.attrelid join ns n on n.oid = c.relnamespace
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where c.relkind in ('r', 'v', 'p') and a.attnum > 0 and not a.attisdropped
  union all
  select 'con', n.nspname || '.' || c.relname || '.' || co.conname, pg_get_constraintdef(co.oid)
  from pg_constraint co join pg_class c on c.oid = co.conrelid join ns n on n.oid = c.relnamespace
  where co.contype <> 'n'
  union all
  select 'idx', n.nspname || '.' || i.relname, pg_get_indexdef(i.oid)
  from pg_index x join pg_class i on i.oid = x.indexrelid join ns n on n.oid = i.relnamespace
  union all
  select 'fn', n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         md5(p.prosrc) || ' args=' || pg_get_function_arguments(p.oid) || ' ret=' || pg_get_function_result(p.oid) ||
         ' lang=' || (select lanname from pg_language l where l.oid = p.prolang) ||
         ' secdef=' || p.prosecdef || ' vol=' || p.provolatile::text || ' strict=' || p.proisstrict ||
         ' par=' || p.proparallel::text || ' cfg=' || coalesce(array_to_string(p.proconfig, ';'), '') ||
         ' kind=' || p.prokind::text
  from pg_proc p join ns n on n.oid = p.pronamespace
  union all
  select 'trg', tn.nspname || '.' || tc.relname || '.' || t.tgname, pg_get_triggerdef(t.oid)
  from pg_trigger t join pg_class tc on tc.oid = t.tgrelid join pg_namespace tn on tn.oid = tc.relnamespace
  join pg_proc p on p.oid = t.tgfoid join ns pn on pn.oid = p.pronamespace
  where not t.tgisinternal
  union all
  select 'pol', schemaname || '.' || tablename || '.' || policyname,
         permissive || ' ' || array_to_string(roles, ',') || ' ' || cmd || ' using=' || coalesce(qual, '') ||
         ' check=' || coalesce(with_check, '')
  from pg_policies where schemaname in ('public', 'private')
  union all
  select 'view', schemaname || '.' || viewname, md5(definition)
  from pg_views where schemaname in ('public', 'private')
  union all
  select kind, key || ' ' || role, string_agg(privilege_type, ',' order by privilege_type)
  from acl_named where role in (select rolname from api_roles)
  group by kind, key, role
  union all
  select 'type', n.nspname || '.' || t.typname, t.typtype::text
  from pg_type t join ns n on n.oid = t.typnamespace
  where t.typtype in ('e', 'd')
     or (t.typtype = 'c' and not exists (select 1 from pg_class c where c.oid = t.typrelid and c.relkind <> 'c'))
  union all
  select 'comment', d.objoid::regclass::text || ':' || d.objsubid, md5(d.description)
  from pg_description d join pg_class c on c.oid = d.objoid and d.classoid = 'pg_class'::regclass
  join ns n on n.oid = c.relnamespace
  union all
  select 'comment', n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         md5(d.description)
  from pg_description d join pg_proc p on p.oid = d.objoid and d.classoid = 'pg_proc'::regclass
  join ns n on n.oid = p.pronamespace
)
select kind, key, detail from out order by kind collate "C", key collate "C", detail collate "C"
`;

export async function readCatalog(db: PGlite): Promise<string[]> {
  const { rows } = await db.query<{ kind: string; key: string; detail: string }>(CATALOG_SQL);
  return rows.map((r) => `${r.kind}\t${r.key}\t${r.detail}`);
}
