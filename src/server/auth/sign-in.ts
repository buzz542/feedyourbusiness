import { z } from "zod";
import { isSignInAllowed, normalizeEmail } from "./allowlist";
import { safeNextPath } from "./safe-next";

/**
 * Sign-in flows (docs/PLAN.md 4.3, 12.1, 12.10), behind small ports so they are tested without
 * Supabase.
 *
 * Before launch, Supabase's public sign-up is switched off (docs/PLAN.md F5), so Supabase itself
 * refuses to create an account for anyone the server has not created. For an email on the allowlist
 * the server creates the account (service role), then sends the link without letting Supabase
 * create users; an email off the list is never sent to Supabase at all. If public sign-up is still
 * on, the callback removes a just-created account that is not allowed (Google), and only signs out
 * an older one; every session is checked against the allowlist again (session-user.ts).
 */

type Env = Readonly<Record<string, string | undefined>>;

type PortResult = { ok: true } | { ok: false; errorClass: string };

export interface MagicLinkPort {
  /** Create the account if it does not exist yet (service role). An existing account is fine. */
  ensureUser(email: string): Promise<PortResult>;
  /** Send the link without letting the provider create an account. */
  sendMagicLink(email: string, redirectTo: string): Promise<PortResult>;
}

export type MagicLinkResult =
  | { status: "sent" }
  | { status: "private_beta" }
  | { status: "invalid_email" }
  | { status: "rate_limited" }
  | { status: "error" };

/** Magic links one client IP (a daily hash of it) may request per UTC day. */
export const SIGN_IN_DAILY_PER_IP = 10;

const emailSchema = z.email().max(254);

export function authCallbackUrl(siteUrl: string, next: string | null | undefined): string {
  return `${siteUrl}/auth/callback?next=${encodeURIComponent(safeNextPath(next))}`;
}

export async function requestMagicLink(
  deps: {
    auth: MagicLinkPort;
    siteUrl: string;
    env: Env;
    /**
     * Records this attempt and says whether the client is still under the daily limit. Supabase sees
     * our server's IP, not the visitor's, so this limit is ours. A failing store lets the request
     * through: Supabase's own per-address limit still holds.
     */
    attempt?: () => Promise<boolean>;
  },
  input: { email: string; next: string | null },
): Promise<MagicLinkResult> {
  const email = normalizeEmail(input.email);
  if (!emailSchema.safeParse(email).success) return { status: "invalid_email" };
  if (!isSignInAllowed(email, deps.env)) return { status: "private_beta" };
  if (deps.attempt && !(await deps.attempt().catch(() => true))) return { status: "rate_limited" };

  let ensured: Awaited<ReturnType<MagicLinkPort["ensureUser"]>>;
  try {
    ensured = await deps.auth.ensureUser(email);
  } catch (error) {
    ensured = { ok: false, errorClass: error instanceof Error ? error.name : "UnknownError" };
  }
  if (!ensured.ok) {
    console.error(`[auth] could not prepare the account: ${ensured.errorClass}`);
    return { status: "error" };
  }
  const sent = await deps.auth.sendMagicLink(email, authCallbackUrl(deps.siteUrl, input.next));
  if (!sent.ok) {
    console.error(`[auth] magic link failed: ${sent.errorClass}`);
    return { status: "error" };
  }
  return { status: "sent" };
}

export interface CallbackUser {
  id: string;
  email: string | null;
  createdAt: Date;
}

export interface AuthCallbackDeps {
  env: Env;
  now: Date;
  /** PKCE: exchange the code for a session (sets the session cookies). Null on failure. */
  exchangeCode(code: string): Promise<CallbackUser | null>;
  signOut(): Promise<void>;
  /** Delete an account the callback just created (service role). */
  deleteNewUser(userId: string): Promise<void>;
}

/** An account this young was created by this sign-in. Older ones are never deleted here. */
const NEW_ACCOUNT_WINDOW_MS = 10 * 60 * 1000;

/** Returns the relative path to redirect to. */
export async function handleAuthCallback(deps: AuthCallbackDeps, url: URL): Promise<string> {
  // Only the PKCE code: it is bound to the browser that started sign-in, so nobody can sign a
  // victim into the attacker's account with a link (no token-hash links).
  const code = url.searchParams.get("code");
  // Supabase reports failures in the query: an expired or used email link (otp_expired), Google
  // refused because public sign-up is off and the account does not exist yet (signup_disabled), or
  // a cancelled Google sign-in.
  if (!code && url.searchParams.has("error")) {
    const reason = url.searchParams.get("error_code");
    if (reason === "otp_expired") return "/login?error=link";
    if (reason === "signup_disabled") return "/login?error=first_time";
    return "/login?error=google";
  }

  let user: CallbackUser | null = null;
  try {
    if (code) user = await deps.exchangeCode(code);
  } catch (error) {
    console.error(
      `[auth] callback failed: ${error instanceof Error ? error.name : "UnknownError"}`,
    );
    user = null;
  }
  if (!user) return "/login?error=link";

  if (!isSignInAllowed(user.email, deps.env)) {
    await deps.signOut();
    if (deps.now.getTime() - user.createdAt.getTime() < NEW_ACCOUNT_WINDOW_MS) {
      try {
        await deps.deleteNewUser(user.id);
      } catch (error) {
        console.error(
          `[auth] could not remove a new account off the allowlist: ${error instanceof Error ? error.name : "UnknownError"}`,
        );
      }
    }
    return "/login?beta=1";
  }

  return safeNextPath(url.searchParams.get("next"));
}
