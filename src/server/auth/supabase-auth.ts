import "server-only";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import { createSupabaseServerClient } from "@/server/supabase/server";
import type { AuthPort, AuthUser, TermsStore } from "./ports";

/** Supabase Auth adapter. Thin: the flow and its rules live in sign-in.ts. */

const toUser = (u: { id: string; email?: string | null; created_at: string } | null | undefined) =>
  u
    ? ({ id: u.id, email: u.email ?? null, createdAt: new Date(u.created_at) } satisfies AuthUser)
    : null;

export function createSupabaseAuth(): AuthPort & TermsStore {
  return {
    async sendMagicLink(email, redirectTo) {
      const supabase = await createSupabaseServerClient();
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo, shouldCreateUser: true },
      });
      if (error) throw new Error("Supabase: magic link not sent");
    },
    async googleSignInUrl(redirectTo) {
      const supabase = await createSupabaseServerClient();
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo, skipBrowserRedirect: true },
      });
      if (error || !data.url) throw new Error("Supabase: Google sign-in not started");
      return data.url;
    },
    async exchangeCode(code) {
      const supabase = await createSupabaseServerClient();
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      return error ? null : toUser(data.user);
    },
    async verifyTokenHash(tokenHash, type) {
      const supabase = await createSupabaseServerClient();
      const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
      return error ? null : toUser(data.user);
    },
    async signOut() {
      const supabase = await createSupabaseServerClient();
      // Local: this browser only. It clears the cookies even when the Auth server is unreachable.
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) throw new Error("Supabase: sign out failed");
    },
    async deleteUser(userId) {
      const { error } = await createSupabaseAdminClient().auth.admin.deleteUser(userId);
      if (error) throw new Error("Supabase: could not delete user");
    },
    async acceptTerms(userId, now) {
      const supabase = await createSupabaseServerClient();
      const { data, error } = await supabase
        .from("profiles")
        .update({ terms_accepted_at: now.toISOString() })
        .eq("id", userId)
        .is("terms_accepted_at", null)
        .select("id");
      if (error) throw new Error("Supabase: could not store terms acceptance");
      return data.length === 1;
    },
  };
}

/** The signed-in user, verified with the Auth server (never trust the cookie alone). */
export async function getSessionUser(): Promise<AuthUser | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  return error ? null : toUser(data.user);
}
