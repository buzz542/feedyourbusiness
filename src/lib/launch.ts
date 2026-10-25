import type { MetadataRoute } from "next";

/**
 * The launch switch (docs/PLAN.md 12.10, M9). Before launch the site is out of search results and
 * only SIGNUP_ALLOWLIST may sign in or be collected for. PUBLIC_LAUNCH=true flips all three
 * together, so they can never disagree. It is the founder's switch: set it in Vercel and redeploy.
 */
type Env = Readonly<Record<string, string | undefined>>;

export function isLaunched(env: Env = process.env): boolean {
  return env.PUBLIC_LAUNCH === "true";
}

/** The robots meta tag for every page. */
export function siteRobots(env: Env = process.env): { index: boolean; follow: boolean } {
  return isLaunched(env) ? { index: true, follow: true } : { index: false, follow: false };
}

/** robots.txt. */
export function robotsTxt(env: Env = process.env): MetadataRoute.Robots {
  return isLaunched(env)
    ? { rules: { userAgent: "*", allow: "/", disallow: ["/app", "/admin", "/api", "/auth"] } }
    : { rules: { userAgent: "*", disallow: "/" } };
}
