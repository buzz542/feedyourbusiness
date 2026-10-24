/**
 * Pre-launch access (docs/PLAN.md 12.10). Until the founder says launch, only the emails in
 * SIGNUP_ALLOWLIST (comma-separated) may sign in. An empty or unset list lets nobody in. The
 * launch switch (M9) removes the check.
 */

export type EmailAllowed = (email: string | null | undefined) => boolean;

export function parseAllowlist(raw: string | undefined): EmailAllowed {
  const allowed = new Set(
    (raw ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
  return (email) => typeof email === "string" && allowed.has(email.trim().toLowerCase());
}

export const loadAllowlist = (
  env: Readonly<Record<string, string | undefined>> = process.env,
): EmailAllowed => parseAllowlist(env.SIGNUP_ALLOWLIST);
