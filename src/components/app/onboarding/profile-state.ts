import type { TermIntent } from "@/server/onboarding/draft";
import { isProfileCommunity, isSensitiveCommunity } from "@/sources/sensitive-communities";

/**
 * State for the onboarding review form (docs/PLAN.md 4.3, step 4). Pure: the form dispatches these
 * actions, and the server parses the result again before saving (src/server/onboarding/profile.ts).
 */

export const MAX_TERMS = 40;
export const MAX_SUBREDDITS = 10;

/** The saved draft as the page loads it. */
export interface DraftView {
  name: string;
  one_liner: string;
  description: string;
  audience: string;
  relevance_threshold: number;
  subreddits: string[];
  terms: { term: string; intent: TermIntent }[];
  competitors: { id: string; name: string; domain: string | null; aliases: string[] }[];
}

export interface EditableCompetitor {
  /** Stable React key; `id` is null until the competitor is saved. */
  key: string;
  id: string | null;
  name: string;
  domain: string;
  /** Other names, comma separated, as typed. */
  aliases: string;
}

export interface EditableProfile {
  name: string;
  one_liner: string;
  description: string;
  audience: string;
  relevance_threshold: number;
  terms: { term: string; intent: TermIntent }[];
  competitors: EditableCompetitor[];
  subreddits: string[];
  /** Counter for new competitor keys. */
  nextKey: number;
}

export type TextField = "name" | "one_liner" | "description" | "audience";

export type ProfileAction =
  | { type: "field"; field: TextField; value: string }
  | { type: "threshold"; value: number }
  | { type: "addTerm"; term: string }
  | { type: "removeTerm"; index: number }
  | { type: "addCompetitor" }
  | {
      type: "editCompetitor";
      key: string;
      patch: Partial<Pick<EditableCompetitor, "name" | "domain" | "aliases">>;
    }
  | { type: "removeCompetitor"; key: string }
  | { type: "addSubreddit"; name: string }
  | { type: "removeSubreddit"; index: number };

const squash = (text: string) => text.replace(/\s+/g, " ").trim();
const subredditName = (text: string) => text.trim().replace(/^\/?r\//i, "");

export function fromDraft(draft: DraftView): EditableProfile {
  return {
    name: draft.name,
    one_liner: draft.one_liner,
    description: draft.description,
    audience: draft.audience,
    relevance_threshold: draft.relevance_threshold,
    terms: draft.terms.map((t) => ({ ...t })),
    competitors: draft.competitors.map((c) => ({
      key: c.id,
      id: c.id,
      name: c.name,
      domain: c.domain ?? "",
      aliases: c.aliases.join(", "),
    })),
    subreddits: [...draft.subreddits],
    nextKey: 1,
  };
}

export function profileReducer(state: EditableProfile, action: ProfileAction): EditableProfile {
  switch (action.type) {
    case "field":
      return { ...state, [action.field]: action.value };
    case "threshold":
      return { ...state, relevance_threshold: action.value };
    case "addTerm":
      return {
        ...state,
        terms: [...state.terms, { term: squash(action.term), intent: "problem" }],
      };
    case "removeTerm":
      return { ...state, terms: state.terms.filter((_, i) => i !== action.index) };
    case "addCompetitor":
      return {
        ...state,
        nextKey: state.nextKey + 1,
        competitors: [
          ...state.competitors,
          { key: `new-${state.nextKey}`, id: null, name: "", domain: "", aliases: "" },
        ],
      };
    case "editCompetitor":
      return {
        ...state,
        competitors: state.competitors.map((c) =>
          c.key === action.key ? { ...c, ...action.patch } : c,
        ),
      };
    case "removeCompetitor":
      return { ...state, competitors: state.competitors.filter((c) => c.key !== action.key) };
    case "addSubreddit":
      return { ...state, subreddits: [...state.subreddits, subredditName(action.name)] };
    case "removeSubreddit":
      return { ...state, subreddits: state.subreddits.filter((_, i) => i !== action.index) };
  }
}

/** Why a term cannot be added, or null. */
export function termProblem(terms: EditableProfile["terms"], text: string): string | null {
  const term = squash(text);
  if (terms.length >= MAX_TERMS) return `You can keep up to ${MAX_TERMS} terms. Remove one first.`;
  if (term.length < 2 || term.length > 60) return "Each term needs 2 to 60 characters.";
  if (terms.some((t) => t.term.toLowerCase() === term.toLowerCase()))
    return "That term is already in the list.";
  return null;
}

/** Why a subreddit cannot be added, or null. */
export function subredditProblem(subreddits: string[], text: string): string | null {
  const name = subredditName(text);
  if (subreddits.length >= MAX_SUBREDDITS)
    return `You can keep up to ${MAX_SUBREDDITS} subreddits. Remove one first.`;
  if (isProfileCommunity(name)) return "That is a person's profile, not a community.";
  if (!/^[A-Za-z0-9_]{2,21}$/.test(name)) return "Use the subreddit's name, like SaaS.";
  if (subreddits.some((s) => s.toLowerCase() === name.toLowerCase()))
    return "That subreddit is already in the list.";
  if (isSensitiveCommunity(name))
    return "AskedFor does not search communities about health, sexuality, religion, politics, ethnicity or similar topics.";
  return null;
}

/** The payload the save and confirm actions parse. */
export function toProfileInput(state: EditableProfile) {
  return {
    name: state.name,
    one_liner: state.one_liner,
    description: state.description,
    audience: state.audience,
    relevance_threshold: state.relevance_threshold,
    subreddits: state.subreddits,
    terms: state.terms,
    competitors: state.competitors.map((c) => ({
      id: c.id,
      name: c.name,
      domain: c.domain.trim() ? c.domain.trim() : null,
      aliases: c.aliases
        .split(",")
        .map((alias) => alias.trim())
        .filter(Boolean),
    })),
  };
}
