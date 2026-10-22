/**
 * The `next` parameter after sign-in (docs/PLAN.md 12.1). Only a path inside the app survives:
 * `/app` or `/admin`, optionally with sub-paths and a query. Anything that could leave the site
 * (`//host`, `/\host`, a scheme, encoded slashes or backslashes, dot segments, control characters)
 * falls back to `/app`.
 */
const FALLBACK = "/app";
const ALLOWED = /^\/(app|admin)(\/[A-Za-z0-9\-._~/]*)?(\?[A-Za-z0-9\-._~=&%+,]*)?$/;

export function safeNextPath(raw: string | null | undefined): string {
  if (!raw) return FALLBACK;
  if (!ALLOWED.test(raw)) return FALLBACK;
  const [pathPart = ""] = raw.split("?");
  if (/(^|\/)\.\.?(\/|$)/.test(pathPart)) return FALLBACK;
  if (/\/\//.test(pathPart)) return FALLBACK;
  return raw;
}
