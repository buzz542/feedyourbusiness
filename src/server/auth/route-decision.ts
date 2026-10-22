import { safeNextPath } from "./safe-next";

/**
 * What `src/proxy.ts` does with a request (docs/PLAN.md 12.1). Pure, so it is unit tested.
 * `/app` needs a session; `/admin` needs an admin and is a 404 for everyone else, so it does not
 * reveal itself. Webhook, cron, health and static paths are never touched.
 */

export interface RouteUser {
  id: string;
  isAdmin: boolean;
}

export type RouteDecision =
  { kind: "next" } | { kind: "redirect"; location: string } | { kind: "not_found" };

const SKIP = [/^\/api\/billing\/webhook$/, /^\/api\/cron(\/|$)/, /^\/api\/health$/, /^\/_next\//];

/** False for paths the proxy must pass untouched: no session refresh, no cookies written. */
export function needsSession(pathname: string): boolean {
  if (SKIP.some((re) => re.test(pathname))) return false;
  // Static files in public/ (an extension in the last segment), but never inside /app or /admin.
  if (
    !under(pathname, "/app") &&
    !under(pathname, "/admin") &&
    /\/[^/]+\.[A-Za-z0-9]+$/.test(pathname)
  )
    return false;
  return true;
}

function under(pathname: string, root: string): boolean {
  return pathname === root || pathname.startsWith(`${root}/`);
}
export function decideRoute(
  pathname: string,
  search: string,
  user: RouteUser | null,
): RouteDecision {
  if (under(pathname, "/admin")) return user?.isAdmin ? { kind: "next" } : { kind: "not_found" };
  if (under(pathname, "/app")) {
    if (user) return { kind: "next" };
    return { kind: "redirect", location: `/login?next=${encodeURIComponent(pathname + search)}` };
  }
  if (pathname === "/login" && user) {
    return { kind: "redirect", location: safeNextPath(new URLSearchParams(search).get("next")) };
  }
  return { kind: "next" };
}
