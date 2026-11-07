import { readFileSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { readCatalog } from "./catalog";
import { createBareDb, listMigrations } from "./harness";

/**
 * The two catch-up files the founder pastes into the SQL Editor (docs/TASKS.md, founder to-do).
 * Each live database is rebuilt here as it stood on 7 Nov 2026, checked then against the live
 * catalog with the same query (`tests/db/catalog.ts`): production ran the first four migrations
 * (profiles_app recorded as 20261102193628); development ran them under other versions, then an
 * early copy of onboarding by hand (`fixtures/dev-onboarding-2026-11-02.sql`, the file at commit
 * 9546ce4), plus a scrapped `access_requests` table (a stand-in here: the catch-up never touches
 * it, and the founder drops it). After its catch-up each must hold exactly the schema the repo's
 * migrations build, dev apart from that table, and the history must list the repo's files.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const PRODUCTION = read("supabase/catch-up/catch-up-production.sql");
const DEVELOPMENT = read("supabase/catch-up/catch-up-dev.sql");
const DEV_ONBOARDING = read("tests/db/fixtures/dev-onboarding-2026-11-02.sql");

/**
 * The files catch a database up to the ten migrations through `removal_form`. Migrations added
 * after them are applied the usual way once the catch-up is in, so the files never change under
 * the founder.
 */
const CAUGHT_UP = listMigrations().slice(0, 10);
const FIRST_FOUR = CAUGHT_UP.slice(0, 4);

const HISTORY_TABLE = `
  create schema supabase_migrations;
  create table supabase_migrations.schema_migrations (
    version text primary key, statements text[], name text, created_by text,
    idempotency_key text unique, rollback text[]
  );
`;

async function record(db: PGlite, rows: [string, string][]): Promise<void> {
  for (const [version, name] of rows) {
    await db.query(
      "insert into supabase_migrations.schema_migrations (version, name) values ($1, $2)",
      [version, name],
    );
  }
}

async function history(db: PGlite): Promise<string[]> {
  const { rows } = await db.query<{ version: string; name: string }>(
    "select version, name from supabase_migrations.schema_migrations order by version",
  );
  return rows.map((r) => `${r.version}_${r.name}`);
}

async function withFirstFour(): Promise<PGlite> {
  const db = await createBareDb();
  await db.exec(HISTORY_TABLE);
  for (const file of FIRST_FOUR) await db.exec(readFileSync(path.join(MIGRATIONS, file), "utf8"));
  return db;
}

/** Live production's apply_billing_patch: the earlier apply dropped the comment from its body. */
const BILLING_PATCH = (() => {
  const text = readFileSync(path.join(MIGRATIONS, CAUGHT_UP[2]!), "utf8");
  const start = text.indexOf("create function public.apply_billing_patch(");
  return text
    .slice(start, text.indexOf("\n$$;", start) + 4)
    .replace("create function", "create or replace function");
})();
const COMMENT = "    -- A changed trial end means a new reminder is due.\n";

async function production(): Promise<PGlite> {
  const db = await withFirstFour();
  expect(BILLING_PATCH).toContain(COMMENT);
  await db.exec(BILLING_PATCH.replace(COMMENT, ""));
  await record(db, [
    ["20261013183103", "core_schema"],
    ["20261013183117", "rls_and_grants"],
    ["20261013183356", "billing_functions"],
    ["20261102193628", "profiles_app"],
  ]);
  return db;
}

/** Shaped like the live leftover: a key, a checked unique email, three defaults, deny-all RLS. */
const ACCESS_REQUESTS = `
  create table public.access_requests (
    id uuid primary key default gen_random_uuid(),
    email text not null unique check (char_length(email) <= 254),
    status text not null default 'new',
    created_at timestamptz not null default now()
  );
  alter table public.access_requests enable row level security;
  create policy access_requests_deny_all on public.access_requests
    for all to anon, authenticated using (false) with check (false);
`;

async function development(): Promise<PGlite> {
  const db = await withFirstFour();
  await db.exec(DEV_ONBOARDING);
  await db.exec(ACCESS_REQUESTS);
  await record(db, [
    ["20261102191059", "core_schema"],
    ["20261102191118", "rls_and_grants"],
    ["20261102191127", "billing_functions"],
    ["20261102191139", "profiles_app"],
    ["20261105211246", "access_requests"],
  ]);
  return db;
}

/** The SQL Editor stops at the first error; the open transaction is then rolled back. */
async function paste(db: PGlite, sql: string): Promise<string | null> {
  try {
    await db.exec(sql);
    return null;
  } catch (error) {
    await db.exec("rollback");
    return (error as Error).message;
  }
}

const REPO_HISTORY = CAUGHT_UP.map((f) => f.replace(/\.sql$/, ""));

/** A fresh database with exactly the ten migrations the catch-up files reach. */
async function caughtUp(): Promise<PGlite> {
  const db = await createBareDb();
  for (const file of CAUGHT_UP) await db.exec(readFileSync(path.join(MIGRATIONS, file), "utf8"));
  return db;
}

describe("catch-up files", () => {
  it("reach the ten migrations through removal_form", () => {
    expect(CAUGHT_UP).toHaveLength(10);
    expect(CAUGHT_UP.at(-1)).toBe("20261105213000_removal_form.sql");
  });

  it("are ASCII, one transaction each, with no statement after commit but the history check", () => {
    for (const sql of [PRODUCTION, DEVELOPMENT]) {
      expect(/^[\x09\x0a\x20-\x7e]*$/.test(sql)).toBe(true);
      expect(sql.match(/^begin;$/gm)).toHaveLength(1);
      expect(sql.match(/^commit;$/gm)).toHaveLength(1);
      const after = sql.slice(sql.indexOf("\ncommit;\n") + "\ncommit;\n".length);
      expect(after.replace(/^--.*$/gm, "").trim()).toBe(
        "select version, name from supabase_migrations.schema_migrations order by version;",
      );
    }
  });

  it("production lands exactly on the repo's schema and history", { timeout: 60_000 }, async () => {
    const [expected, db] = await Promise.all([caughtUp(), production()]);
    expect(await paste(db, PRODUCTION)).toBeNull();
    expect(await readCatalog(db)).toEqual(await readCatalog(expected));
    expect(await history(db)).toEqual(REPO_HISTORY);
  });

  it(
    "development lands exactly on the repo's schema and history",
    { timeout: 60_000 },
    async () => {
      const [expected, db] = await Promise.all([caughtUp(), development()]);
      expect(await paste(db, DEVELOPMENT)).toBeNull();
      const want = await readCatalog(expected);
      const after = await readCatalog(db);
      expect(after.filter((row) => !row.includes("access_requests"))).toEqual(want);
      expect(after).toContain("rel\tpublic.access_requests\tr rls=true force=false opts=");
      expect(await history(db)).toEqual(REPO_HISTORY);
      // The founder's optional one-liner then leaves exactly the repo's schema.
      await db.exec("drop table public.access_requests");
      expect(await readCatalog(db)).toEqual(want);
    },
  );

  it(
    "the starting points differ from the repo, so the checks above are not vacuous",
    { timeout: 60_000 },
    async () => {
      const [expected, prod, dev] = await Promise.all([caughtUp(), production(), development()]);
      const want = await readCatalog(expected);
      expect(await readCatalog(prod)).not.toEqual(want);
      expect(await readCatalog(dev)).not.toEqual(want);
    },
  );

  it(
    "refuses a history that is not as recorded on 7 Nov, changing nothing",
    { timeout: 60_000 },
    async () => {
      // As the dev project did, production with an earlier migration under another version.
      const db = await production();
      await db.exec(
        "update supabase_migrations.schema_migrations set version = '20261102191059' where name = 'core_schema'",
      );
      const before = [await readCatalog(db), await history(db)];
      expect(await paste(db, PRODUCTION)).toContain(
        "did not come out as the repo's ten migrations",
      );
      expect([await readCatalog(db), await history(db)]).toEqual(before);

      // And dev with a history row nobody expected.
      const dev = await development();
      await record(dev, [["20261106000000", "something_else"]]);
      const devBefore = [await readCatalog(dev), await history(dev)];
      expect(await paste(dev, DEVELOPMENT)).toContain(
        "did not come out as the repo's ten migrations",
      );
      expect([await readCatalog(dev), await history(dev)]).toEqual(devBefore);
    },
  );

  it(
    "each refuses the other database and a second run, changing nothing",
    { timeout: 60_000 },
    async () => {
      const cases: [() => Promise<PGlite>, string, string][] = [
        [development, PRODUCTION, "not the production database"],
        [production, DEVELOPMENT, "not the development database"],
      ];
      for (const [build, sql, message] of cases) {
        const db = await build();
        const before = [await readCatalog(db), await history(db)];
        expect(await paste(db, sql)).toContain(message);
        expect([await readCatalog(db), await history(db)]).toEqual(before);
      }
      for (const [build, sql] of [
        [production, PRODUCTION],
        [development, DEVELOPMENT],
      ] as const) {
        const db = await build();
        expect(await paste(db, sql)).toBeNull();
        const done = [await readCatalog(db), await history(db)];
        expect(await paste(db, sql)).toContain("Nothing was changed");
        expect([await readCatalog(db), await history(db)]).toEqual(done);
      }
    },
  );
});

/**
 * Every statement in a catch-up file is a migration's text verbatim (or, for dev, a piece of the
 * repo's onboarding file), or one of a few allowed shapes: begin and commit, a guard `do` block
 * that only reads and raises, and statements on the migration history. The catalog compare above
 * covers `public` and `private`; this covers everything else a file could slip in (a grant on
 * `auth.users`, a default privilege, a role change).
 */
function unexpectedStatements(sql: string, verbatim: string[]): string[] {
  let rest = sql;
  const problems: string[] = [];
  for (const block of verbatim) {
    const at = rest.indexOf(block);
    if (at < 0 || rest.indexOf(block, at + 1) >= 0) {
      problems.push(`not exactly once: ${block.slice(0, 60)}`);
      continue;
    }
    rest = rest.slice(0, at) + rest.slice(at + block.length);
  }
  rest = rest.replace(/^\s*--.*$/gm, "");
  const statements: string[] = [];
  while (rest.trim()) {
    rest = rest.trimStart();
    const end = rest.startsWith("do $$") ? rest.indexOf("\n$$;") + 4 : rest.indexOf(";") + 1;
    if (end <= 0) {
      statements.push(rest);
      break;
    }
    statements.push(rest.slice(0, end).replace(/\s+/g, " "));
    rest = rest.slice(end);
  }
  const version = String.raw`'\d{14}'`;
  const pair = String.raw`\(${version}, '[a-z_]+'\)`;
  const allowed = [
    /^begin;$/,
    /^commit;$/,
    new RegExp(
      String.raw`^update supabase_migrations\.schema_migrations set version = ${version} where version = ${version} and name = '[a-z_]+';$`,
    ),
    new RegExp(
      String.raw`^insert into supabase_migrations\.schema_migrations \(version, name\) values ${pair}(, ${pair})*;$`,
    ),
    /^delete from supabase_migrations\.schema_migrations where version = '20261105211246' and name = 'access_requests';$/,
    /^select version, name from supabase_migrations\.schema_migrations order by version;$/,
  ];
  const guardWords =
    /\b(grant|revoke|alter|create|drop|insert|update|delete|truncate|execute|perform|copy|set|call|notify|lock)\b/i;
  // A guard only reads: these are the only calls it may make.
  const guardCalls = new Set([
    "exists",
    "to_regclass",
    "count",
    "array_agg",
    "private.are_product_labels",
  ]);
  // SQL keywords before a parenthesis are not calls.
  const keywords = new Set(["if", "and", "or", "not", "in", "is", "from", "where", "select"]);
  const callsOk = (condition: string) =>
    [...condition.matchAll(/([a-z_][a-z0-9_.]*)\s*\(/gi)].every(
      (m) => keywords.has(m[1]!.toLowerCase()) || guardCalls.has(m[1]!.toLowerCase()),
    );
  for (const statement of statements) {
    if (allowed.some((re) => re.test(statement))) continue;
    const guard =
      /^do \$\$ begin if (.*) then raise exception '[^']*(''[^']*)*'; end if; end; \$\$;$/.exec(
        statement,
      );
    if (guard && !guardWords.test(guard[1]!) && callsOk(guard[1]!)) continue;
    problems.push(statement.slice(0, 120));
  }
  return problems;
}

const migrationText = (file: string) => readFileSync(path.join(MIGRATIONS, file), "utf8").trim();
const LATER = CAUGHT_UP.slice(4);
const HEAD_ONBOARDING = migrationText(LATER[0]!);

/** The three functions dev replaces, and the end of onboarding that dev never ran. */
function devOnboardingPieces(): string[] {
  const fn = (name: string) => {
    const start = HEAD_ONBOARDING.indexOf(`create function ${name}(`);
    const end = HEAD_ONBOARDING.indexOf("\n$$;", start) + 4;
    return HEAD_ONBOARDING.slice(start, end).replace(
      "create function",
      "create or replace function",
    );
  };
  return [
    fn("private.are_product_labels"),
    fn("public.start_product_draft"),
    fn("public.save_product_draft"),
    HEAD_ONBOARDING.slice(HEAD_ONBOARDING.indexOf("-- Model call reservations")),
  ];
}

const PROD_PIECES = [BILLING_PATCH, ...LATER.map(migrationText)];
const DEV_PIECES = [...devOnboardingPieces(), ...LATER.slice(1).map(migrationText)];

describe("catch-up files hold nothing but the migrations", () => {
  it("production is the six migrations verbatim, plus guards and history", () => {
    expect(unexpectedStatements(PRODUCTION, PROD_PIECES)).toEqual([]);
  });

  it("development is the onboarding delta and five migrations verbatim, plus guards and history", () => {
    expect(unexpectedStatements(DEVELOPMENT, DEV_PIECES)).toEqual([]);
  });

  it("catches a planted statement, a planted guard and a changed migration line", () => {
    const beforeCommit = (sql: string, extra: string) =>
      sql.replace("\ncommit;\n", `\n${extra}\ncommit;\n`);
    for (const planted of [
      "grant select on auth.users to authenticated;",
      "alter default privileges in schema public grant all on tables to anon;",
      "do $$\nbegin\n  if true then execute 'grant all on public.posts to anon'; end if;\nend;\n$$;",
      "do $$\nbegin\n  if set_config('role', 'anon', false) is null then\n    raise exception 'x';\n  end if;\nend;\n$$;",
      "do $$\nbegin\n  if exists (select 1 from public.posts) then\n    raise exception 'x';\n  end if;\n  grant all on public.posts to anon;\nend;\n$$;",
    ]) {
      expect(unexpectedStatements(beforeCommit(PRODUCTION, planted), PROD_PIECES)).not.toEqual([]);
      expect(unexpectedStatements(beforeCommit(DEVELOPMENT, planted), DEV_PIECES)).not.toEqual([]);
    }
    const changed = PRODUCTION.replace(
      "add constraint posts_no_author_handle check (author_handle is null)",
      "add constraint posts_no_author_handle check (true)",
    );
    expect(changed).not.toBe(PRODUCTION);
    expect(unexpectedStatements(changed, PROD_PIECES)).not.toEqual([]);
  });

  it(
    "dev refuses when a stored competitor fails the replaced label check",
    { timeout: 60_000 },
    async () => {
      const db = await development();
      // A row the old check let through: planted by lifting the constraint for one insert.
      await db.exec(`
      insert into auth.users (id, email) values ('00000000-0000-4000-8000-000000000001', 'a@example.com');
      insert into public.products (id, owner_id, url, name)
        values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000001',
                'https://acme.example', 'Acme');
      alter table public.competitors drop constraint competitors_name_check;
      insert into public.competitors (product_id, name)
        values ('00000000-0000-4000-8000-0000000000a1', '@someone');
    `);
      const before = await history(db);
      expect(await paste(db, DEVELOPMENT)).toContain("fails the updated label check");
      expect(await history(db)).toEqual(before);
    },
  );
});
