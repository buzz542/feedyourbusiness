/**
 * The `next` parameter after sign-in (docs/PLAN.md 12.1). Only a relative path on this site that
 * starts with exactly one slash is kept; anything else falls back, so a crafted sign-in link can
 * never send someone to another site (open redirect).
 */
const MAX_LENGTH = 2048;
const BASE = new URL("https://localhost");

/**
 * True if `path`, or any of up to three decodings of it, starts with two slashes or a slash and a
 * backslash, or holds a control character: the encoded forms of a protocol-relative URL.
 */
function looksOffSite(path: string): boolean {
  let current = path;
  for (let i = 0; i <= 3; i++) {
    if (/^\/[/\\]/.test(current) || /[\u0000-\u001f\u007f]/.test(current)) return true;
    let next: string;
    try {
      next = decodeURIComponent(current);
    } catch {
      return true;
    }
    if (next === current) return false;
    current = next;
  }
  return true;
}

export function safeNextPath(raw: string | null | undefined, fallback = "/app"): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_LENGTH) return fallback;
  // Whitespace and control characters are stripped by URL parsers ("/\t/evil" becomes "//evil"),
  // and browsers treat a backslash like a slash.
  if (/[\u0000- \u007f\\]/.test(raw)) return fallback;
  if (!raw.startsWith("/") || looksOffSite(raw)) return fallback;

  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== BASE.origin) return fallback;
  // Dot segments normalize away ("/.//evil.example" becomes "//evil.example"), so the normalized
  // path gets the same checks as the raw one.
  if (looksOffSite(url.pathname)) return fallback;
  const path = `${url.pathname}${url.search}${url.hash}`;
  return path === "/" ? fallback : path;
}
