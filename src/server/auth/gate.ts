import type { EmailAllowed } from "./allowlist";
import { DEFAULT_NEXT_PATH, safeNextPath } from "./next-path";
import type { AuthUser } from "./ports";

/**
 * Who may see an app page. Before launch an account off SIGNUP_ALLOWLIST is refused even when
 * it exists (someone can ask Supabase for a link directly with the public key), so the allowlist
 * is checked on every app page, not only at sign-in (docs/PLAN.md 12.10).
 */
export type Gate = { kind: "anonymous" } | { kind: "refused" } | { kind: "ok"; user: AuthUser };

export function gateUser(user: AuthUser | null, isAllowed: EmailAllowed): Gate {
  if (!user) return { kind: "anonymous" };
  if (!isAllowed(user.email)) return { kind: "refused" };
  return { kind: "ok", user };
}

/** The sign-in page, returning to `path` afterwards when that is a safe app path. */
export function loginPathFor(path: string): string {
  const next = safeNextPath(path);
  return next === DEFAULT_NEXT_PATH ? "/login" : `/login?next=${encodeURIComponent(next)}`;
}
