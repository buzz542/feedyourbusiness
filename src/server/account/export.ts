/**
 * Data export (docs/PLAN.md 4.7, 10.7): everything the user owns, as JSON. Feed items are links,
 * sources, communities, ages, labels and our reasons, never post excerpts (2.3.14). Built field by
 * field, so nothing the loader happens to read (an excerpt, an author hash) can leak into it.
 */

export interface ExportInput {
  account: {
    email: string | null;
    createdAt: string | null;
    termsAcceptedAt: string | null;
    emailDaily: boolean;
    emailWeekly: boolean;
    subscriptionStatus: string | null;
    trialEnd: string | null;
    currentPeriodEnd: string | null;
  };
  product: Record<string, unknown> | null;
  competitors: Record<string, unknown>[];
  terms: Record<string, unknown>[];
  feed: Record<string, unknown>[];
  themes: Record<string, unknown>[];
  rivalInsights: Record<string, unknown>[];
}

const pick = <K extends string>(row: Record<string, unknown>, keys: readonly K[]) =>
  Object.fromEntries(keys.map((k) => [k, row[k] ?? null])) as Record<K, unknown>;

const PRODUCT = [
  "url",
  "name",
  "one_liner",
  "description",
  "audience",
  "status",
  "subreddits",
  "relevance_threshold",
  "confirmed_at",
  "created_at",
] as const;
const COMPETITOR = ["name", "domain", "aliases", "origin", "created_at"] as const;
const TERM = ["term", "intent", "active", "paused", "created_at"] as const;
const FEED = [
  "url",
  "source",
  "community",
  "posted_at",
  "linked_at",
  "category",
  "relevance",
  "reason",
  "state",
] as const;
const THEME = ["week", "kind", "title", "summary", "count", "trend"] as const;
const RIVAL = ["week", "rival", "issue", "complaints", "switching", "trend", "summary"] as const;

export function buildExport(input: ExportInput, now: Date) {
  return {
    exported_at: now.toISOString(),
    note: "Posts appear as links with our labels; their text is not included.",
    account: input.account,
    product: input.product ? pick(input.product, PRODUCT) : null,
    competitors: input.competitors.map((c) => pick(c, COMPETITOR)),
    search_terms: input.terms.map((t) => pick(t, TERM)),
    feed: input.feed.map((f) => pick(f, FEED)),
    themes: input.themes.map((t) => pick(t, THEME)),
    rival_insights: input.rivalInsights.map((r) => pick(r, RIVAL)),
  };
}
