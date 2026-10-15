import { isSignInAllowed } from "./allowlist";

type Env = Readonly<Record<string, string | undefined>>;

export interface SessionUser {
  id: string;
  email: string | null;
}

/**
 * Every session is checked against the pre-launch allowlist (docs/PLAN.md 12.10), not only sign-in:
 * an account created outside /login, an older Google account, or a tester the founder removed from
 * the list counts as signed out, so it reaches neither the app nor Checkout.
 */
export function allowedSessionUser(
  user: { id: string; email?: string | null } | null,
  env: Env = process.env,
): SessionUser | null {
  if (!user) return null;
  const email = user.email ?? null;
  return isSignInAllowed(email, env) ? { id: user.id, email } : null;
}
