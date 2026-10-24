import "server-only";
import type { User } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import { createSupabaseServerClient } from "@/server/supabase/server";
import type { AccountAdmin, AuthGateway, AuthUser, TermsStore } from "./ports";

/** Thin adapters over Supabase Auth. Logic lives in sign-in.ts and is tested with fakes. */

class SupabaseAuthError extends Error {
  override name = "SupabaseAuthError";
  constructor(readonly code: string | undefined) {
    // Never the Supabase message: it can echo the email.
    super(`Supabase Auth error ${code ?? "unknown"}`);
  }
}

const toAuthUser = (user: User): AuthUser => ({
  id: user.id,
  email: user.email ?? null,
  createdAt: new Date(user.created_at),
});

export async function createSupabaseAuthGateway(): Promise<AuthGateway> {
  const supabase = await createSupabaseServerClient();
  return {
    async sendMagicLink(email, redirectTo) {
      // Never create an account here: only ensureUser does, for allowed emails.
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo, shouldCreateUser: false },
      });
      if (error) throw new SupabaseAuthError(error.code);
    },
    async googleSignInUrl(redirectTo) {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo, skipBrowserRedirect: true },
      });
      if (error || !data.url) throw new SupabaseAuthError(error?.code);
      return data.url;
    },
    async exchangeCode(code) {
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      if (error || !data.user) return null;
      return toAuthUser(data.user);
    },
    async verifyEmailToken(tokenHash, type) {
      const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
      if (error || !data.user) return null;
      return toAuthUser(data.user);
    },
    async currentUser() {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) return null;
      return toAuthUser(data.user);
    },
    async signOut() {
      const { error } = await supabase.auth.signOut();
      if (error) throw new SupabaseAuthError(error.code);
    },
  };
}

/** Supabase's codes for "an account with this email already exists". */
const ALREADY_EXISTS = new Set(["email_exists", "user_already_exists"]);

export function createSupabaseAccountAdmin(): AccountAdmin {
  return {
    async ensureUser(email) {
      // Confirmed, so Google sign-in links to this account. Only allowlisted emails reach here.
      const { error } = await createSupabaseAdminClient().auth.admin.createUser({
        email,
        email_confirm: true,
      });
      if (error && !ALREADY_EXISTS.has(error.code ?? "")) throw new SupabaseAuthError(error.code);
    },
    async isUnused(userId) {
      const admin = createSupabaseAdminClient();
      const [profile, products] = await Promise.all([
        admin
          .from("profiles")
          .select("terms_accepted_at, stripe_customer_id")
          .eq("id", userId)
          .maybeSingle(),
        admin.from("products").select("id", { count: "exact", head: true }).eq("owner_id", userId),
      ]);
      if (profile.error) throw new SupabaseAuthError(profile.error.code);
      if (products.error) throw new SupabaseAuthError(products.error.code);
      return (
        profile.data?.terms_accepted_at == null &&
        profile.data?.stripe_customer_id == null &&
        (products.count ?? 0) === 0
      );
    },
    async deleteUser(userId) {
      const admin = createSupabaseAdminClient();
      // Audit first, so a deletion never happens without its row. The user id only, never the
      // email (docs/PLAN.md 2.3.8).
      const audit = await admin
        .from("audit_log")
        .insert({ actor: "system", action: "refused_signup_delete_requested", target: userId });
      if (audit.error) throw new SupabaseAuthError(audit.error.code);
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) throw new SupabaseAuthError(error.code);
    },
  };
}

/** Uses the user's own session, so RLS and the column grant decide what can be written. */
export async function createSupabaseTermsStore(): Promise<TermsStore> {
  const supabase = await createSupabaseServerClient();
  return {
    async acceptTerms(userId) {
      // The database stamps its own time and keeps the first one (profiles_app migration).
      const { data, error } = await supabase
        .from("profiles")
        .update({ terms_accepted_at: new Date().toISOString() })
        .eq("id", userId)
        .is("terms_accepted_at", null)
        .select("id");
      if (error) throw new SupabaseAuthError(error.code);
      return data.length > 0 ? "accepted" : "already";
    },
  };
}
