/**
 * Source module contract v2 (docs/PLAN.md 7.1).
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
  /** Hosts that appear in stored or generated links. Never fetched (safeFetch refuses them). */
  readonly linkHosts: readonly string[];
  /** Max reads per product per day. Zero for link sources. */
  readonly dailyBudget: number;
}

/** One post as a source returns it (docs/PLAN.md 7.1). Reduced to these fields at the boundary. */
export interface CollectedPost {
  externalId: string;
  url: string;
  /** At most 280 characters, plain text. */
  excerpt: string;
  postedAt: Date;
  /** The platform's author id. Hashed by the pipeline at once; never stored, logged or returned. */
  authorKey: string;
  /** "r/SaaS", "Hacker News", "Bluesky", "X". */
  community: string | null;
  /** The search term that found it, when the source can tell. */
  termId: string | null;
  nsfw: boolean;
}

export interface CollectTerm {
  id: string;
  term: string;
}

export interface CollectContext {
  /** The only way a collect module may reach the network: safeFetch bound to its own hosts. */
  fetch: (
    input: string | URL,
    init?: Omit<RequestInit, "redirect" | "signal">,
  ) => Promise<Response>;
  terms: readonly CollectTerm[];
  /** Only posts newer than this (48 hours for daily runs, 7 days for the first run). */
  since: Date;
  /** Units this run may use (reserved with consume_budget). Modules stop at it. */
  budget: number;
  now: Date;
  /** Descriptive, with a monitored contact (docs/PLAN.md 7.4): send it on every request. */
  userAgent: string;
  /** For polite pacing and backing off on 429. Tests pass a fake. */
  sleep(ms: number): Promise<void>;
  /** A secret this source needs (BLUESKY_APP_PASSWORD...), read on the server; never logged. */
  credential(name: string): string | undefined;
}

export type RunState =
  | { kind: "done"; posts: CollectedPost[]; units: number }
  | { kind: "pending"; handle: string }
  | { kind: "failed"; errorClass: string };

/**
 * A vendor source's one-time deletion re-check (docs/PLAN.md 2.3.6, 7.7): stored links re-collected
 * through the same pinned dataset; anything not reported live is deleted here.
 */
export interface Recheck {
  enabled(ctx: CollectContext): boolean;
  start(
    ctx: CollectContext,
    urls: readonly string[],
  ): Promise<{ kind: "pending"; handle: string } | { kind: "failed"; errorClass: string }>;
  poll(
    ctx: CollectContext,
    handle: string,
  ): Promise<
    | { kind: "pending" }
    | { kind: "done"; live: string[]; units: number }
    | { kind: "failed"; errorClass: string }
  >;
}

export interface CollectSource extends SourceBase {
  readonly mode: "collect";
  readonly access: "official_api" | "vendor_api";
  /**
   * Required when access is vendor_api: who collects for us, their DPA, and the env var that holds
   * the date the DPA, transfer mechanism and DPIA were done (docs/PLAN.md 2.1.7). Deployments keep
   * the source off until it holds a date.
   */
  readonly vendor?: {
    readonly name: string;
    readonly dpaUrl: string;
    readonly dpaSignedOnEnv: string;
  };
  /** D4: 7 for reddit and x, 30 for the rest. */
  readonly retentionDays: 7 | 30;
  /** 0 for free APIs. */
  readonly costPerUnitUsd: number;
  /**
   * The env names ctx.credential may read for this source, each starting with the source's id or
   * its vendor's name ("BLUESKY_", "BRIGHTDATA_"). Any other name reads as unset.
   */
  readonly credentials: readonly string[];
  /** The credentials it cannot run without (a subset of `credentials`), for /api/health. */
  readonly requiredCredentials?: readonly string[];
  /** What would stop it starting with this configuration, by env name only (never a value). */
  configProblems?(read: (name: string) => string | undefined): string[];
  /** Free APIs finish at once; vendors return a handle to poll. */
  start(ctx: CollectContext): Promise<RunState>;
  poll?(ctx: CollectContext, handle: string): Promise<RunState>;
  /** Deletion sync: the external ids that no longer exist at the source. */
  checkDeleted?(ctx: CollectContext, externalIds: readonly string[]): Promise<string[]>;
  /** Deletion re-check for a vendor source that cannot answer checkDeleted at once. */
  readonly recheck?: Recheck;
}

export interface SearchLink {
  term: string;
  url: string;
}

export interface LinkSource extends SourceBase {
  readonly mode: "link";
  readonly allowedHosts: readonly [];
  readonly dailyBudget: 0;
  searchLinks(terms: readonly string[]): SearchLink[];
}

export type Source = CollectSource | LinkSource;
