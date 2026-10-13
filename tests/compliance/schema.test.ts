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

describe("compliance:schema", () => {
  it("has migrations, named with a 14 digit version", () => {
    const names = Object.keys(migrations).map((f) => path.basename(f));
    expect(names.length).toBeGreaterThanOrEqual(3);
    for (const name of names) expect(name).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
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
