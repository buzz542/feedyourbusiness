import "server-only";
import type { User } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { PASSWORD_SET_KEY, canSignInAgain, isRepeatSignUp } from "./credentials";
import {
  type AccountAdmin,
  type AuthGateway,
  type AuthUser,
  SignupsDisabledError,
  type TermsStore,
} from "./ports";

/** Thin adapters over Supabase Auth. Logic lives in sign-in.ts and is tested with fakes. */

/** Supabase's codes for "an account with this email already exists". */
const ALREADY_EXISTS = new Set(["email_exists", "user_already_exists"]);

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
  canSignInAgain: canSignInAgain(user),
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
    async signUp(email, password, redirectTo) {
      // password_set marks the account as able to come back without a link, so the app does not
      // ask for a password again after the email is verified.
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: redirectTo, data: { [PASSWORD_SET_KEY]: true } },
      });
      if (error?.code === "signup_disabled") throw new SignupsDisabledError();
      if (error && ALREADY_EXISTS.has(error.code ?? "")) return "exists";
      if (error) throw new SupabaseAuthError(error.code);
      if (data.user && isRepeatSignUp(data.user)) return "exists";
      return "created";
    },
    async verifySignupCode(email, code) {
      // type "signup" matches the email Supabase sent for sign-up. No PKCE cookie is involved, so
      // the code works on a different device from the one that signed up; verifying sets the session.
      const { data, error } = await supabase.auth.verifyOtp({ email, token: code, type: "signup" });
      if (error || !data.user) {
        // A wrong, expired or used code reads as "not that code"; an outage still throws.
        if (
          !error ||
          ["otp_expired", "otp_disabled", "validation_failed"].includes(error.code ?? "")
        )
          return null;
        if (error.status && error.status >= 400 && error.status < 500) return null;
        throw new SupabaseAuthError(error.code);
      }
      return toAuthUser(data.user);
    },
    async resendSignupCode(email, redirectTo) {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email,
        options: { emailRedirectTo: redirectTo },
      });
      if (error) throw new SupabaseAuthError(error.code);
    },
    async signInWithPassword(email, password) {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        // A wrong password, an unknown email and an unconfirmed one all read as "not you".
        if (error.code === "invalid_credentials" || error.code === "email_not_confirmed")
          return null;
        throw new SupabaseAuthError(error.code);
      }
      return data.user ? toAuthUser(data.user) : null;
    },
    async setPassword(password) {
      const { error } = await supabase.auth.updateUser({
        password,
        data: { [PASSWORD_SET_KEY]: true },
      });
      if (error) throw new SupabaseAuthError(error.code);
    },
    async sendPasswordReset(email, redirectTo) {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw new SupabaseAuthError(error.code);
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

export function createSupabaseAccountAdmin(): AccountAdmin {
  return {
    async ensureUser(email) {
      // Confirmed, so the email link signs in. Only allowed emails reach here.
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
