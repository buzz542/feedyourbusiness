import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadDenylist } from "../../compliance/lib/denylist.mjs";
import { formatFindings } from "../../compliance/lib/finding";
import { findSchemaViolations, parseCreateTables } from "../../compliance/lib/scan-schema";

/**
 * CI gate `compliance:schema`: post tables stay minimal, every table has RLS, anon gets nothing.
 * Runtime behaviour of the same rules is tested against real Postgres in tests/db.
 */
const DIR = "supabase/migrations";
const migrations = Object.fromEntries(
  readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => [path.posix.join(DIR, f), readFileSync(path.join(DIR, f), "utf8")]),
);

/** 1-based line numbers holding anything but tab, CR and printable ASCII. */
function nonPrintableAsciiLines(sql: string): number[] {
  return sql.split("\n").flatMap((line, i) => (/[^\t\r\x20-\x7E]/.test(line) ? [i + 1] : []));
}

describe("compliance:schema", () => {
  it("has migrations, named with a 14 digit version", () => {
    const names = Object.keys(migrations).map((f) => path.basename(f));
    expect(names.length).toBeGreaterThanOrEqual(3);
    for (const name of names) expect(name).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
  });

  it("are printable ASCII, so pasting one into the SQL Editor cannot change it", () => {
    // A paste once turned U+2000 into U+2002 and dropped U+2028, which broke a regex in
    // production-bound SQL. Write any other character as a \uXXXX escape.
    const found = Object.entries(migrations).flatMap(([file, sql]) =>
      nonPrintableAsciiLines(sql).map((line) => `${file}:${line}`),
    );
    expect(found).toEqual([]);
  });

  it("catches a planted non-ASCII or control character", () => {
    expect(nonPrintableAsciiLines("select 1;\nselect '\u2028';\nselect 2;")).toEqual([2]);
    expect(nonPrintableAsciiLines("select '\u00a0';")).toEqual([1]);
    expect(nonPrintableAsciiLines("select '\x07';")).toEqual([1]);
    expect(nonPrintableAsciiLines("select '\\u2028';\r\n\tselect 1;")).toEqual([]);
  });

  it("covers every table in the brief's core list", () => {
    const tables = Object.values(migrations).flatMap((sql) =>
      parseCreateTables(sql).map((t) => t.name),
    );
    for (const expected of [
      "profiles",
      "products",
      "search_terms",
      "posts",
      "product_posts",
      "themes",
      "suppression",
      "removal_requests",
      "usage_ledger",
      "audit_log",
    ]) {
      expect(tables).toContain(expected);
    }
  });

  it("post tables hold no avatar, bio, follower or email columns; RLS is on everywhere; anon gets nothing", () => {
    expect(formatFindings(findSchemaViolations(migrations, loadDenylist()))).toBe("");
  });
});
