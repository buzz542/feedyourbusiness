/**
 * The account export (docs/PLAN.md 4.7, 10.7): everything the user owns, as JSON. Feed items are
 * links with their source, community, age, labels and our own one-line reasons, never post
 * excerpts (2.3.14), so the retention promise holds outside the database too. Every field is
 * copied by name from an allowlist, so a column added later never leaks into an export.
 */

export interface ExportSource {
  email: string | null;
  profile: Record<string, unknown> | null;
  product: Record<string, unknown> | null;
  terms: Array<Record<string, unknown>>;
  competitors: Array<Record<string, unknown>>;
  feed: Array<Record<string, unknown>>;
}

export const PROFILE_FIELDS = [
  "created_at",
  "terms_accepted_at",
  "email_daily",
  "email_weekly",
  "marketing_opt_in",
  "plan",
  "subscription_status",
  "trial_end",
  "current_period_end",
  "cancel_at_period_end",
  "service_consent_at",
] as const;

export const PRODUCT_FIELDS = [
  "name",
  "url",
  "one_liner",
  "description",
  "audience",
  "status",
  "relevance_threshold",
  "subreddits",
  "confirmed_at",
  "created_at",
] as const;

export const TERM_FIELDS = ["term", "intent", "active", "created_at"] as const;
export const COMPETITOR_FIELDS = ["name", "domain", "aliases", "origin", "created_at"] as const;

/** Links and labels only: no excerpt and no highlight, which would point into one. */
export const FEED_FIELDS = [
  "url",
  "source",
  "community",
  "posted_at",
  "created_at",
  "state",
  "relevance",
  "category",
  "reason",
  "tool_mentioned",
  "switching",
  "rival_issue",
  "rival_sentiment",
] as const;

function pick(row: Record<string, unknown> | null, fields: readonly string[]) {
  if (!row) return null;
  return Object.fromEntries(fields.map((f) => [f, row[f] ?? null]));
}

export interface AccountExport {
  exported_at: string;
  about: string;
  account: Record<string, unknown>;
  product: Record<string, unknown> | null;
  search_terms: Array<Record<string, unknown>>;
  competitors: Array<Record<string, unknown>>;
  feed: Array<Record<string, unknown>>;
}

export function buildAccountExport(source: ExportSource, now: Date): AccountExport {
  return {
    exported_at: now.toISOString(),
    about:
      "Your AskedFor data. Feed items are links to public posts with our labels; post text is " +
      "not included.",
    account: { email: source.email, ...pick(source.profile, PROFILE_FIELDS) },
    product: pick(source.product, PRODUCT_FIELDS),
    search_terms: source.terms.map((r) => pick(r, TERM_FIELDS)!),
    competitors: source.competitors.map((r) => pick(r, COMPETITOR_FIELDS)!),
    feed: source.feed.map((r) => pick(r, FEED_FIELDS)!),
  };
}
