import { charLength } from "@/lib/highlight-range";
import type { Llm } from "@/server/llm/llm";
import type { LlmModel } from "@/server/llm/prices";
import { hasPersonOrLink } from "@/server/onboarding/labels";
import {
  BATCH_SIZE,
  MIN_RELEVANCE,
  type Classifier,
  type ClassifyItem,
  type Highlight,
  type Label,
} from "@/server/pipeline/collect-step";
import { CLASSIFY_SYSTEM, productBlock } from "./prompt";
import { Classification, ClassificationAnswer, type ClassificationResult } from "./schema";

/**
 * The Haiku classifier (docs/PLAN.md 8.2) behind the collect step's Classifier port: one call per
 * batch of at most 20 posts, two cached system blocks, posts as a JSON array in the user message,
 * JSON schema output, then post-processing that trusts nothing the model says: ids we did not
 * send are dropped, `not_relevant` and relevance below 40 are discarded, highlights become offsets
 * by exact match only, a tool name with a handle, an email or a link is dropped, a competitor key
 * that is not ours is dropped, and a rival label stays only next to a tool or a competitor.
 *
 * Refusals, spend caps, outages and schema failures surface as the wrapper's errors; the collect
 * step skips, stops or counts them. Nothing here logs a post.
 */

export const CLASSIFY_MODEL: LlmModel = "claude-haiku-5-5";
/** 20 results of a few short fields each, with room for the model's own reasoning at low effort. */
export const CLASSIFY_MAX_TOKENS = 8000;
const MAX_COMPETITORS = 20;
const MAX_REASON = 160;
const MAX_HIGHLIGHT = 140;
const MAX_TOOL = 60;
const MAX_SUMMARY = 200;
const MAX_EXCERPT = 280;

export interface ProductProfile {
  name: string;
  oneLiner: string | null;
  description: string | null;
  audience: string | null;
  aliases: readonly string[];
  competitors: readonly { id: string; name: string; aliases: readonly string[] }[];
}

export interface ProfileStore {
  /** The product's profile and competitors, or null when the product no longer exists. */
  profile(productId: string): Promise<ProductProfile | null>;
}

/** Cut to `n` code points, as the database counts. */
const cut = (text: string, n: number) => Array.from(text).slice(0, n).join("");

/** A product or company name: never a handle, an email, a link or blank (8.2, D5). */
export function cleanToolName(raw: string | null): string | null {
  const tool = raw?.trim() ?? "";
  if (!tool || /@|(^|[^a-z0-9])u\//i.test(tool) || hasPersonOrLink(tool)) return null;
  return charLength(tool) > MAX_TOOL ? null : tool;
}

/** Offsets of an exact substring, in code points; anything else is no highlight. */
export function highlightOffsets(excerpt: string, phrase: string): Highlight | null {
  if (!phrase.trim() || charLength(phrase) > MAX_HIGHLIGHT) return null;
  const at = excerpt.indexOf(phrase);
  if (at < 0) return null;
  const start = charLength(excerpt.slice(0, at));
  const end = start + charLength(phrase);
  return end <= MAX_EXCERPT ? { start, end } : null;
}

export function toLabels(
  answer: ClassificationResult,
  items: readonly ClassifyItem[],
  competitorIds: ReadonlyMap<string, string>,
): Label[] {
  const sent = new Map(items.map((item) => [item.id, item]));
  const done = new Set<string>();
  const labels: Label[] = [];
  for (const result of answer.results) {
    const item = sent.get(result.id);
    if (!item || done.has(result.id)) continue;
    done.add(result.id);
    if (result.category === "not_relevant") continue;
    if (!Number.isInteger(result.relevance)) continue;
    if (result.relevance < MIN_RELEVANCE || result.relevance > 100) continue;
    const toolMentioned = cleanToolName(result.tool_mentioned);
    const competitorId = competitorIds.get(result.competitor_key?.trim() ?? "") ?? null;
    const summary = result.rival ? cut(result.rival.summary.trim(), MAX_SUMMARY) : "";
    const rival =
      result.rival && (toolMentioned || competitorId) && summary && !hasPersonOrLink(summary)
        ? { ...result.rival, summary }
        : null;
    labels.push({
      id: result.id,
      relevance: result.relevance,
      category: result.category,
      reason: cut(result.reason.trim(), MAX_REASON),
      highlight: highlightOffsets(item.excerpt, result.highlight),
      toolMentioned,
      competitorId,
      rival,
    });
  }
  return labels;
}

export function createClassifier(deps: {
  llm: Pick<Llm, "callStructured">;
  profiles: ProfileStore;
}): Classifier {
  const profiles = new Map<string, Promise<ProductProfile | null>>();
  return {
    async classify(productId, items) {
      if (items.length === 0) return [];
      if (items.length > BATCH_SIZE) throw new RangeError("A batch holds at most 20 posts");
      let pending = profiles.get(productId);
      if (!pending) {
        pending = deps.profiles.profile(productId);
        profiles.set(productId, pending);
      }
      const profile = await pending;
      if (!profile) return [];
      const keyed = profile.competitors
        .slice(0, MAX_COMPETITORS)
        .map((c, i) => ({ ...c, key: `c${i + 1}` }));
      const answer = await deps.llm.callStructured({
        task: "classify",
        productId,
        model: CLASSIFY_MODEL,
        system: [
          { text: CLASSIFY_SYSTEM, cache: true },
          { text: productBlock({ ...profile, competitors: keyed }), cache: true },
        ],
        // Only these four fields: never the author, the link or anything else (8.2).
        input: JSON.stringify(
          items.map(({ id, source, community, excerpt }) => ({ id, source, community, excerpt })),
        ),
        schema: Classification,
        parseSchema: ClassificationAnswer,
        maxTokens: CLASSIFY_MAX_TOKENS,
        effort: "low",
      });
      return toLabels(answer, items, new Map(keyed.map((c) => [c.key, c.id])));
    },
  };
}
