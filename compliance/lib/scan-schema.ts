import type { Denylist } from "./denylist.mjs";
import type { Finding } from "./finding";

/**
 * `compliance:schema`: static checks over supabase/migrations/*.sql.
 *   1. Post tables get no avatar, bio, follower or email style columns.
 *   2. Every table created in the public schema has row-level security enabled.
 *   3. The anon role is never granted anything.
 * The behaviour of the migrations is tested separately against real Postgres (tests/db).
 */

export function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, "");
}

const unquote = (s: string): string => s.replace(/^"|"$/g, "").toLowerCase();

/** Split on commas that are not inside parentheses. */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of body) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

const CONSTRAINT_START = /^(constraint|primary|unique|check|foreign|like|exclude)\b/i;

export interface ParsedTable {
  name: string;
  columns: string[];
}

export function parseCreateTables(sql: string): ParsedTable[] {
  const clean = stripSqlComments(sql);
  const tables: ParsedTable[] = [];
  const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?("?[a-z_][a-z0-9_]*"?)\s*\(/gi;
  for (const m of clean.matchAll(re)) {
    const start = (m.index ?? 0) + m[0].length;
    let depth = 1;
    let i = start;
    while (i < clean.length && depth > 0) {
      if (clean[i] === "(") depth++;
      if (clean[i] === ")") depth--;
      i++;
    }
    const body = clean.slice(start, i - 1);
    const columns = splitTopLevel(body)
      .map((part) => part.trim())
      .filter((part) => part && !CONSTRAINT_START.test(part))
      .map((part) => unquote(part.split(/\s+/)[0] ?? ""));
    tables.push({ name: unquote(m[1] ?? ""), columns });
  }
  return tables;
}

export function parseAddedColumns(sql: string): ParsedTable[] {
  const clean = stripSqlComments(sql);
  const added: ParsedTable[] = [];
  const re =
    /alter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?(?:public\.)?("?[a-z_][a-z0-9_]*"?)\s+([^;]*);/gi;
  for (const m of clean.matchAll(re)) {
    const columns = [
      ...(m[2] ?? "").matchAll(
        /(?:add\s+column|rename\s+(?:column\s+\S+\s+)?to)\s+(?:if\s+not\s+exists\s+)?("?[a-z_][a-z0-9_]*"?)/gi,
      ),
    ].map((c) => unquote(c[1] ?? ""));
    if (columns.length) added.push({ name: unquote(m[1] ?? ""), columns });
  }
  return added;
}

export function findSchemaViolations(files: Record<string, string>, deny: Denylist): Finding[] {
  const findings: Finding[] = [];
  const banned = new RegExp(deny.schema.bannedColumnPattern, "i");
  const postTables = new Set(deny.schema.postTables);
  const created = new Set<string>();
  const withRls = new Set<string>();

  const checkColumns = (file: string, table: ParsedTable) => {
    if (!postTables.has(table.name)) return;
    for (const column of table.columns) {
      if (banned.test(column)) {
        findings.push({
          file,
          line: 1,
          rule: "post-table-pii-column",
          detail: `${table.name}.${column} looks like an avatar, bio, follower or email field. Posts store the minimum.`,
        });
      }
    }
  };

  for (const [file, sql] of Object.entries(files)) {
    const clean = stripSqlComments(sql);

    for (const table of parseCreateTables(sql)) {
      created.add(table.name);
      checkColumns(file, table);
    }
    for (const table of parseAddedColumns(sql)) checkColumns(file, table);

    for (const m of clean.matchAll(
      /alter\s+table\s+(?:only\s+)?(?:public\.)?("?[a-z_][a-z0-9_]*"?)\s+enable\s+row\s+level\s+security/gi,
    )) {
      withRls.add(unquote(m[1] ?? ""));
    }

    if (deny.schema.anonGrantsForbidden) {
      for (const m of clean.matchAll(/\bgrant\s+[^;]*?\bto\b([^;]*);/gi)) {
        if (/\banon\b/i.test(m[1] ?? "")) {
          findings.push({
            file,
            line: 1,
            rule: "grant-to-anon",
            detail: `grants to anon: "${m[0].trim().slice(0, 80)}"`,
          });
        }
      }
    }
  }

  for (const table of created) {
    if (!withRls.has(table)) {
      findings.push({
        file: "supabase/migrations",
        line: 1,
        rule: "rls-missing",
        detail: `table public.${table} is created but never has row level security enabled`,
      });
    }
  }
  return findings;
}
