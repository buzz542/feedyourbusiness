import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { clientIp, ipHash } from "@/server/privacy/ip-hash";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import type { Database } from "@/types/database";
import {
  SIGN_IN_DAILY_PER_IP,
  type AuthCallbackDeps,
  type CallbackUser,
  type MagicLinkPort,
} from "./sign-in";
import type { TermsStore } from "./terms";

type UserClient = SupabaseClient<Database>;

const toCallbackUser = (user: User): CallbackUser => ({
  id: user.id,
  email: user.email ?? null,
  createdAt: new Date(user.created_at),
});

export function createMagicLinkPort(supabase: UserClient): MagicLinkPort {
  return {
    async ensureUser(email) {
      const { error } = await createSupabaseAdminClient().auth.admin.createUser({
        email,
        // They prove control of the address by opening the link; no separate confirmation email.
        email_confirm: true,
      });
      if (!error || error.code === "email_exists" || error.code === "user_already_exists")
        return { ok: true };
      return { ok: false, errorClass: error.name };
    },
    async sendMagicLink(email, redirectTo) {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo, shouldCreateUser: false },
      });
      return error ? { ok: false, errorClass: error.name } : { ok: true };
    },
  };
}

export function createCallbackDeps(supabase: UserClient, now: Date): AuthCallbackDeps {
  return {
    env: process.env,
    now,
    async exchangeCode(code) {
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      return error || !data.user ? null : toCallbackUser(data.user);
    },
    async signOut() {
      await supabase.auth.signOut();
    },
    async deleteNewUser(userId) {
      const { error } = await createSupabaseAdminClient().auth.admin.deleteUser(userId);
      if (error) throw new Error("Supabase: could not delete user");
    },
  };
}

export function createTermsStore(supabase: UserClient): TermsStore {
  return {
    async acceptTermsOnce(userId, now) {
      // The database stamps its own time and keeps the first value; the filter avoids a no-op write.
      const { data, error } = await supabase
        .from("profiles")
        .update({ terms_accepted_at: now.toISOString() })
        .eq("id", userId)
        .is("terms_accepted_at", null)
        .select("id");
      if (error) throw new Error("Supabase: could not record terms acceptance");
      return (data ?? []).length > 0;
    },
  };
}

/**
 * The sign-in IP-hash rate limit (docs/TASKS.md M9 launch switch), or undefined without
 * APP_HMAC_SECRET. Records the attempt, then counts today's attempts for this hash, which changes
 * with the UTC day. Rows older than 2 days are cleared as it goes.
 */
export async function signInAttempt(): Promise<(() => Promise<boolean>) | undefined> {
  const secret = process.env.APP_HMAC_SECRET;
  if (!secret || secret.length < 32) return undefined;
  const now = new Date();
  const hash = ipHash(secret, clientIp(await headers()), now);
  return async () => {
    const db = createSupabaseAdminClient();
    const { error } = await db.from("sign_in_attempts").insert({ ip_hash: hash });
    if (error) throw new Error("sign_in_attempt_failed");
    await db
      .from("sign_in_attempts")
      .delete()
      .lt("created_at", new Date(now.getTime() - 2 * 86_400_000).toISOString());
    const { count } = await db
      .from("sign_in_attempts")
      .select("id", { count: "exact", head: true })
      .eq("ip_hash", hash);
    return (count ?? 0) <= SIGN_IN_DAILY_PER_IP;
  };
}
