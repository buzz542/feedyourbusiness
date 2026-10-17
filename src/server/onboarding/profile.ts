import { z } from "zod";
import { isProfileCommunity, isSensitiveCommunity } from "@/sources/sensitive-communities";
import { normalizeDomain, type TermIntent } from "./draft";

/**
 * The onboarding review step (docs/PLAN.md 4.3, step 4 and 5): every field of the draft is editable
 * (terms as chips, at most 40; competitors with an optional domain and aliases; the relevance
 * threshold), then the user confirms. Input comes from the browser, so it is parsed here with a
 * message for each field a person can fix.
 */

export const MAX_TERMS = 40;
export const MAX_COMPETITORS = 20;
export const MAX_SUBREDDITS = 10;
export const MAX_ALIASES = 10;

export interface Profile {
  name: string;
  one_liner: string;
  description: string;
  audience: string;
  relevance_threshold: number;
  terms: { term: string; intent: TermIntent }[];
  /** `id` null for a competitor added in this edit. */
  competitors: { id: string | null; name: string; domain: string | null; aliases: string[] }[];
  subreddits: string[];
}

export type ProfileErrors = Record<string, string>;
export type ParsedProfile = { ok: true; profile: Profile } | { ok: false; errors: ProfileErrors };

export interface ProfileStore {
  save(productId: string, profile: Profile): Promise<void>;
  /** Draft to active with confirmed_at, or "refused" (not a draft, or no active term). */
  confirm(productId: string): Promise<"confirmed" | "refused">;
}

/** The shape only; the field rules and their messages follow in parseProfile(). */
const Shape = z.object({
  name: z.string().max(500),
  one_liner: z.string().max(1_000),
  description: z.string().max(10_000),
  audience: z.string().max(5_000),
  relevance_threshold: z.number(),
  terms: z
    .array(
      z.object({
        term: z.string().max(500),
        intent: z.enum(["problem", "category", "alternative", "competitor"]),
      }),
    )
    .max(200),
  competitors: z
    .array(
      z.object({
        id: z.uuid().nullable(),
        name: z.string().max(500),
        domain: z.string().max(500).nullable(),
        aliases: z.array(z.string().max(500)).max(50),
      }),
    )
    .max(100),
  subreddits: z.array(z.string().max(100)).max(50),
});

const squash = (text: string) => text.replace(/\s+/g, " ").trim();
const SUBREDDIT = /^[A-Za-z0-9_]{2,21}$/;
const MISSING = "Something was missing. Reload the page and try again.";

export function parseProfile(raw: unknown): ParsedProfile {
  const shape = Shape.safeParse(raw);
  if (!shape.success) return { ok: false, errors: { form: MISSING } };
  const input = shape.data;
  const errors: ProfileErrors = {};

  const name = squash(input.name);
  if (!name) errors.name = "Enter your product's name.";
  else if (name.length > 120) errors.name = "Keep the name to 120 characters.";
  const one_liner = squash(input.one_liner);
  if (one_liner.length > 160) errors.one_liner = "Keep the summary to 160 characters.";
  const description = input.description.trim();
  if (description.length > 2000) errors.description = "Keep the description to 2,000 characters.";
  const audience = input.audience.trim();
  if (audience.length > 1000) errors.audience = "Keep this to 1,000 characters.";

  const threshold = input.relevance_threshold;
  if (!Number.isInteger(threshold) || threshold < 40 || threshold > 95)
    errors.relevance_threshold = "Choose a number from 40 to 95.";

  const terms: Profile["terms"] = [];
  const seenTerms = new Set<string>();
  for (const { term, intent } of input.terms) {
    const t = squash(term);
    if (t.length < 2 || t.length > 60) {
      errors.terms ??= "Each term needs 2 to 60 characters.";
      continue;
    }
    if (seenTerms.has(t.toLowerCase())) {
      errors.terms ??= `You have "${t.toLowerCase()}" twice.`;
      continue;
    }
    seenTerms.add(t.toLowerCase());
    terms.push({ term: t, intent });
  }
  if (input.terms.length > MAX_TERMS) errors.terms = `Keep it to ${MAX_TERMS} terms.`;

  const competitors: Profile["competitors"] = [];
  const seenRivals = new Set<string>();
  input.competitors.forEach((competitor, i) => {
    const n = squash(competitor.name);
    if (!n || n.length > 80) {
      errors[`competitors.${i}.name`] = "Each competitor needs a name of up to 80 characters.";
      return;
    }
    if (seenRivals.has(n.toLowerCase())) {
      errors[`competitors.${i}.name`] = `You have "${n.toLowerCase()}" twice.`;
      return;
    }
    seenRivals.add(n.toLowerCase());
    const rawDomain = competitor.domain?.trim() ?? "";
    const domain = rawDomain ? normalizeDomain(rawDomain) : null;
    if (rawDomain && !domain)
      errors[`competitors.${i}.domain`] = "Enter a domain like example.com, or leave it empty.";
    const aliases = [
      ...new Set(competitor.aliases.map(squash).filter((alias) => alias.length > 0)),
    ];
    if (aliases.length > MAX_ALIASES || aliases.some((alias) => alias.length > 80))
      errors[`competitors.${i}.aliases`] =
        `Up to ${MAX_ALIASES} other names, each up to 80 characters.`;
    competitors.push({ id: competitor.id, name: n, domain, aliases });
  });
  if (input.competitors.length > MAX_COMPETITORS)
    errors.competitors = `Keep it to ${MAX_COMPETITORS} competitors.`;

  const subreddits: string[] = [];
  const seenSubs = new Set<string>();
  for (const sub of input.subreddits) {
    const s = sub.trim().replace(/^\/?r\//i, "");
    if (!s || seenSubs.has(s.toLowerCase())) continue;
    if (isProfileCommunity(s)) {
      errors.subreddits ??= `r/${s} is a person's profile, not a community.`;
      continue;
    }
    if (!SUBREDDIT.test(s)) {
      errors.subreddits ??= `r/${s} is not a subreddit name.`;
      continue;
    }
    if (isSensitiveCommunity(s)) {
      errors.subreddits ??=
        "AskedFor does not search communities about health, sexuality, religion, politics, " +
        `ethnicity or similar topics, so r/${s} is left out.`;
      continue;
    }
    seenSubs.add(s.toLowerCase());
    subreddits.push(s);
  }
  if (subreddits.length > MAX_SUBREDDITS)
    errors.subreddits = `Keep it to ${MAX_SUBREDDITS} subreddits.`;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    profile: {
      name,
      one_liner,
      description,
      audience,
      relevance_threshold: threshold,
      terms,
      competitors,
      subreddits,
    },
  };
}

export type ProfileResult = { ok: true } | { ok: false; errors: ProfileErrors };

/** Step 4: save the edits. The product id comes from the signed-in user's state, never the form. */
export async function saveProfile(
  productId: string,
  raw: unknown,
  deps: { store: ProfileStore },
): Promise<ProfileResult> {
  const parsed = parseProfile(raw);
  if (!parsed.ok) return parsed;
  await deps.store.save(productId, parsed.profile);
  return { ok: true };
}

/** Step 5: save the edits, then make the product active with confirmed_at. */
export async function confirmProfile(
  productId: string,
  raw: unknown,
  deps: {
    store: ProfileStore;
    /** Records product_confirmed (its props are these counts). */
    onConfirmed: (counts: { terms: number; competitors: number }) => Promise<void>;
  },
): Promise<ProfileResult> {
  const parsed = parseProfile(raw);
  if (!parsed.ok) return parsed;
  if (parsed.profile.terms.length === 0)
    return { ok: false, errors: { terms: "Add at least one search term." } };
  await deps.store.save(productId, parsed.profile);
  if ((await deps.store.confirm(productId)) === "refused")
    return {
      ok: false,
      errors: { form: "This product could not be confirmed. Reload the page and try again." },
    };
  await deps.onConfirmed({
    terms: parsed.profile.terms.length,
    competitors: parsed.profile.competitors.length,
  });
  return { ok: true };
}
