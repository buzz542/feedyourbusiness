import { findHighlight } from "@/lib/highlight-range";
import type { Llm } from "@/server/llm/llm";
import type { Classifier, ClassifyItem, Label } from "@/server/pipeline/collect-step";
import { classificationSystem, type ProductContext } from "./prompt";
import { ClassificationSchema, type ClassificationResult } from "./schema";

/**
 * Haiku classification (docs/PLAN.md 8.2): one call per batch of at most 20 posts, with the cached
 * system prompt, then the post-processing the plan lists. The model's labels are claims to check,
 * not facts: ids we did not send, highlights that are not exact substrings, tool names that look
 * like a person or a link, and competitor keys that are not this product's are all dropped here.
 * A refusal (LlmRefusalError) or a spend cap (LlmCapError) is thrown for the caller to count.
 */

export const CLASSIFY_MODEL = "claude-haiku-5-5" as const;
/** 20 results with a 160-character reason, a 140-character highlight and a 200-character summary. */
const MAX_TOKENS = 8_000;
const MIN_RELEVANCE = 40;

export interface ClassifyProduct extends ProductContext {
  /** Each competitor's key is what the model sees; its id is what is stored. */
  competitors: (ProductContext["competitors"][number] & { id: string })[];
}

/** The product's profile and competitors, read once per classifier (one job). */
export type ProductLoader = (productId: string) => Promise<ClassifyProduct>;

/** A product or company name, never a handle, an email, a profile or a link. */
function toolName(raw: string | null): string | null {
  const name = raw?.replace(/\s+/g, " ").trim() ?? "";
  if (!name) return null;
  if (name.includes("@") || name.includes("/") || /^www\./i.test(name)) return null;
  return name;
}

export function toLabel(
  result: ClassificationResult,
  item: ClassifyItem,
  competitorIds: ReadonlyMap<string, string>,
): Label | null {
  if (result.category === "not_relevant" || result.relevance < MIN_RELEVANCE) return null;
  const toolMentioned = toolName(result.tool_mentioned);
  const competitorId =
    result.competitor_key === null ? null : (competitorIds.get(result.competitor_key) ?? null);
  const rival =
    result.rival && (toolMentioned || competitorId)
      ? {
          issue: result.rival.issue,
          sentiment: result.rival.sentiment,
          switching: result.rival.switching,
          summary: result.rival.summary,
        }
      : null;
  return {
    id: result.id,
    relevance: result.relevance,
    category: result.category,
    reason: result.reason,
    highlight: findHighlight(item.excerpt, result.highlight),
    toolMentioned,
    competitorId,
    rival,
  };
}

export function createClassifier(deps: { llm: Llm; product: ProductLoader }): Classifier {
  const products = new Map<string, Promise<ClassifyProduct>>();
  const productFor = (productId: string) => {
    let loading = products.get(productId);
    if (!loading) {
      loading = deps.product(productId);
      // A failed read is not cached: the next batch tries again.
      loading.catch(() => products.delete(productId));
      products.set(productId, loading);
    }
    return loading;
  };

  return {
    async classify(productId, items) {
      if (items.length === 0) return [];
      const product = await productFor(productId);
      const reply = await deps.llm.callStructured({
        task: "classify",
        productId,
        model: CLASSIFY_MODEL,
        effort: "low",
        system: classificationSystem(product),
        input: `<posts>${JSON.stringify(items)}</posts>`,
        schema: ClassificationSchema,
        maxTokens: MAX_TOKENS,
      });
      const sent = new Map(items.map((item) => [item.id, item]));
      const competitorIds = new Map(product.competitors.map((c) => [c.key, c.id]));
      const labels: Label[] = [];
      const done = new Set<string>();
      for (const result of reply.results) {
        const item = sent.get(result.id);
        if (!item || done.has(result.id)) continue;
        done.add(result.id);
        const label = toLabel(result, item, competitorIds);
        if (label) labels.push(label);
      }
      return labels;
    },
  };
}
