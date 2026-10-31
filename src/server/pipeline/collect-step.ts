import { charLength } from "@/lib/highlight-range";
import { LlmCapError, LlmRefusalError, type SpendCap } from "@/server/llm/llm";
import { hasPersonOrLink } from "@/server/onboarding/labels";
import type { AuthorHasher } from "@/server/privacy/author-hash";
import { normalizeAuthorKey } from "@/server/privacy/author-hash";
import type { CollectedPost, CollectSource, CollectTerm } from "@/sources/types";
import type { Job } from "./ports";

/**
 * The collect step, docs/PLAN.md 7.3 steps 5 to 9, for one batch of posts from one source for one
 * product: drop what must never reach the model, hash authors at once, drop suppressed authors,
 * skip posts this product already has, classify the rest 20 at a time, store and link the relevant
 * ones, and add the per-term counts. Every part is safe to repeat: a job that runs again skips
 * what it already linked, and its term counts are added once.
 */

/** The rival issues (docs/PLAN.md 8.2); the classification schema (M4) uses the same list. */
export type Issue =
  | "pricing"
  | "reliability"
  | "missing_feature"
  | "support"
  | "usability"
  | "performance"
  | "integration"
  | "other";

export type Category =
  "looking_for_tool" | "pain_point" | "mentions_you" | "mentions_competitor" | "wish";

/** What the model sees for one post: an opaque id, never the author or the link (8.2). */
export interface ClassifyItem {
  id: string;
  source: string;
  community: string | null;
  excerpt: string;
}

/** What a post says about a tool or competitor (docs/PLAN.md 8.2): our paraphrase, never a quote. */
export interface RivalLabel {
  issue: Issue;
  sentiment: "negative" | "mixed" | "positive";
  switching: boolean;
  summary: string;
}

/** Code-point offsets into the excerpt, from an exact match only. */
export interface Highlight {
  start: number;
  end: number;
}

export interface Label {
  id: string;
  relevance: number;
  category: Category | "not_relevant";
  reason: string;
  highlight: Highlight | null;
  toolMentioned: string | null;
  competitorId: string | null;
  rival: RivalLabel | null;
}

/** The classification port; M4's Haiku classifier implements it (docs/PLAN.md 8.2). */
export interface Classifier {
  /** At most BATCH_SIZE items a call. */
  classify(productId: string, items: readonly ClassifyItem[]): Promise<Label[]>;
}

export interface StoredPost {
  source: string;
  externalId: string;
  url: string;
  excerpt: string;
  postedAt: Date;
  authorHash: string;
  community: string | null;
}

export interface PostLabel {
  relevance: number;
  category: Category;
  reason: string;
  highlight: Highlight | null;
  toolMentioned: string | null;
  competitorId: string | null;
  rival: RivalLabel | null;
  /** The search term that found the post, for the per-term view. */
  termId: string | null;
}

export interface TermStat {
  termId: string;
  fetched: number;
  relevant: number;
}

export interface CollectStore {
  /** The hashes on the suppression list for this source (the cheap pre-check before the model). */
  suppressed(source: string, hashes: readonly string[]): Promise<Set<string>>;
  /** External ids from this source already linked to the product. */
  linked(productId: string, source: string, externalIds: readonly string[]): Promise<Set<string>>;
  /** ingest_post: the stored id (new or existing), or null when the author is suppressed. */
  ingest(post: StoredPost, now: Date): Promise<string | null>;
  /** product_posts, on conflict do nothing. */
  link(productId: string, postId: string, label: PostLabel): Promise<void>;
  /** record_term_stats: added once per job. */
  recordTermStats(jobId: string, day: string, source: string, stats: TermStat[]): Promise<void>;
}

export const BATCH_SIZE = 20;
/** Posts rated below this are discarded (docs/PLAN.md 2.3.2). */
export const MIN_RELEVANCE = 40;
const MAX_EXCERPT = 280;
const MAX_REASON = 200;
const MAX_TOOL = 60;
const MAX_SUMMARY = 200;
/** Author keys that name nobody: hashing them would give every such post one shared author. */
const PLACEHOLDER_AUTHORS = new Set(["", "[deleted]", "[removed]", "deleted", "removed"]);

type Hashed = Omit<CollectedPost, "authorKey"> & { authorHash: string };

/** The classifier checks its labels; this keeps what reaches the database inside its constraints. */
function toPostLabel(label: Label, category: Category, post: Hashed): PostLabel {
  const h = label.highlight;
  const highlight =
    h &&
    Number.isInteger(h.start) &&
    Number.isInteger(h.end) &&
    h.start >= 0 &&
    h.end > h.start &&
    h.end <= charLength(post.excerpt)
      ? { start: h.start, end: h.end }
      : null;
  // A product or company, never a person (8.2, D5): a handle, an email or a link is dropped here
  // too, whatever the classifier let through, and so is a blank value.
  const tool = label.toolMentioned?.trim().slice(0, MAX_TOOL) ?? "";
  const toolMentioned = tool && !hasPersonOrLink(tool) ? tool : null;
  const rival =
    label.rival && (toolMentioned || label.competitorId)
      ? { ...label.rival, summary: label.rival.summary.slice(0, MAX_SUMMARY) }
      : null;
  return {
    relevance: label.relevance,
    category,
    reason: label.reason.slice(0, MAX_REASON),
    highlight,
    toolMentioned,
    competitorId: label.competitorId,
    rival,
    termId: post.termId,
  };
}

function onLinkHost(raw: string, hosts: readonly string[]): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && hosts.includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function createCollectStep(deps: {
  store: CollectStore;
  classifier: Classifier;
  hash: AuthorHasher;
}) {
  const { store, classifier } = deps;

  return async function process(input: {
    job: Job;
    source: CollectSource;
    posts: readonly CollectedPost[];
    now: Date;
    since: Date;
    /** The terms the run asked about: each is counted, found posts or not, so rotation moves on. */
    terms?: readonly CollectTerm[];
  }): Promise<{ stored: number; refused: number; capped?: SpendCap }> {
    const { job, source, now, since } = input;
    const productId = job.productId;
    if (!productId) throw new Error("A collect job needs a product");
    const day =
      typeof job.payload.day === "string" ? job.payload.day : now.toISOString().slice(0, 10);

    // Step 5: everything that must never reach the model or the database, then hash at once.
    const seen = new Set<string>();
    const hashed: Hashed[] = [];
    for (const { authorKey, ...post } of input.posts) {
      if (seen.has(post.externalId)) continue;
      seen.add(post.externalId);
      // An invalid date never passes the window (NaN compares false both ways).
      if (post.nsfw || !(post.postedAt.getTime() > since.getTime())) continue;
      if (!post.excerpt || post.excerpt.length > MAX_EXCERPT) continue;
      if (!onLinkHost(post.url, source.linkHosts)) continue;
      if (PLACEHOLDER_AUTHORS.has(normalizeAuthorKey(authorKey))) continue;
      hashed.push({ ...post, authorHash: deps.hash(source.id, authorKey) });
    }
    const suppressed = await store.suppressed(source.id, [
      ...new Set(hashed.map((p) => p.authorHash)),
    ]);
    const allowed = hashed.filter((p) => !suppressed.has(p.authorHash));

    // Step 6: posts this product already has are skipped; posts stored for another product are not.
    const linked = await store.linked(
      productId,
      source.id,
      allowed.map((p) => p.externalId),
    );
    const todo = allowed.filter((p) => !linked.has(p.externalId));

    // Steps 7 and 8: classify 20 at a time, keep relevant labels for ids we sent, store and link.
    const kept = new Map<string, number>();
    let stored = 0;
    let refused = 0;
    let capped: SpendCap | undefined;
    for (let start = 0; start < todo.length; start += BATCH_SIZE) {
      const batch = todo.slice(start, start + BATCH_SIZE);
      const items: ClassifyItem[] = batch.map((p, i) => ({
        id: String(i),
        source: source.id,
        community: p.community,
        excerpt: p.excerpt,
      }));
      let labels: Label[];
      try {
        labels = await classifier.classify(productId, items);
      } catch (error) {
        // A spend cap stops classification: what is stored stays, the rest waits for a later run.
        if (error instanceof LlmCapError) {
          capped = error.cap;
          break;
        }
        // A refusal skips this batch: nothing is linked, so the next run sends it again.
        if (!(error instanceof LlmRefusalError)) throw error;
        refused++;
        continue;
      }
      const byId = new Map<number, Label>();
      for (const label of labels) {
        const index = /^\d{1,2}$/.test(label.id) ? Number(label.id) : -1;
        if (index >= 0 && index < batch.length && !byId.has(index)) byId.set(index, label);
      }
      for (const [index, label] of byId) {
        if (label.category === "not_relevant") continue;
        if (!Number.isInteger(label.relevance) || label.relevance < MIN_RELEVANCE) continue;
        if (label.relevance > 100) continue;
        const post = batch[index]!;
        const postId = await store.ingest(
          {
            source: source.id,
            externalId: post.externalId,
            url: post.url,
            excerpt: post.excerpt,
            postedAt: post.postedAt,
            authorHash: post.authorHash,
            community: post.community,
          },
          now,
        );
        if (!postId) continue; // suppressed after the pre-check: ingest_post refused it
        await store.link(productId, postId, toPostLabel(label, label.category, post));
        stored++;
        if (post.termId) kept.set(post.termId, (kept.get(post.termId) ?? 0) + 1);
      }
    }

    // Step 9 (the budget is settled by the handler): posts fetched and kept, per term, once per job.
    // A post found twice for the same term counts once.
    const fetched = new Map<string, Set<string>>();
    for (const term of input.terms ?? []) fetched.set(term.id, new Set());
    for (const post of input.posts)
      if (post.termId)
        fetched.set(post.termId, (fetched.get(post.termId) ?? new Set()).add(post.externalId));
    const stats = [...fetched].map(([termId, ids]) => ({
      termId,
      fetched: ids.size,
      relevant: kept.get(termId) ?? 0,
    }));
    if (stats.length > 0) await store.recordTermStats(job.id, day, source.id, stats);
    return { stored, refused, ...(capped ? { capped } : {}) };
  };
}
