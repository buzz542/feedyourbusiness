import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

/**
 * Local Postgres (PGlite, real Postgres compiled to WASM) with the parts of Supabase that our
 * migrations depend on: the auth schema, auth.uid(), and the anon / authenticated / service_role
 * roles with Supabase's default privileges. Migrations run exactly as they do in production, so
 * row-level security and grants are tested before they reach the live project.
 */

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../../supabase/migrations");

const SUPABASE_BOOTSTRAP = `
  create schema auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text unique
  );
  create function auth.uid() returns uuid
    language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  grant usage on schema public to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;

  -- Supabase grants API roles everything on new public objects by default. Our migrations
  -- must narrow that down.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

export type DbRole = "anon" | "authenticated" | "service_role";

/**
 * A database with every migration applied, or, with `before`, only the migrations that sort
 * before the first file whose name contains it. Data migrations seed the old shape there, then
 * call applyMigrationsFrom with the same name.
 */
export async function createDb(options: { before?: string } = {}): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_BOOTSTRAP);
  const files = listMigrations();
  const stop = options.before ? indexOfMigration(files, options.before) : files.length;
  for (const file of files.slice(0, stop)) {
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
  return db;
}

/** Apply the migrations from the first file whose name contains `name` to the end. */
export async function applyMigrationsFrom(db: PGlite, name: string): Promise<void> {
  const files = listMigrations();
  for (const file of files.slice(indexOfMigration(files, name))) {
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
}

function indexOfMigration(files: string[], name: string): number {
  const i = files.findIndex((f) => f.includes(name));
  if (i < 0) throw new Error(`no migration named like ${name}`);
  return i;
}

export function listMigrations(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/** Run `fn` as an API role, the way PostgREST does: SET ROLE plus the JWT subject claim. */
export async function withRole<T>(
  db: PGlite,
  role: DbRole,
  userId: string | null,
  fn: () => Promise<T>,
): Promise<T> {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
  await db.exec(`set role ${role}`);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }
}
