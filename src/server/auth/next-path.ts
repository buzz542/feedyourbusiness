/**
 * Where to send someone after sign-in (docs/PLAN.md 12.1). Only a path inside the signed-in app
 * is kept; anything that could leave the site (protocol-relative, backslash, encoded forms, other
 * schemes) or point elsewhere on it falls back to `/app`.
 */

/** A base with no host: parsing resolves dot segments without naming any network host. */
const BASE = "app:/";
const APP_ROOTS = ["/app", "/admin"] as const;
const MAX_LENGTH = 512;

export const DEFAULT_NEXT_PATH = "/app";

export function safeNextPath(raw: string | null | undefined): string {
  const fallback = DEFAULT_NEXT_PATH;
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_LENGTH) return fallback;
  // Printable ASCII only: no spaces, tabs, newlines or control characters. No backslashes at all,
  // since browsers read "/\host" as "//host".
  if (!/^[\x21-\x7e]+$/.test(raw) || raw.includes("\\")) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//")) return fallback;

  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return fallback;
  }
  if (decoded.startsWith("//") || decoded.includes("\\")) return fallback;

  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return fallback;
  }
  if (url.protocol !== "app:" || url.host !== "") return fallback;
  const path = url.pathname;
  if (!APP_ROOTS.some((root) => path === root || path.startsWith(`${root}/`))) return fallback;
  return `${path}${url.search}${url.hash}`;
}
