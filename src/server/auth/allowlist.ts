/**
 * Pre-launch access (docs/PLAN.md 12.10). Until the founder says launch, only the emails in
 * SIGNUP_ALLOWLIST may sign in. An unset or empty list lets nobody in. The launch switch (M9)
 * removes this check.
 */
export type Allowlist = ReadonlySet<string>;

const normalize = (email: string) => email.trim().toLowerCase();

export function parseAllowlist(raw: string | undefined): Allowlist {
  return new Set(
    (raw ?? "")
      .split(",")
      .map(normalize)
      .filter((e) => e.length > 0),
  );
}

export function isAllowedEmail(email: string | null | undefined, list: Allowlist): boolean {
  if (!email) return false;
  return list.has(normalize(email));
}

export const PRIVATE_BETA_MESSAGE = "AskedFor is in private beta.";
