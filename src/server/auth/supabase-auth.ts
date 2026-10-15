import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import type { Database } from "@/types/database";
import type { AuthCallbackDeps, CallbackUser, MagicLinkPort } from "./sign-in";
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
