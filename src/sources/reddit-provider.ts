import type { CollectContext } from "./types";

/**
 * The Reddit provider port (docs/PLAN.md 7.7). Bright Data is the one implementation
 * (REDDIT_PROVIDER=brightdata); a licensed Reddit feed can replace it later without touching the
 * Reddit source's filters or the pipeline.
 */

export interface RedditQuery {
  keyword: string;
  /** Posts to ask for, 5 to 20 (docs/PLAN.md 7.3 step 2). */
  limit: number;
  /** How far back the window reaches, in hours. */
  windowHours: number;
}

/** One post as a provider returns it, already reduced to the fields the plan maps (7.7). */
export interface RedditRecord {
  postId: string;
  url: string;
  /** The username, or null. Hashed by the pipeline at once; never stored, logged or returned. */
  author: string | null;
  title: string;
  body: string;
  postedAt: string;
  /** The community as the provider names it ("SaaS", "r/SaaS"), or null. */
  community: string | null;
  nsfw: boolean;
  /** The query keyword that found it, when the provider says. */
  keyword: string | null;
}

export type RedditRun =
  | { kind: "pending" }
  | {
      kind: "done";
      records: RedditRecord[];
      /** Records the provider bills for, error records included. */
      units: number;
    };

export interface RedditProvider {
  readonly id: string;
  /** Starts an asynchronous search and returns a handle to collect it with. */
  start(ctx: CollectContext, queries: readonly RedditQuery[]): Promise<string>;
  collect(ctx: CollectContext, handle: string): Promise<RedditRun>;
}
