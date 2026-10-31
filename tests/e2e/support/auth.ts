import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { assertDevSupabase } from "./guard";

/**
 * Sign-in for E2E without a mailbox: create a confirmed user with the admin API in the
 * development project, then follow a generated magic link through our own callback.
 */

/** The service-role client for the development project only (assertDevSupabase). */
export function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  assertDevSupabase(url);
  return createClient(url, process.env.SUPABASE_SECRET_KEY ?? "", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function findUserId(admin: SupabaseClient, email: string): Promise<string | null> {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers failed: ${error.code ?? "unknown"}`);
    const match = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (match) return match.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

export async function deleteUserByEmail(email: string): Promise<void> {
  const admin = adminClient();
  const id = await findUserId(admin, email);
  if (id) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) throw new Error(`deleteUser failed: ${error.code ?? "unknown"}`);
  }
}

/** A fresh, confirmed user (any earlier one with this email is deleted first). */
export async function createConfirmedUser(email: string): Promise<void> {
  await deleteUserByEmail(email);
  const { error } = await adminClient().auth.admin.createUser({ email, email_confirm: true });
  if (error) throw new Error(`createUser failed: ${error.code ?? "unknown"}`);
}

/** The path that signs `email` in, as the link in a magic-link email would. */
export async function magicLinkPath(email: string, next?: string): Promise<string> {
  const { data, error } = await adminClient().auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (error || !data.properties?.hashed_token)
    throw new Error(`generateLink failed: ${error?.code ?? "no token"}`);
  const params = new URLSearchParams({
    token_hash: data.properties.hashed_token,
    type: "magiclink",
  });
  if (next) params.set("next", next);
  return `/auth/callback?${params}`;
}
