/**
 * Generate src/types/database.ts from the migrations, in the shape `supabase gen types` writes.
 *
 * The build session has no linked Supabase project, so it cannot run `npm run db:types`. This boots
 * the same PGlite database the tests use (every migration, exactly as in production), reads the
 * catalog and writes the public schema's tables and API functions. After a migration reaches
 * production, `npm run db:types` against the real project replaces this file; the two agree on
 * tables, columns, nullability and function signatures.
 *
 * Usage: node scripts/db-types.ts            writes src/types/database.ts
 *        node scripts/db-types.ts --check    exits 1 if the file is out of date
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createDb } from "../tests/db/harness.ts";

const OUT = path.resolve(import.meta.dirname, "../src/types/database.ts");

const TS_TYPES: Record<string, string> = {
  uuid: "string",
  text: "string",
  timestamptz: "string",
  "timestamp with time zone": "string",
  date: "string",
  bool: "boolean",
  boolean: "boolean",
  int2: "number",
  int4: "number",
  int8: "number",
  smallint: "number",
  integer: "number",
  bigint: "number",
  numeric: "number",
  float8: "number",
  jsonb: "Json",
  json: "Json",
  void: "undefined",
};

function tsType(udt: string): string {
  if (udt.startsWith("_")) return `${tsType(udt.slice(1))}[]`;
  if (udt.endsWith("[]")) return `${tsType(udt.slice(0, -2))}[]`;
  const t = TS_TYPES[udt];
  if (!t) throw new Error(`No TypeScript mapping for Postgres type ${udt}`);
  return t;
}

interface Column {
  table: string;
  name: string;
  udt: string;
  nullable: boolean;
  hasDefault: boolean;
  identityAlways: boolean;
}

interface ForeignKey {
  table: string;
  name: string;
  columns: string[];
  refTable: string;
  refColumns: string[];
  oneToOne: boolean;
}

interface Fn {
  name: string;
  args: { name: string; udt: string; hasDefault: boolean }[];
  returns: string;
  setofTable: string | null;
}

async function main() {
  const db = await createDb();

  const columns = (
    await db.query<{
      table_name: string;
      column_name: string;
      udt_name: string;
      is_nullable: string;
      column_default: string | null;
      identity_generation: string | null;
      is_generated: string;
    }>(
      `select c.table_name, c.column_name, c.udt_name, c.is_nullable, c.column_default, c.identity_generation,
              c.is_generated
       from information_schema.columns c
       join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
       where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
       order by c.table_name, c.column_name`,
    )
  ).rows.map((r): Column => ({
    table: r.table_name,
    name: r.column_name,
    udt: r.udt_name,
    nullable: r.is_nullable === "YES",
    hasDefault: r.column_default !== null || r.identity_generation !== null,
    identityAlways: r.identity_generation === "ALWAYS",
  }));

  const fks = (
    await db.query<{
      table_name: string;
      conname: string;
      cols: string[];
      ref_table: string;
      ref_cols: string[];
      one_to_one: boolean;
    }>(
      `select cl.relname as table_name, con.conname,
              array(select a.attname from unnest(con.conkey) with ordinality k(n, i)
                    join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.n order by k.i) as cols,
              rcl.relname as ref_table,
              array(select a.attname from unnest(con.confkey) with ordinality k(n, i)
                    join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.n order by k.i) as ref_cols,
              exists (
                select 1 from pg_index ix
                where ix.indrelid = con.conrelid and ix.indisunique
                  and (select array_agg(x order by x) from unnest(ix.indkey::int2[]) x)
                    = (select array_agg(y order by y) from unnest(con.conkey) y)
              ) as one_to_one
       from pg_constraint con
       join pg_class cl on cl.oid = con.conrelid
       join pg_namespace n on n.oid = cl.relnamespace
       join pg_class rcl on rcl.oid = con.confrelid
       join pg_namespace rn on rn.oid = rcl.relnamespace
       where con.contype = 'f' and n.nspname = 'public' and rn.nspname = 'public'
       order by cl.relname, con.conname`,
    )
  ).rows.map((r): ForeignKey => ({
    table: r.table_name,
    name: r.conname,
    columns: r.cols,
    refTable: r.ref_table,
    refColumns: r.ref_cols,
    oneToOne: r.one_to_one,
  }));

  const fns = (
    await db.query<{
      proname: string;
      arg_names: string[] | null;
      arg_types: string[];
      arg_modes: string[] | null;
      n_defaults: number;
      ret: string;
      retset: boolean;
      ret_table: string | null;
    }>(
      `select p.proname,
              p.proargnames as arg_names,
              array(select format_type(t, null) from unnest(p.proargtypes) t) as arg_types,
              p.proargmodes::text[] as arg_modes,
              p.pronargdefaults as n_defaults,
              format_type(p.prorettype, null) as ret,
              p.proretset as retset,
              (select c.relname from pg_class c where c.reltype = p.prorettype) as ret_table
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prokind = 'f'
         and format_type(p.prorettype, null) <> 'trigger'
       order by p.proname`,
    )
  ).rows.map((r): Fn => {
    if (r.arg_modes?.some((m) => m !== "i"))
      throw new Error(`Function ${r.proname} has OUT, INOUT or VARIADIC arguments: not supported`);
    const names = r.arg_names ?? [];
    const inputNames = names.filter((_, i) => !r.arg_modes || r.arg_modes[i] === "i");
    const firstDefault = r.arg_types.length - r.n_defaults;
    return {
      name: r.proname,
      args: r.arg_types.map((t, i) => ({
        name: inputNames[i] ?? `arg${i}`,
        udt: t,
        hasDefault: i >= firstDefault,
      })),
      returns: r.ret,
      setofTable: r.retset && r.ret_table ? r.ret_table : null,
    };
  });

  await db.close();

  const tables = [...new Set(columns.map((c) => c.table))].sort();
  const pad = (n: number) => " ".repeat(n);
  const lines: string[] = [];
  const colType = (c: Column) => `${tsType(c.udt)}${c.nullable ? " | null" : ""}`;

  lines.push("    Tables: {");
  for (const table of tables) {
    const cols = columns.filter((c) => c.table === table);
    lines.push(`${pad(6)}${table}: {`);
    lines.push(`${pad(8)}Row: {`);
    for (const c of cols) lines.push(`${pad(10)}${c.name}: ${colType(c)}`);
    lines.push(`${pad(8)}}`);
    lines.push(`${pad(8)}Insert: {`);
    for (const c of cols) {
      if (c.identityAlways) lines.push(`${pad(10)}${c.name}?: never`);
      else lines.push(`${pad(10)}${c.name}${c.nullable || c.hasDefault ? "?" : ""}: ${colType(c)}`);
    }
    lines.push(`${pad(8)}}`);
    lines.push(`${pad(8)}Update: {`);
    for (const c of cols) {
      if (c.identityAlways) lines.push(`${pad(10)}${c.name}?: never`);
      else lines.push(`${pad(10)}${c.name}?: ${colType(c)}`);
    }
    lines.push(`${pad(8)}}`);
    const rels = fks.filter((f) => f.table === table);
    if (rels.length === 0) {
      lines.push(`${pad(8)}Relationships: []`);
    } else {
      lines.push(`${pad(8)}Relationships: [`);
      for (const f of rels) {
        lines.push(`${pad(10)}{`);
        lines.push(`${pad(12)}foreignKeyName: "${f.name}"`);
        lines.push(`${pad(12)}columns: [${f.columns.map((c) => `"${c}"`).join(", ")}]`);
        lines.push(`${pad(12)}isOneToOne: ${f.oneToOne}`);
        lines.push(`${pad(12)}referencedRelation: "${f.refTable}"`);
        lines.push(
          `${pad(12)}referencedColumns: [${f.refColumns.map((c) => `"${c}"`).join(", ")}]`,
        );
        lines.push(`${pad(10)}},`);
      }
      lines.push(`${pad(8)}]`);
    }
    lines.push(`${pad(6)}}`);
  }
  lines.push("    }");
  lines.push("    Views: {");
  lines.push("      [_ in never]: never");
  lines.push("    }");
  lines.push("    Functions: {");
  for (const fn of fns) {
    lines.push(`${pad(6)}${fn.name}: {`);
    const args = [...fn.args].sort((a, b) => a.name.localeCompare(b.name));
    lines.push(
      args.length === 0
        ? `${pad(8)}Args: never`
        : `${pad(8)}Args: { ${args.map((a) => `${a.name}${a.hasDefault ? "?" : ""}: ${tsType(a.udt)}`).join("; ")} }`,
    );
    if (fn.setofTable) {
      const cols = columns.filter((c) => c.table === fn.setofTable);
      lines.push(`${pad(8)}Returns: {`);
      for (const c of cols) lines.push(`${pad(10)}${c.name}: ${colType(c)}`);
      lines.push(`${pad(8)}}[]`);
      lines.push(`${pad(8)}SetofOptions: {`);
      lines.push(`${pad(10)}from: "*"`);
      lines.push(`${pad(10)}to: "${fn.setofTable}"`);
      lines.push(`${pad(10)}isOneToOne: false`);
      lines.push(`${pad(10)}isSetofReturn: true`);
      lines.push(`${pad(8)}}`);
    } else {
      lines.push(`${pad(8)}Returns: ${tsType(fn.returns)}`);
    }
    lines.push(`${pad(6)}}`);
  }
  lines.push("    }");

  const current = readFileSync(OUT, "utf8");
  const start = current.indexOf("    Tables: {");
  const end = current.indexOf("    Enums: {");
  if (start < 0 || end < 0) throw new Error("Unexpected layout in src/types/database.ts");
  const next = current.slice(0, start) + lines.join("\n") + "\n" + current.slice(end);

  if (process.argv.includes("--check")) {
    if (next !== current) {
      console.error("src/types/database.ts is out of date. Run: node scripts/db-types.ts");
      process.exit(1);
    }
    console.log("src/types/database.ts is up to date");
    return;
  }
  writeFileSync(OUT, next);
  console.log(
    `wrote ${path.relative(process.cwd(), OUT)}: ${tables.length} tables, ${fns.length} functions`,
  );
}

await main();
