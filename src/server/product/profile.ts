import { cleanDomain } from "@/server/onboarding/draft";
import { parseEdits, type EditField } from "@/server/onboarding/review";

/**
 * The product profile after setup (the founder's redesign brief, 27 Nov 2026). The owner reviews
 * and edits what matching reads: the name, website, one-liner, description, audience, search terms
 * and the minimum match. No field the plan does not already store.
 *
 * The field rules are onboarding's (parseEdits). Terms also keep onboarding's caps
 * (cleanTerms in src/server/onboarding/draft.ts): at most 3 terms that are only a competitor's name
 * and 4 "alternative" phrases, because a brand name alone mostly finds chatter about that brand,
 * not people who need the product.
 */

export const BRAND_TERM_CAP = 3;
export const ALTERNATIVE_TERM_CAP = 4;

export type TermIntent = "problem" | "category" | "alternative" | "competitor";

export interface SavedTerm {
  id: string;
  term: string;
  intent: string;
}

export interface CurrentProfile {
  url: string | null;
  terms: readonly SavedTerm[];
  /** Competitor names, to tell a brand-only term from a problem phrase. */
  competitors: readonly string[];
}

export interface ProfileUpdate {
  name: string;
  url: string | null;
  one_liner: string;
  description: string;
  audience: string;
  relevance_threshold: number;
}

export type ProfileField = Exclude<EditField, "competitors" | "subreddits"> | "url";

export type ProfilePlan =
  | {
      ok: true;
      profile: ProfileUpdate;
      removeTermIds: string[];
      addTerms: { term: string; intent: TermIntent }[];
    }
  | { ok: false; errors: Partial<Record<ProfileField, string>> };

const ALTERNATIVE = /\balternatives?\b/i;

/** A saved term keeps its intent; a new one is a competitor's name, an alternative, or a problem. */
export function intentFor(
  term: string,
  saved: readonly SavedTerm[],
  competitors: readonly string[],
): TermIntent {
  const key = term.trim().toLowerCase();
  const known = saved.find((t) => t.term.toLowerCase() === key)?.intent;
  if (
    known === "problem" ||
    known === "category" ||
    known === "alternative" ||
    known === "competitor"
  )
    return known;
  if (ALTERNATIVE.test(term)) return "alternative";
  if (competitors.some((c) => c.trim().toLowerCase() === key)) return "competitor";
  return "problem";
}

const WEBSITE_ERROR = "Use your product's own https address.";

/** The product's own https address, or an error. Platform and review sites are refused. */
function website(raw: string): { ok: true; url: string } | { ok: false } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false };
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return { ok: false };
  if (url.href.length > 2048 || cleanDomain(url.hostname, null) === null) return { ok: false };
  return { ok: true, url: url.href };
}

export function planProfileSave(form: FormData, current: CurrentProfile): ProfilePlan {
  // Onboarding's rules for every field it has; competitors and communities are not on this page.
  const parsed = parseEdits(form);
  const errors: Partial<Record<ProfileField, string>> = {};
  if (!parsed.ok)
    for (const [key, message] of Object.entries(parsed.errors))
      if (key !== "competitors" && key !== "subreddits")
        errors[key as ProfileField] = message as string;

  const rawUrl = typeof form.get("url") === "string" ? String(form.get("url")).trim() : "";
  let url: string | null = current.url;
  if (rawUrl || current.url !== null) {
    const checked = website(rawUrl);
    if (checked.ok) url = checked.url;
    else errors.url = WEBSITE_ERROR;
  }

  if (!parsed.ok || Object.keys(errors).length > 0) return { ok: false, errors };

  const terms = parsed.edits.terms.map((term) => ({
    term,
    intent: intentFor(term, current.terms, current.competitors),
  }));
  const count = (intent: TermIntent) => terms.filter((t) => t.intent === intent).length;
  if (count("competitor") > BRAND_TERM_CAP)
    errors.terms = `Keep it to ${BRAND_TERM_CAP} terms that are only a competitor's name.`;
  else if (count("alternative") > ALTERNATIVE_TERM_CAP)
    errors.terms = `Keep it to ${ALTERNATIVE_TERM_CAP} "alternative to" terms.`;
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const keep = new Set(terms.map((t) => t.term.toLowerCase()));
  const saved = new Set(current.terms.map((t) => t.term.toLowerCase()));
  const { profile } = parsed.edits;
  return {
    ok: true,
    profile: {
      name: profile.name,
      url,
      one_liner: profile.one_liner,
      description: profile.description,
      audience: profile.audience,
      relevance_threshold: profile.relevance_threshold,
    },
    removeTermIds: current.terms.filter((t) => !keep.has(t.term.toLowerCase())).map((t) => t.id),
    addTerms: terms.filter((t) => !saved.has(t.term.toLowerCase())),
  };
}
