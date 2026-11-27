import { z } from "zod";
import type { EmailAllowed } from "./allowlist";
import { DEFAULT_NEXT_PATH, safeNextPath } from "./next-path";
import {
  type AccountAdmin,
  type AuthGateway,
  type AuthUser,
  type EmailTokenType,
  SignupsDisabledError,
  type TermsStore,
} from "./ports";

/**
 * Sign-in (docs/PLAN.md 4.3, 12.1, 12.10): email link or password, PKCE, and the pre-launch
 * allowlist. Until launch, Supabase has new sign-ups turned off (F5), so Supabase itself refuses
 * an account for anyone we have not created. The server creates one only for an allowed email,
 * then sends the link. As a second line of defense
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

export type PasswordSignInResult =
  | { kind: "ok"; path: string }
  | { kind: "wrong" }
  | { kind: "private_beta" }
  | { kind: "invalid" }
  | { kind: "error" };

/**
 * Email and password. A wrong password and an email with no account answer the same, so the form
 * never says which emails have accounts. Supabase's own rate limits apply.
 */
export async function signInWithPassword(
  deps: SignInDeps,
  input: { email: unknown; password: unknown; next: string | null | undefined },
): Promise<PasswordSignInResult> {
  const parsed = Email.safeParse(input.email);
  if (!parsed.success) return { kind: "invalid" };
  if (!deps.isAllowed(parsed.data)) return { kind: "private_beta" };
  if (typeof input.password !== "string" || input.password.length === 0) return { kind: "wrong" };
  try {
    const user = await deps.auth.signInWithPassword(parsed.data, input.password);
    if (!user) return { kind: "wrong" };
    return { kind: "ok", path: safeNextPath(input.next) };
  } catch (error) {
    logFailure("password sign in", error);
    return { kind: "error" };
  }
}

export type PasswordResetResult =
  { kind: "sent" } | { kind: "private_beta" } | { kind: "invalid" } | { kind: "error" };

/** The reset link signs the person in and lands on the set-password page. It never creates an account. */
export async function requestPasswordReset(
  deps: SignInDeps,
  input: { email: unknown },
): Promise<PasswordResetResult> {
  const parsed = Email.safeParse(input.email);
  if (!parsed.success) return { kind: "invalid" };
  if (!deps.isAllowed(parsed.data)) return { kind: "private_beta" };
  try {
    await deps.auth.sendPasswordReset(parsed.data, callbackUrl(deps.siteUrl, SET_PASSWORD_PATH));
    return { kind: "sent" };
  } catch (error) {
    logFailure("password reset", error);
    return { kind: "error" };
  }
}

export const SET_PASSWORD_PATH = "/app/password";
export const MIN_PASSWORD_LENGTH = 10;
/** bcrypt, which Supabase uses, ignores everything after 72 bytes. */
export const MAX_PASSWORD_BYTES = 72;

export type SetPasswordResult =
  | { kind: "set" }
  | { kind: "too_short" }
  | { kind: "too_long" }
  | { kind: "mismatch" }
  | { kind: "same_as_email" }
  | { kind: "error" };

/** The rules every new password meets, whether it is set after sign-in or chosen at sign-up. */
export function checkNewPassword(
  password: unknown,
  confirm: unknown,
  email: string | null,
): Exclude<SetPasswordResult["kind"], "set" | "error"> | null {
  if (typeof password !== "string" || [...password].length < MIN_PASSWORD_LENGTH)
    return "too_short";
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) return "too_long";
  if (password !== confirm) return "mismatch";
  if (email && password.trim().toLowerCase() === email.toLowerCase()) return "same_as_email";
  return null;
}

export async function setNewPassword(
  auth: Pick<AuthGateway, "setPassword">,
  user: { email: string | null },
  form: { password: unknown; confirm: unknown },
): Promise<SetPasswordResult> {
  const { password, confirm } = form;
  const problem = checkNewPassword(password, confirm, user.email);
  if (problem) return { kind: problem };
  try {
    await auth.setPassword(password as string);
    return { kind: "set" };
  } catch (error) {
    logFailure("set password", error);
    return { kind: "error" };
  }
}

export type CreateAccountResult =
  | { kind: "sent" }
  | { kind: "private_beta" }
  | { kind: "invalid" }
  | Exclude<SetPasswordResult, { kind: "set" }>;

/**
 * Create an account: an email, a password typed twice, and a verification email. The account can
 * sign in only after the link in that email is opened (Supabase's "confirm email"), and the link
 * is PKCE, so it works in the browser that signed up. The pre-launch allowlist still applies, and
 * the answer is the same for an email that already has an account.
 */
export async function createAccount(
  deps: SignInDeps,
  input: { email: unknown; password: unknown; confirm: unknown; next: string | null | undefined },
): Promise<CreateAccountResult> {
  const parsed = Email.safeParse(input.email);
  if (!parsed.success) return { kind: "invalid" };
  if (!deps.isAllowed(parsed.data)) return { kind: "private_beta" };
  const problem = checkNewPassword(input.password, input.confirm, parsed.data);
  if (problem) return { kind: problem };
  try {
    await deps.auth.signUp(
      parsed.data,
      input.password as string,
      callbackUrl(deps.siteUrl, input.next),
    );
    return { kind: "sent" };
  } catch (error) {
    // New sign-ups are off in Supabase until launch: the same answer as an email off the allowlist.
    if (error instanceof SignupsDisabledError) return { kind: "private_beta" };
    logFailure("sign up", error);
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
  },
): Promise<string> {
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
