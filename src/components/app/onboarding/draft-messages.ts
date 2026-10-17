import type { DraftActionResult } from "@/app/(app)/app/onboarding/actions";
import type { OwnSiteErrorCode } from "@/server/net/own-site-error";

/** What the URL step says for each way a draft can fail (docs/PLAN.md 4.3). Pure, unit tested. */

type Failure = Extract<DraftActionResult, { ok: false }>;

const SITE: Readonly<Record<OwnSiteErrorCode, string>> = {
  invalid_url: "that address is not a web page",
  insecure_scheme: "it does not load over https",
  non_default_port: "it uses an unusual port",
  credentials_in_url: "the address contains a password",
  platform_host: "it is a social network or forum page, not your product's own site",
  private_address: "it is not a public website",
  redirect_off_site: "it sends visitors to a different site",
  too_many_redirects: "it redirects too many times",
  too_large: "the page is too large",
  unsupported_type: "it is not a web page",
  http_error: "the site returned an error",
  timeout: "the site took too long to answer",
  network: "we could not connect to it",
};

export interface DraftMessage {
  text: string;
  /** Offer the paste-a-description form instead of the URL form. */
  offerDescription: boolean;
}

export function draftMessage(result: Failure): DraftMessage | null {
  switch (result.reason) {
    case "invalid_url":
      return {
        text: "Enter your product's web address, like example.com.",
        offerDescription: false,
      };
    case "invalid_description":
      return {
        text: "Write at least a sentence about what your product does and who it is for.",
        offerDescription: true,
      };
    case "site_unreachable":
      return {
        text: `We could not read that page: ${SITE[result.siteError ?? "network"]}. Describe your product in a few sentences instead.`,
        offerDescription: true,
      };
    case "declined":
      return {
        text: "We could not draft a profile from that page. Describe your product in a few sentences instead.",
        offerDescription: true,
      };
    case "timeout":
      return {
        text: "Drafting took too long. Try again, or describe your product in a few sentences instead.",
        offerDescription: true,
      };
    case "spend_cap":
      return {
        text: "Drafting is paused for today. Try again tomorrow.",
        offerDescription: false,
      };
    case "unavailable":
      return {
        text: "Drafting is not available yet. Try again later.",
        offerDescription: false,
      };
    case "failed":
      return { text: "Something went wrong while drafting. Try again.", offerDescription: false };
    case "already_confirmed":
      return null;
  }
}
