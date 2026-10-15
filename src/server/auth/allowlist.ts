/**
 * Pre-launch access (docs/PLAN.md 12.10). Until the founder says launch, only the emails in
 * SIGNUP_ALLOWLIST may sign in. An unset or empty list lets nobody in: fail closed.
 */
type Env = Readonly<Record<string, string | undefined>>;

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export function parseAllowlist(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map(normalizeEmail)
      .filter((e) => e.length > 0),
  );
}

export function isSignInAllowed(email: string | null | undefined, env: Env = process.env): boolean {
  if (!email) return false;
  return parseAllowlist(env.SIGNUP_ALLOWLIST).has(normalizeEmail(email));
}
