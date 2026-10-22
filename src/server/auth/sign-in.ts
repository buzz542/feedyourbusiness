import { z } from "zod";
import { isAllowedEmail, type Allowlist } from "./allowlist";
import type { AuthPort, AuthUser, OtpType, TermsStore } from "./ports";
import { safeNextPath } from "./safe-next";

/**
 * Sign-in flows (docs/PLAN.md 4.3, 12.1, 12.10). Magic link and Google through Supabase Auth with
 * PKCE. Before launch, only allowlisted emails get an account: the magic link is never requested for
 * anyone else, and a Google sign-in that just created an account for someone else deletes it at once.
 */

const Email = z.email().max(320);

/** An account created this recently counts as new: first sign-in, nothing in it yet. */
const NEW_ACCOUNT_MS = 10 * 60 * 1000;

const callbackUrl = (siteUrl: string, next: string | null | undefined) =>
  `${siteUrl.replace(/\/$/, "")}/auth/callback?next=${encodeURIComponent(safeNextPath(next))}`;

export type MagicLinkResult =
  | { status: "sent" }
  | { status: "private_beta" }
  | { status: "invalid_email" }
  | { status: "error" };

export async function requestMagicLink(
  deps: { auth: AuthPort; allowlist: Allowlist; siteUrl: string },
  input: { email: string; next: string | null | undefined },
): Promise<MagicLinkResult> {
  const parsed = Email.safeParse(input.email.trim().toLowerCase());
  if (!parsed.success) return { status: "invalid_email" };
  const email = parsed.data;
  if (!isAllowedEmail(email, deps.allowlist)) return { status: "private_beta" };
  try {
    await deps.auth.sendMagicLink(email, callbackUrl(deps.siteUrl, input.next));
    return { status: "sent" };
  } catch (error) {
    console.error(`[auth] magic link failed: ${error instanceof Error ? error.name : "Unknown"}`);
    return { status: "error" };
  }
}

export async function startGoogleSignIn(
  deps: { auth: AuthPort; siteUrl: string },
  input: { next: string | null | undefined },
): Promise<{ status: "redirect"; url: string } | { status: "error" }> {
  try {
    return {
      status: "redirect",
      url: await deps.auth.googleSignInUrl(callbackUrl(deps.siteUrl, input.next)),
    };
  } catch (error) {
    console.error(`[auth] google start failed: ${error instanceof Error ? error.name : "Unknown"}`);
    return { status: "error" };
  }
}

const OTP_TYPES: readonly OtpType[] = ["magiclink", "email", "signup"];

export interface CallbackInput {
  code?: string | null;
  tokenHash?: string | null;
  type?: string | null;
  next: string | null | undefined;
}

/**
 * Where to send the browser, and the signed-in user's id. The route records `signed_up` for it; the
 * database keeps one such event per user, so repeat sign-ins add nothing.
 */
export interface CallbackResult {
  location: string;
  userId: string | null;
}

async function attempt(step: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    console.error(`[auth] ${step} failed: ${error instanceof Error ? error.name : "Unknown"}`);
  }
}

export async function handleAuthCallback(
  deps: { auth: AuthPort; allowlist: Allowlist; now: () => Date },
  input: CallbackInput,
): Promise<CallbackResult> {
  const failed = { location: "/login?error=link", userId: null };
  let user;
  try {
    if (input.code) {
      user = await deps.auth.exchangeCode(input.code);
    } else if (input.tokenHash && OTP_TYPES.includes(input.type as OtpType)) {
      user = await deps.auth.verifyTokenHash(input.tokenHash, input.type as OtpType);
    }
  } catch (error) {
    console.error(`[auth] callback failed: ${error instanceof Error ? error.name : "Unknown"}`);
    return failed;
  }
  if (!user) return failed;

  const isNew = deps.now().getTime() - user.createdAt.getTime() < NEW_ACCOUNT_MS;
  if (!isAllowedEmail(user.email, deps.allowlist)) {
    // Google creates the account before we see the email. Remove it unless it predates this sign-in.
    // Each step runs even if the other fails; the app frame signs out any session that survives.
    await attempt("sign out", () => deps.auth.signOut());
    if (isNew) await attempt("delete", () => deps.auth.deleteUser(user.id));
    return { location: "/login?error=private_beta", userId: null };
  }
  return { location: safeNextPath(input.next), userId: user.id };
}

/** The 18+ and terms confirmations (docs/PLAN.md 4.3). Stored once; never moved later. */
export function acceptTerms(store: TermsStore, userId: string, now: Date): Promise<boolean> {
  return store.acceptTerms(userId, now);
}

/**
 * Supabase's own signup endpoint is public, so a session can exist for someone who never passed our
 * sign-in checks. The app frame sends such a user here: they are signed out. An allowlisted user is
 * never signed out, so a forged link to this step does nothing.
 */
export async function leavePrivateBeta(
  deps: { auth: AuthPort; allowlist: Allowlist },
  user: AuthUser | null,
): Promise<string> {
  if (!user) return "/login";
  if (isAllowedEmail(user.email, deps.allowlist)) return "/app";
  await deps.auth.signOut();
  return "/login?error=private_beta";
}
