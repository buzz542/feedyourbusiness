/** Ports for sign-in, so the flow is tested with fakes and never touches Supabase. */

export interface AuthUser {
  id: string;
  email: string | null;
  createdAt: Date;
}

export type OtpType = "magiclink" | "email" | "signup";

export interface AuthPort {
  /** Sends a magic link. Must not create the account itself; Supabase creates it on first verify. */
  sendMagicLink(email: string, redirectTo: string): Promise<void>;
  /** The provider URL to send the browser to (PKCE). */
  googleSignInUrl(redirectTo: string): Promise<string>;
  /** Exchanges a PKCE code for a session. Null when the code is unknown or expired. */
  exchangeCode(code: string): Promise<AuthUser | null>;
  /** Verifies an email link's token hash. Null when invalid or expired. */
  verifyTokenHash(tokenHash: string, type: OtpType): Promise<AuthUser | null>;
  signOut(): Promise<void>;
  /** Service-role delete of an auth user (cascades every owned row). */
  deleteUser(userId: string): Promise<void>;
}

export interface TermsStore {
  /** Sets terms_accepted_at only when it is still null. True when this call stored it. */
  acceptTerms(userId: string, now: Date): Promise<boolean>;
}
