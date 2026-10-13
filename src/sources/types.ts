/**
 * Source module contract (docs/BRIEF.md, "Source module contract").
 *
 * Every source is a module in src/sources/<id>.ts that exports one of these. The registry is the
 * only allowlist. Anything that would be fetched must go through safeFetch(), which refuses any
 * host outside the union of `allowedHosts` of enabled collect sources.
 */

export type SourceMode = "collect" | "link";

interface SourceBase {
  /** Lowercase letters, digits and underscores. Drives the kill switch SOURCE_<ID>_ENABLED. */
  readonly id: string;
  readonly displayName: string;
  readonly mode: SourceMode;
  /** The terms we rely on for this source. Re-read in launch week. */
  readonly termsUrl: string;
  /** Hosts safeFetch may call for this source. Empty for link sources: nothing is fetched. */
  readonly allowedHosts: readonly string[];
  /** Max reads per product per day. Zero for link sources. */
  readonly dailyBudget: number;
}

export interface CollectedPost {
  externalId: string;
  url: string;
  excerpt: string;
  postedAt: Date;
  authorHandle: string;
}

export interface CollectContext {
  /** The only way a collect module may reach the network. */
  fetch: (input: string | URL, init?: RequestInit) => Promise<Response>;
  terms: readonly string[];
  since: Date;
  /** Remaining reads for this product, source and day. Modules must stop at zero. */
  budget: number;
}

export interface CollectSource extends SourceBase {
  readonly mode: "collect";
  collect(ctx: CollectContext): Promise<CollectedPost[]>;
}

export interface SearchLink {
  term: string;
  url: string;
}

export interface LinkSource extends SourceBase {
  readonly mode: "link";
  readonly allowedHosts: readonly [];
  readonly dailyBudget: 0;
  /** Hosts that appear in generated links. The user opens these in their own browser. */
  readonly linkHosts: readonly string[];
  searchLinks(terms: readonly string[]): SearchLink[];
}

export type Source = CollectSource | LinkSource;
