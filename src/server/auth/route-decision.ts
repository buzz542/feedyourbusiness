import { safeNextPath } from "./safe-next";

/**
 * What the proxy does with a request (docs/PLAN.md 12.1). Pure, so every case is unit tested; the
 * proxy only gathers the inputs (the session and, on /admin, the admin flag).
 */

export type RouteDecision =
  { kind: "next" } | { kind: "redirect"; to: string } | { kind: "not_found" };

const inSection = (pathname: string, section: string) =>
  pathname === section || pathname.startsWith(`${section}/`);

/** Paths the proxy never touches: Stripe's webhook, crons, the health check and static files. */
export function isSkippedPath(pathname: string): boolean {
  return (
    pathname === "/api/billing/webhook" ||
    inSection(pathname, "/api/cron") ||
    pathname === "/api/health" ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt"
  );
}

/**
 * The path as Next's router will match it. The proxy sees the raw, still-encoded path, but routing
 * decodes it ("/%61dmin" serves /admin), so every decision is made on the decoded form. Null when
 * it cannot be decoded.
 */
export function routedPath(pathname: string): string | null {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}

export const isAdminPath = (pathname: string): boolean => {
  const path = routedPath(pathname);
  return path === null || inSection(path, "/admin");
};

export function decideRoute(input: {
  pathname: string;
  search: string;
  userId: string | null;
  /** The session's email is on the pre-launch allowlist (12.10). */
  allowed: boolean;
  isAdmin: boolean;
}): RouteDecision {
  const { pathname, search, allowed, isAdmin } = input;
  const path = routedPath(pathname);
  // A path we cannot decode is never served past the gate.
  if (path === null) return { kind: "not_found" };
  // A session off the allowlist is treated as signed out everywhere.
  const userId = allowed ? input.userId : null;

  if (input.userId && !allowed && inSection(path, "/app"))
    return { kind: "redirect", to: "/login?beta=1" };

  // Admin pages do not reveal themselves: anyone who is not an admin gets the ordinary 404.
  if (inSection(path, "/admin"))
    return userId && isAdmin ? { kind: "next" } : { kind: "not_found" };

  if (inSection(path, "/app") && !userId) {
    return { kind: "redirect", to: `/login?next=${encodeURIComponent(`${path}${search}`)}` };
  }

  if (path === "/login" && userId) {
    return { kind: "redirect", to: safeNextPath(new URLSearchParams(search).get("next")) };
  }

  return { kind: "next" };
}
