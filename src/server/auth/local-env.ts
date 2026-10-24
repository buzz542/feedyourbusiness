/**
 * True on a developer's own machine: not on Vercel, and the site URL is localhost. Test-only
 * shortcuts (the E2E sign-in helper's token-hash link) are allowed only here.
 */
export function isLocalDevServer(env: Readonly<Record<string, string | undefined>>): boolean {
  if (env.VERCEL_ENV) return false;
  try {
    const host = new URL(env.NEXT_PUBLIC_SITE_URL ?? "").hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  } catch {
    return false;
  }
}
