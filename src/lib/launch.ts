/**
 * The launch switch (docs/PLAN.md 12.10, M9). Until the founder opens the site, sign-in is limited to
 * SIGNUP_ALLOWLIST, search engines are kept out (robots.txt and the noindex tag) and the pages say
 * the site is in private beta. LAUNCH_OPEN=true, set in Vercel and redeployed, changes all of them
 * together. One variable, so the three can never disagree.
 */

type Env = Readonly<Record<string, string | undefined>>;

export const isLaunchOpen = (env: Env = process.env): boolean => env.LAUNCH_OPEN === "true";

/** The `robots` metadata tag: noindex until the launch switch is on. */
export const robotsMeta = (env: Env = process.env): { index: boolean; follow: boolean } =>
  isLaunchOpen(env) ? { index: true, follow: true } : { index: false, follow: false };
