import { loginPathFor } from "./gate";

/**
 * The routing decision behind src/proxy.ts (docs/PLAN.md 12.1). Pure, so every case is unit
 * tested; the proxy only adds the Supabase session lookup.
 *
 *   skip    webhook, cron, health and static files: untouched, no session work
 *   app     /app and below: signed in, or sent to /login with next
 *   admin   /admin and below: admins only; everyone else gets a 404
 *   public  everything else: the session is refreshed, nothing is blocked
 *
 * Pages still check for themselves (requireAppUser, and the admin pages in M9); this is the outer
 * layer, not the only one.
 */

export type Area = "skip" | "app" | "admin" | "public";

const SKIP_EXACT = new Set([
  "/api/billing/webhook",
  "/api/health",
  "/favicon.ico",
  "/robots.txt",
  // The callback manages its own cookies; a session refresh here could clear the PKCE verifier.
  "/auth/callback",
]);
const SKIP_PREFIXES = ["/api/cron/", "/_next/"];
/** A last path segment with a file extension is a static file. */
const STATIC_FILE = /\/[^/]+\.[a-z0-9]{1,8}$/i;

const under = (path: string, root: string) => path === root || path.startsWith(`${root}/`);

export function classifyPath(pathname: string): Area {
  if (SKIP_EXACT.has(pathname) || SKIP_PREFIXES.some((p) => pathname.startsWith(p))) return "skip";
  if (under(pathname, "/app")) return "app";
  if (under(pathname, "/admin")) return "admin";
  if (!pathname.startsWith("/api/") && STATIC_FILE.test(pathname)) return "skip";
  return "public";
}

export type RouteDecision =
  { kind: "pass" } | { kind: "redirect"; to: string } | { kind: "not_found" };

export function decideRoute(
  area: Area,
  viewer: { signedIn: boolean; isAdmin: boolean },
  pathWithSearch: string,
  method = "GET",
): RouteDecision {
  if (area === "app" && !viewer.signedIn) {
    // Server actions POST to the page; requireAppUser redirects them in a way the client follows.
    if (method !== "GET" && method !== "HEAD") return { kind: "pass" };
    return { kind: "redirect", to: loginPathFor(pathWithSearch) };
  }
  if (area === "admin" && !(viewer.signedIn && viewer.isAdmin)) return { kind: "not_found" };
  return { kind: "pass" };
}
