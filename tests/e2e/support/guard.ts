/**
 * Guards for the Playwright suite. E2E drives our own app on localhost only, never a deployment
 * and never a third-party site, and it creates users only in the development Supabase project.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const PRODUCTION_PROJECT_REF = "hoqbflkszzoojdswbrgy";

export function assertLocalBaseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`E2E base URL must be http://localhost, got an invalid URL`);
  }
  const ok =
    (url.protocol === "http:" || url.protocol === "https:") &&
    LOCAL_HOSTS.has(url.hostname) &&
    url.username === "" &&
    url.password === "";
  if (!ok) throw new Error(`E2E base URL must be http://localhost, got ${url.origin}`);
  return url;
}

export function assertDevSupabase(supabaseUrl: string): void {
  let host: string;
  try {
    host = new URL(supabaseUrl).hostname;
  } catch {
    throw new Error("E2E needs a valid development Supabase URL");
  }
  if (host.includes(PRODUCTION_PROJECT_REF))
    throw new Error("E2E refuses to run against the production Supabase project");
}

/** A browser request E2E may make: our own localhost server only. */
export function isLocalRequestUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol === "data:" || url.protocol === "blob:") return true;
    return LOCAL_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

type Env = Readonly<Record<string, string | undefined>>;

const usable = (value: string | undefined) => Boolean(value) && !value!.includes("replace_me");

/** Null when E2E can run; otherwise the reason, printed when the sign-in test is skipped. */
export function e2eSkipReason(env: Env): string | null {
  if (!usable(env.SUPABASE_SECRET_KEY))
    return "SUPABASE_SECRET_KEY for the development project is not set (docs/PLAN.md F12)";
  if (!usable(env.NEXT_PUBLIC_SUPABASE_URL) || !usable(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY))
    return "the development project's URL and publishable key are not set (docs/PLAN.md F12)";
  return null;
}
