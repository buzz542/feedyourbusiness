/**
 * Why fetchOwnSite() refused or failed (docs/PLAN.md 12.3). Kept apart from own-site.ts, which only
 * onboarding and the preview may import, so callers and fakes can name the error without being able
 * to fetch anything.
 */

export type OwnSiteErrorCode =
  | "invalid_url"
  | "insecure_scheme"
  | "non_default_port"
  | "credentials_in_url"
  | "platform_host"
  | "private_address"
  | "redirect_off_site"
  | "too_many_redirects"
  | "too_large"
  | "unsupported_type"
  | "http_error"
  | "timeout"
  | "network";

export class OwnSiteError extends Error {
  constructor(readonly code: OwnSiteErrorCode) {
    super(`Could not fetch the site: ${code}`);
    this.name = "OwnSiteError";
  }
}
