/**
 * E2E runs on localhost only (docs/PLAN.md 2.1.6, section 0): Playwright never drives a deployment
 * or any third-party site. Returns the origin, or throws.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function assertLocalBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`E2E base URL must be a localhost URL, got ${JSON.stringify(raw)}`);
  }
  const okScheme = url.protocol === "http:" || url.protocol === "https:";
  if (!okScheme || url.username || url.password || !LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(`E2E base URL must be a localhost URL, got ${JSON.stringify(raw)}`);
  }
  return url.origin;
}

export const isLocalUrl = (raw: string): boolean => {
  try {
    assertLocalBaseUrl(raw);
    return true;
  } catch {
    return false;
  }
};
