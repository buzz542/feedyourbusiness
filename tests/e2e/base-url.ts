/**
 * E2E runs against localhost only (docs/PLAN.md 2.1.6, .claude/rules/testing.md). Playwright is a dev
 * dependency for our own app; it must never drive a deployed site or a third-party one.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function assertLocalBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`E2E base URL must be localhost; got an invalid URL`);
  }
  const ok =
    (url.protocol === "http:" || url.protocol === "https:") &&
    LOCAL_HOSTS.has(url.hostname) &&
    url.username === "" &&
    url.password === "";
  if (!ok) throw new Error(`E2E base URL must be localhost; got ${url.host || raw}`);
  return url.origin;
}
