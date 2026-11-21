/**
 * Ports for sign-in. The logic in sign-in.ts depends on these, not on Supabase, so it is tested
 * with in-memory fakes (fakes.ts). The Supabase adapters are in supabase-auth.ts.
 */

export interface AuthUser {
  id: string;
  email: string | null;
  createdAt: Date;
  /**
   * True when the account can come back without an email link: it has a password, or signs in
   * with Google. Absent means not known, which is treated as true.
   */
  canSignInAgain?: boolean;
}

/** Sign-in token types an email link may carry. Signup, recovery and the rest are refused. */
export type EmailTokenType = "magiclink" | "email";

/** Supabase Auth through the user's own (cookie) session. PKCE throughout. */
export interface AuthGateway {
  sendMagicLink(email: string, redirectTo: string): Promise<void>;
  /** Email and password. Null when they do not match an account. Throws on an outage. */
  signInWithPassword(email: string, password: string): Promise<AuthUser | null>;
  /** Set the signed-in user's password and mark the account as able to sign in again. */
  setPassword(password: string): Promise<void>;
  /** Email a reset link. Supabase sends nothing for an email with no account, and says so to no one. */
  sendPasswordReset(email: string, redirectTo: string): Promise<void>;
  /** The provider's sign-in URL to send the browser to. */
  googleSignInUrl(redirectTo: string): Promise<string>;
  /** Exchange the code from the callback for a session. Null when the code is invalid or used. */
  exchangeCode(code: string): Promise<AuthUser | null>;
  /** Verify a sign-in token hash from an email link. Null when it is invalid or used. */
  verifyEmailToken(tokenHash: string, type: EmailTokenType): Promise<AuthUser | null>;
  currentUser(): Promise<AuthUser | null>;
  signOut(): Promise<void>;
}

/** Service-role account actions. Server only. */
export interface AccountAdmin {
  /**
   * Make sure an auth account exists for this allowed email. Supabase sign-ups stay off until
   * launch, so this is the only way an account is created (docs/PLAN.md 12.10, F5).
   */
  ensureUser(email: string): Promise<void>;
  /** True when the account never accepted the terms, has no Stripe customer and owns no product. */
  isUnused(userId: string): Promise<boolean>;
  /** Delete an account and record it in audit_log. */
  deleteUser(userId: string): Promise<void>;
}

export interface TermsStore {
  /** Record acceptance once. "already" when it was recorded before; nothing changes then. */
  acceptTerms(userId: string): Promise<"accepted" | "already">;
}
