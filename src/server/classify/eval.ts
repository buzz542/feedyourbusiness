import { z } from "zod";
import type { Classifier, ClassifyItem, Label } from "@/server/pipeline/collect-step";

/**
 * The classifier eval (docs/PLAN.md 8.6): posts the founder labeled by hand (relevant or not, and
 * the category), run through the classifier, scored at the product's threshold. Precision is the
 * share of posts we would show that are relevant; recall is the share of relevant posts we would
 * show. Target precision 0.8. Pure, so it is tested with a fake model; `npm run eval:classifier`
 * runs it against the live API by hand, never in CI.
 */

const CATEGORIES = [
  "looking_for_tool",
  "pain_point",
  "mentions_you",
  "mentions_competitor",
  "wish",
] as const;

export const LabeledPost = z.object({
  id: z.string().min(1).max(100),
  source: z.enum(["reddit", "hackernews", "bluesky", "x"]),
  community: z.string().max(100).nullable().default(null),
  excerpt: z.string().min(1).max(280),
  relevant: z.boolean(),
  category: z.enum(CATEGORIES).nullable().default(null),
});
export type LabeledPost = z.infer<typeof LabeledPost>;

/** One JSON object per line; blank lines and lines starting with # are skipped. */
export function parseLabeled(jsonl: string): LabeledPost[] {
  const rows: LabeledPost[] = [];
  jsonl.split("\n").forEach((line, i) => {
    const text = line.trim();
    if (!text || text.startsWith("#")) return;
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new Error(`line ${i + 1}: not JSON`);
    }
    const parsed = LabeledPost.safeParse(value);
    if (!parsed.success)
      throw new Error(`line ${i + 1}: ${parsed.error.issues[0]?.path.join(".")}`);
    rows.push(parsed.data);
  });
  const ids = new Set(rows.map((r) => r.id));
  if (ids.size !== rows.length) throw new Error("ids must be unique");
  return rows;
}

export interface EvalResult {
  posts: number;
  threshold: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number | null;
  recall: number | null;
  /** Among posts we would show that are relevant and labeled with a category: the share we got right. */
  categoryAccuracy: number | null;
}

export function score(
  rows: readonly LabeledPost[],
  labels: readonly Label[],
  threshold: number,
): EvalResult {
  const byId = new Map(labels.map((l) => [l.id, l]));
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let catTotal = 0;
  let catRight = 0;
  for (const row of rows) {
    const label = byId.get(row.id);
    const shown = !!label && label.category !== "not_relevant" && label.relevance >= threshold;
    if (shown && row.relevant) {
      tp++;
      if (row.category) {
        catTotal++;
        if (label!.category === row.category) catRight++;
      }
    } else if (shown) fp++;
    else if (row.relevant) fn++;
  }
  const ratio = (a: number, b: number) => (b === 0 ? null : a / b);
  return {
    posts: rows.length,
    threshold,
    truePositives: tp,
    falsePositives: fp,
    falseNegatives: fn,
    precision: ratio(tp, tp + fp),
    recall: ratio(tp, tp + fn),
    categoryAccuracy: ratio(catRight, catTotal),
  };
}

/** Classify in batches of 20 (8.2) and score. */
export async function runEval(args: {
  classifier: Classifier;
  productId: string;
  rows: readonly LabeledPost[];
  threshold: number;
}): Promise<EvalResult> {
  const labels: Label[] = [];
  for (let i = 0; i < args.rows.length; i += 20) {
    const batch: ClassifyItem[] = args.rows
      .slice(i, i + 20)
      .map(({ id, source, community, excerpt }) => ({ id, source, community, excerpt }));
    labels.push(...(await args.classifier.classify(args.productId, batch)));
  }
  return score(args.rows, labels, args.threshold);
}

const pct = (n: number | null) => (n === null ? "n/a" : n.toFixed(2));

export function formatResult(r: EvalResult): string {
  return [
    `Posts: ${r.posts}, threshold ${r.threshold}`,
    `Precision: ${pct(r.precision)} (target 0.80)`,
    `Recall: ${pct(r.recall)}`,
    `Category accuracy: ${pct(r.categoryAccuracy)}`,
    `True positives ${r.truePositives}, false positives ${r.falsePositives}, false negatives ${r.falseNegatives}`,
  ].join("\n");
}
