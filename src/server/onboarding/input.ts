import { checkOwnSiteUrl, OwnSiteError } from "@/server/net/own-site";

/**
 * Onboarding input (docs/PLAN.md 4.3 step 2, 8.3 step 1). The user pastes one thing: their own
 * website, or a sentence or two about the product when there is no site. Nothing here touches the
 * network; it decides what the site reader may fetch.
 *
 *   * Links on a platform (2.1.10), or naming one in their path, are refused.
 *   * Stores, registries, code hosts, review sites, profile sites and profile paths are someone
 *     else's site, full of other people's names, so they are refused too (fetchOwnSite() refuses
 *     them again on every path that reads a site).
 *   * Email addresses and handles point at a person, never at a product, so they are refused.
 *
 * It returns a reason, never wording: the messages live with the onboarding page
 * (src/app/(app)/app/(setup)/onboarding/messages.ts), where the copy gate reads them.
 */

export type ClassifiedInput =
  | { kind: "url"; url: string }
  | { kind: "description"; text: string }
  | { kind: "refused"; reason: RefusalReason };

export type RefusalReason =
  | "platform"
  | "third_party"
  | "profile"
  | "email"
  | "handle"
  | "invalid_url"
  | "too_short"
  | "too_long";

export const MIN_DESCRIPTION = 20;
export const MAX_DESCRIPTION = 1000;

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const BARE_DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}(?::\d+)?(?:[/?#]\S*)?$/i;
const EMAIL = /[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/i;
const HANDLE = /(^|[^a-z0-9_])(@[a-z0-9_]|u\/[a-z0-9_-])/i;

const refuse = (reason: RefusalReason): ClassifiedInput => ({ kind: "refused", reason });

/** A bare domain is read like a scheme-relative link against https. */
const HTTPS_BASE = "https://askedfor.app";

function classifyLink(raw: string): ClassifiedInput {
  // This parses what the user pasted and never fetches it; fetchOwnSite() checks it again.
  let url: URL;
  try {
    url = new URL(SCHEME.test(raw) ? raw : `//${raw}`, HTTPS_BASE);
  } catch {
    return refuse("invalid_url");
  }
  if (url.protocol === "http:") url.protocol = "https:";
  url.search = "";
  url.hash = "";
  try {
    return { kind: "url", url: checkOwnSiteUrl(url).href };
  } catch (error) {
    if (error instanceof OwnSiteError) {
      if (error.code === "platform_host") return refuse("platform");
      if (error.code === "third_party_host") return refuse("third_party");
      if (error.code === "profile_path") return refuse("profile");
    }
    return refuse("invalid_url");
  }
}

/** Nothing longer is read at all, so no check below ever runs on a huge string. */
const MAX_INPUT = 2048;

export function classifyInput(raw: string): ClassifiedInput {
  if (raw.length > MAX_INPUT) return refuse("too_long");
  const trimmed = raw.trim();
  if (!/\s/.test(trimmed) && (SCHEME.test(trimmed) || BARE_DOMAIN.test(trimmed))) {
    return classifyLink(trimmed);
  }
  if (EMAIL.test(trimmed)) return refuse("email");
  if (HANDLE.test(trimmed)) return refuse("handle");
  const text = trimmed.replace(/\s+/g, " ");
  if (text.length < MIN_DESCRIPTION) return refuse("too_short");
  if (text.length > MAX_DESCRIPTION) return refuse("too_long");
  return { kind: "description", text };
}
