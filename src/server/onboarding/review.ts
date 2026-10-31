import { isProfileCommunity, isSensitiveCommunity } from "@/sources/sensitive-communities";
import { cleanDomain } from "./draft";
import { hasPersonOrLink, isProductLabel, tidy } from "./labels";

/**
 * "Here's what we found" (docs/PLAN.md 4.3 steps 4 and 5). Editing is optional, folded away under
 * "Change something": every field, terms (max 40), competitors (max 20), communities (max 10, the
 * sensitive-community list applies, 2.3.7) and the relevance threshold (40 to 95). The database
 * checks every value again; these checks give the user a message instead of a failed save.
 */

export interface ProfileEdits {
  name: string;
  one_liner: string;
  description: string;
  audience: string;
  relevance_threshold: number;
  subreddits: string[];
}

export interface Edits {
  profile: ProfileEdits;
  terms: string[];
  competitors: { name: string; domain: string | null }[];
}

export type EditField = keyof ProfileEdits | "terms" | "competitors";
export type ParsedEdits =
  { ok: true; edits: Edits } | { ok: false; errors: Partial<Record<EditField, string>> };

const MAX_TERMS = 40;
const MAX_COMPETITORS = 20;
const MAX_SUBREDDITS = 10;
const SUBREDDIT = /^[A-Za-z0-9_]{2,21}$/;
const DOMAIN = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

const text = (form: FormData, key: string): string => {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
};

const lines = (raw: string): string[] => {
  const seen = new Set<string>();
  return raw
    .split(/\r?\n/)
    .map(tidy)
    .filter((line) => {
      const key = line.toLowerCase();
      if (!line || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

export function parseEdits(form: FormData, ownHost: string | null = null): ParsedEdits {
  const errors: Partial<Record<EditField, string>> = {};

  const name = tidy(text(form, "name"));
  if (!isProductLabel(name, 120))
    errors.name = "Give your product a name, without links or handles.";
  // Describe products and groups, never a person (8.3): no handles, emails or links here either.
  const NO_PEOPLE = "Describe the product and who it's for, without handles, emails or links.";
  const one_liner = tidy(text(form, "one_liner"));
  if (one_liner.length > 160) errors.one_liner = "Keep the summary to 160 characters.";
  else if (hasPersonOrLink(one_liner)) errors.one_liner = NO_PEOPLE;
  const description = tidy(text(form, "description"));
  if (description.length > 2000) errors.description = "Keep the description to 2,000 characters.";
  else if (hasPersonOrLink(description)) errors.description = NO_PEOPLE;
  const audience = tidy(text(form, "audience"));
  if (audience.length > 1000) errors.audience = "Keep the audience to 1,000 characters.";
  else if (hasPersonOrLink(audience)) errors.audience = NO_PEOPLE;

  const threshold = Number(text(form, "relevance_threshold"));
  if (!Number.isInteger(threshold) || threshold < 40 || threshold > 95)
    errors.relevance_threshold = "Pick a match threshold from 40 to 95.";

  const terms = lines(text(form, "terms"));
  if (terms.length === 0) errors.terms = "Keep at least one search term.";
  else if (terms.length > MAX_TERMS) errors.terms = `Keep it to ${MAX_TERMS} search terms.`;
  else if (terms.some((t) => t.length < 2 || !isProductLabel(t, 120)))
    errors.terms = "Search terms are phrases people write, without handles, emails or links.";

  const competitors: Edits["competitors"] = [];
  for (const line of lines(text(form, "competitors"))) {
    // "Name, domain": split at the last comma, and only when what follows looks like a domain, so
    // "Acme, Inc." stays one name.
    const cut = line.lastIndexOf(",");
    const tail = cut >= 0 ? line.slice(cut + 1).trim() : "";
    const hasDomain = /^\S+\.\S+$/.test(tail) && !/^(inc|ltd|llc|co|corp)\.?$/i.test(tail);
    const rawName = (hasDomain ? line.slice(0, cut) : line).trim();
    const rawDomain = hasDomain ? tail.replace(/^https?:\/\//i, "").replace(/\/.*$/, "") : "";
    const typed = rawDomain.toLowerCase().replace(/^www\./, "") || null;
    // The draft's rules: no platform, store, review or profile site, never the product's own.
    const domain = typed === null ? null : cleanDomain(typed, ownHost);
    if (typed !== null && domain === null && DOMAIN.test(typed)) {
      errors.competitors = `${typed} is not a competitor's own site. Leave the domain out, or use theirs.`;
      break;
    }
    if (!isProductLabel(rawName, 80) || (typed !== null && domain === null)) {
      errors.competitors =
        "Write one competitor a line: a product name, then a comma and its domain if you like.";
      break;
    }
    if (!competitors.some((c) => c.name.toLowerCase() === rawName.toLowerCase()))
      competitors.push({ name: rawName, domain });
  }
  if (!errors.competitors && competitors.length > MAX_COMPETITORS)
    errors.competitors = `Keep it to ${MAX_COMPETITORS} competitors.`;

  const subreddits: string[] = [];
  for (const raw of text(form, "subreddits").split(/[\s,]+/)) {
    const sub = raw.trim().replace(/^\/?r\//i, "");
    if (!sub) continue;
    if (isProfileCommunity(sub)) {
      errors.subreddits = `r/${sub} is a person's profile, not a community.`;
      break;
    }
    if (!SUBREDDIT.test(sub)) {
      errors.subreddits = `"${sub.slice(0, 30)}" is not a community name.`;
      break;
    }
    if (isSensitiveCommunity(sub)) {
      errors.subreddits = `We don't search r/${sub}: it is about a sensitive topic.`;
      break;
    }
    if (!subreddits.some((s) => s.toLowerCase() === sub.toLowerCase())) subreddits.push(sub);
  }
  if (!errors.subreddits && subreddits.length > MAX_SUBREDDITS)
    errors.subreddits = `Keep it to ${MAX_SUBREDDITS} communities.`;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    edits: {
      profile: {
        name,
        one_liner,
        description,
        audience,
        relevance_threshold: threshold,
        subreddits,
      },
      terms,
      competitors,
    },
  };
}
