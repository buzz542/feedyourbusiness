import { isProfileCommunity, isSensitiveCommunity } from "@/sources/sensitive-communities";
import { isProductLabel, tidy } from "./labels";

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

export function parseEdits(form: FormData): ParsedEdits {
  const errors: Partial<Record<EditField, string>> = {};

  const name = tidy(text(form, "name"));
  if (!isProductLabel(name, 120))
    errors.name = "Give your product a name, without links or handles.";
  const one_liner = tidy(text(form, "one_liner"));
  if (one_liner.length > 160) errors.one_liner = "Keep the summary to 160 characters.";
  const description = tidy(text(form, "description"));
  if (description.length > 2000) errors.description = "Keep the description to 2,000 characters.";
  const audience = tidy(text(form, "audience"));
  if (audience.length > 1000) errors.audience = "Keep the audience to 1,000 characters.";

  const threshold = Number(text(form, "relevance_threshold"));
  if (!Number.isInteger(threshold) || threshold < 40 || threshold > 95)
    errors.relevance_threshold = "Pick a match threshold from 40 to 95.";

  const terms = lines(text(form, "terms"));
  if (terms.length > MAX_TERMS) errors.terms = `Keep it to ${MAX_TERMS} search terms.`;
  else if (terms.some((t) => t.length < 2 || !isProductLabel(t, 120)))
    errors.terms = "Search terms are phrases people write, without handles, emails or links.";

  const competitors: Edits["competitors"] = [];
  for (const line of lines(text(form, "competitors"))) {
    const [rawName = "", rawDomain = ""] = line.split(",").map((part) => part.trim());
    const domain = rawDomain.toLowerCase().replace(/^www\./, "") || null;
    if (!isProductLabel(rawName, 80) || (domain !== null && !DOMAIN.test(domain))) {
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

/** What the draft holds now, to diff against. */
export interface ReviewSnapshot {
  terms: { id: string; term: string }[];
  competitors: { id: string; name: string; domain: string | null }[];
}

/** Writes through the signed-in user's client, so RLS and column grants apply. */
export interface ReviewStore {
  updateProfile(profile: ProfileEdits): Promise<void>;
  addTerms(terms: string[]): Promise<void>;
  removeTerms(ids: string[]): Promise<void>;
  addCompetitors(competitors: { name: string; domain: string | null }[]): Promise<void>;
  updateCompetitorDomain(id: string, domain: string | null): Promise<void>;
  removeCompetitors(ids: string[]): Promise<void>;
}

/** Only what changed: removals first, so the caps (40 terms, 20 competitors) never block a swap. */
export async function applyEdits(
  store: ReviewStore,
  current: ReviewSnapshot,
  edits: Edits,
): Promise<void> {
  await store.updateProfile(edits.profile);

  const wanted = new Set(edits.terms.map((t) => t.toLowerCase()));
  const have = new Set(current.terms.map((t) => t.term.toLowerCase()));
  const goneTerms = current.terms.filter((t) => !wanted.has(t.term.toLowerCase()));
  const newTerms = edits.terms.filter((t) => !have.has(t.toLowerCase()));
  if (goneTerms.length) await store.removeTerms(goneTerms.map((t) => t.id));
  if (newTerms.length) await store.addTerms(newTerms);

  const byName = new Map(current.competitors.map((c) => [c.name.toLowerCase(), c]));
  const keep = new Set(edits.competitors.map((c) => c.name.toLowerCase()));
  const goneRivals = current.competitors.filter((c) => !keep.has(c.name.toLowerCase()));
  if (goneRivals.length) await store.removeCompetitors(goneRivals.map((c) => c.id));
  const added: Edits["competitors"] = [];
  for (const c of edits.competitors) {
    const existing = byName.get(c.name.toLowerCase());
    if (!existing) added.push(c);
    else if (existing.domain !== c.domain)
      await store.updateCompetitorDomain(existing.id, c.domain);
  }
  if (added.length) await store.addCompetitors(added);
}
