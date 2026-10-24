import { z } from "zod";
import type { EmailAllowed } from "./allowlist";
import { DEFAULT_NEXT_PATH, safeNextPath } from "./next-path";
import type { AccountAdmin, AuthGateway, AuthUser, EmailTokenType, TermsStore } from "./ports";

/**
 * Sign-in (docs/PLAN.md 4.3, 12.1, 12.10): magic link or Google, PKCE, and the pre-launch
 * allowlist. Until launch, Supabase has new sign-ups turned off (F5), so Supabase itself refuses
 * an account for anyone we have not created. The server creates one only for an allowed email,
 * then sends the link. Google sign-in works once that account exists. As a second line of defense
 * the callback signs out any account off the list, and deletes it only when it was created in the
 * last 10 minutes and never used, so a real tester dropped from the list by mistake keeps their data.
 */

export interface SignInDeps {
  auth: AuthGateway;
  admin: AccountAdmin;
  isAllowed: EmailAllowed;
  siteUrl: string;
  now: () => Date;
  /**
   * Accept an email link's token hash at the callback. It skips PKCE, so a link someone else
   * requested would sign the clicker into their account (login CSRF). Local dev servers only,
   * for the E2E sign-in helper; production uses the PKCE code alone.
   */
  allowEmailTokenHash: boolean;
}

export const LOGIN_PATH = "/login";
export const CALLBACK_PATH = "/auth/callback";
export const LINK_ERROR_PATH = `${LOGIN_PATH}?error=link`;
export const PRIVATE_BETA_PATH = `${LOGIN_PATH}?error=private_beta`;
export const FIRST_TIME_PATH = `${LOGIN_PATH}?error=first_time`;

/** An unused account this new, off the allowlist, was made by the sign-in being refused. */
const FRESH_ACCOUNT_MS = 10 * 60 * 1000;

const Email = z.string().trim().toLowerCase().pipe(z.email().max(320));

const EMAIL_TOKEN_TYPES: readonly string[] = ["magiclink", "email"] satisfies EmailTokenType[];

/** Log the error class only: messages can carry emails or tokens. */
function logFailure(step: string, error: unknown): void {
  console.error(`[auth] ${step} failed: ${error instanceof Error ? error.name : "UnknownError"}`);
}

/** The callback URL handed to Supabase. A next path is kept only when it is safe. */
export function callbackUrl(siteUrl: string, next: string | null | undefined): string {
  const path = safeNextPath(next);
  const base = `${siteUrl}${CALLBACK_PATH}`;
  return path === DEFAULT_NEXT_PATH ? base : `${base}?next=${encodeURIComponent(path)}`;
}

export type MagicLinkResult =
  { kind: "sent" } | { kind: "private_beta" } | { kind: "invalid" } | { kind: "error" };

export async function requestMagicLink(
  deps: SignInDeps,
  input: { email: unknown; next: string | null | undefined },
): Promise<MagicLinkResult> {
  const parsed = Email.safeParse(input.email);
  if (!parsed.success) return { kind: "invalid" };
  if (!deps.isAllowed(parsed.data)) return { kind: "private_beta" };
  try {
    await deps.admin.ensureUser(parsed.data);
    await deps.auth.sendMagicLink(parsed.data, callbackUrl(deps.siteUrl, input.next));
    return { kind: "sent" };
  } catch (error) {
    logFailure("magic link", error);
    return { kind: "error" };
  }
}

export async function startGoogleSignIn(
  deps: SignInDeps,
  input: { next: string | null | undefined },
): Promise<{ kind: "redirect"; url: string } | { kind: "error" }> {
  try {
    return {
      kind: "redirect",
      url: await deps.auth.googleSignInUrl(callbackUrl(deps.siteUrl, input.next)),
    };
  } catch (error) {
    logFailure("google start", error);
    return { kind: "error" };
  }
}

/** Handle `/auth/callback`. Returns the path to redirect to. */
export async function completeSignIn(
  deps: SignInDeps,
  input: {
    code: string | null | undefined;
    next: string | null | undefined;
    /** An email link's token hash and type (Supabase's email-link flow), instead of a code. */
    tokenHash?: string | null;
    type?: string | null;
    /** Supabase's error_code on a failed redirect, if any. */
    errorCode?: string | null;
  },
): Promise<string> {
  // With sign-ups off, Google refuses an account we have not created: an email link comes first.
  if (input.errorCode === "signup_disabled") return FIRST_TIME_PATH;

  let user: AuthUser | null;
  try {
    if (input.code) {
      user = await deps.auth.exchangeCode(input.code);
    } else if (
      deps.allowEmailTokenHash &&
      input.tokenHash &&
      input.type &&
      EMAIL_TOKEN_TYPES.includes(input.type)
    ) {
      user = await deps.auth.verifyEmailToken(input.tokenHash, input.type as EmailTokenType);
    } else {
      return LINK_ERROR_PATH;
    }
  } catch (error) {
    logFailure("code exchange", error);
    return LINK_ERROR_PATH;
  }
  if (!user) return LINK_ERROR_PATH;

  if (!deps.isAllowed(user.email)) {
    try {
      await deps.auth.signOut();
    } catch (error) {
      logFailure("sign out", error);
    }
    if (deps.now().getTime() - user.createdAt.getTime() <= FRESH_ACCOUNT_MS) {
      try {
        if (await deps.admin.isUnused(user.id)) await deps.admin.deleteUser(user.id);
      } catch (error) {
        logFailure("delete refused account", error);
      }
    }
    return PRIVATE_BETA_PATH;
  }

  return safeNextPath(input.next);
}

export type AcceptTermsResult = { kind: "accepted" } | { kind: "already" } | { kind: "missing" };

/** "I am 18 or older" and "I agree to the Terms and the Acceptable use policy", both required. */
export async function acceptTerms(
  store: TermsStore,
  userId: string,
  form: { adult: boolean; terms: boolean },
): Promise<AcceptTermsResult> {
  if (form.adult !== true || form.terms !== true) return { kind: "missing" };
  return { kind: await store.acceptTerms(userId) };
}
