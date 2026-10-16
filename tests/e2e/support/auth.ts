import type { BrowserContext } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Sign-in for E2E without email or a third-party page: create a confirmed user with the admin API,
 * generate a magic link for it, verify the link's token server-side with @supabase/ssr, and put the
 * session cookies it sets into the browser context. The browser stays on localhost throughout.
 * Needs the development project's keys (docs/PLAN.md F12); the production project is refused.
 */

export interface E2EConfig {
  url: string;
  publishableKey: string;
  secretKey: string;
}

/** The production project. E2E creates and deletes users, so it must never run against it. */
export const PRODUCTION_SUPABASE_HOST = "hoqbflkszzoojdswbrgy.supabase.co";

export function e2eConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): E2EConfig | null {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const secretKey = env.SUPABASE_SECRET_KEY;
  if (!url || !publishableKey || !secretKey) return null;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    throw new Error("E2E: NEXT_PUBLIC_SUPABASE_URL is not a URL");
  }
  if (host === PRODUCTION_SUPABASE_HOST)
    throw new Error(
      "E2E refuses the production Supabase project. Use the development project (F12).",
    );
  // Fail closed: only a hosted Supabase project (not production) or a local Supabase stack.
  if (!host.endsWith(".supabase.co") && host !== "localhost" && host !== "127.0.0.1")
    throw new Error("E2E only runs against the development Supabase project (F12).");
  return { url, publishableKey, secretKey };
}

export const SKIP_REASON =
  "Skipped: set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY " +
  "for the development Supabase project (in the shell or .env.local) to run sign-in E2E (docs/PLAN.md F12).";

const admin = (c: E2EConfig): SupabaseClient =>
  createClient(c.url, c.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });

/**
 * Sign a new user in for this browser context. `onCreated` gets the user id as soon as it exists,
 * so cleanup runs even if a later step fails. A leftover user is an error: delete it first.
 */
export async function signIn(
  context: BrowserContext,
  baseURL: string,
  email: string,
  config: E2EConfig,
  onCreated: (userId: string) => void,
): Promise<void> {
  const client = admin(config);
  const created = await client.auth.admin.createUser({ email, email_confirm: true });
  if (created.error || !created.data.user)
    throw new Error(
      `createUser failed: ${created.error?.code ?? "no user"} (delete leftover users first)`,
    );
  onCreated(created.data.user.id);

  const link = await client.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error || !link.data.user) throw new Error("generateLink failed");

  const cookies: { name: string; value: string }[] = [];
  const ssr = createServerClient(config.url, config.publishableKey, {
    cookies: { getAll: () => [], setAll: (toSet) => void cookies.push(...toSet) },
  });
  const verified = await ssr.auth.verifyOtp({
    token_hash: link.data.properties.hashed_token,
    type: "magiclink",
  });
  if (verified.error) throw new Error(`verifyOtp failed: ${verified.error.name}`);

  await context.addCookies(
    cookies.map(({ name, value }) => ({ name, value, url: baseURL, sameSite: "Lax" as const })),
  );
}

/** Delete test users (cascades to every row they own). Throws if any delete fails. */
export async function deleteUsers(config: E2EConfig, ids: readonly string[]): Promise<void> {
  const client = admin(config);
  for (const id of ids) {
    const { error } = await client.auth.admin.deleteUser(id);
    if (error) throw new Error(`deleteUser failed: ${error.code ?? error.name}`);
  }
}

/** Remove a leftover user from an earlier interrupted run, searching every page of users. */
export async function deleteUserByEmail(config: E2EConfig, email: string): Promise<void> {
  const client = admin(config);
  for (let page = 1; ; page++) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers failed: ${error.code ?? error.name}`);
    const user = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (user) return deleteUsers(config, [user.id]);
    if (data.users.length < 200) return;
  }
}
