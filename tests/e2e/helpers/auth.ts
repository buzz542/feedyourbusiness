import type { Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../src/types/database";
import { E2E_EMAIL } from "./constants";
import { assertSafeE2ETarget } from "./safety";

/**
 * Sign-in for E2E without an inbox: create a confirmed user with the admin API, then follow a
 * generated magic link through our own /auth/callback (token hash flow). Needs the development
 * project's keys (F12); never the production secret key.
 */

export const hasSupabaseAdmin = (): boolean =>
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);

export const SKIP_REASON =
  "E2E sign-in needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY for the development project (docs/PLAN.md F12).";

function admin(): SupabaseClient<Database> {
  assertSafeE2ETarget(process.env.NEXT_PUBLIC_SUPABASE_URL, E2E_EMAIL);
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

export async function deleteE2EUser(email = E2E_EMAIL): Promise<void> {
  const client = admin();
  for (let page = 1; page < 50; page++) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error("Supabase: could not list users");
    const match = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (match) {
      const del = await client.auth.admin.deleteUser(match.id);
      if (del.error) throw new Error("Supabase: could not delete the E2E user");
      return;
    }
    if (data.users.length < 200) return;
  }
}

/** Creates a fresh confirmed user (deleting any leftover), optionally with the terms accepted. */
export async function createE2EUser(opts: { termsAccepted?: boolean } = {}): Promise<string> {
  await deleteE2EUser();
  const client = admin();
  const { data, error } = await client.auth.admin.createUser({
    email: E2E_EMAIL,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error("Supabase: could not create the E2E user");
  if (opts.termsAccepted) {
    const upd = await client
      .from("profiles")
      .update({ terms_accepted_at: new Date().toISOString() })
      .eq("id", data.user.id);
    if (upd.error) throw new Error("Supabase: could not accept terms for the E2E user");
  }
  return data.user.id;
}

/** Signs the browser in as the E2E user by following a generated magic link. */
export async function signIn(page: Page, next = "/app"): Promise<void> {
  const { data, error } = await admin().auth.admin.generateLink({
    type: "magiclink",
    email: E2E_EMAIL,
  });
  const tokenHash = data.properties?.hashed_token;
  if (error || !tokenHash) throw new Error("Supabase: could not generate a sign-in link");
  const params = new URLSearchParams({ token_hash: tokenHash, type: "magiclink", next });
  await page.goto(`/auth/callback?${params.toString()}`);
}
