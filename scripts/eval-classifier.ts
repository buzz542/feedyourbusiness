/**
 * `npm run eval:classifier` (docs/PLAN.md 8.6, F16): the classifier against posts the founder
 * labeled, with precision and recall at the default threshold. It calls the live API, so it runs by
 * hand, never in CI. The labeled file holds real people's posts: it stays in the git-ignored
 * eval/labeled.jsonl, and this script never prints a post's text, only ids and counts.
 *
 * Usage (ANTHROPIC_API_KEY in the shell; eval/product.json is the product the posts were labeled
 * for, shaped like eval/sample-product.json):
 *   set -a; . ./.env.local; set +a; npm run eval:classifier
 *   EVAL_FILE=eval/sample.jsonl EVAL_PRODUCT=eval/sample-product.json npm run eval:classifier
 */
import { z } from "zod";
import type { ClassifyProduct } from "@/server/classify/classify";
import { CATEGORIES } from "@/server/classify/schema";
import { LlmRefusalError } from "@/server/llm/llm";
import { BATCH_SIZE, type Classifier, type ClassifyItem } from "@/server/pipeline/collect-step";

/** The product's default relevance threshold (docs/PLAN.md 6.2, `relevance_threshold`). */
export const DEFAULT_THRESHOLD = 60;
const TARGET_PRECISION = 0.8;

const Row = z.object({
  id: z.string().min(1).max(100),
  source: z.enum(["reddit", "hackernews", "bluesky", "x"]),
  community: z.string().max(100).nullable(),
  excerpt: z.string().min(1).max(280),
  relevant: z.boolean(),
  /** The category the founder gave a relevant post; null when not relevant. */
  category: z.enum(CATEGORIES).nullable(),
});
type Row = z.infer<typeof Row>;

/** eval/product.json: the product the posts were labeled for (see eval/sample-product.json). */
export const ProductFile = z.object({
  name: z.string().min(1).max(120),
  oneLiner: z.string().max(160),
  description: z.string().max(2000),
  audience: z.string().max(1000),
  competitors: z
    .array(
      z.object({
        key: z.string().min(1).max(40),
        id: z.string().min(1).max(100),
        name: z.string().min(1).max(80),
        aliases: z.array(z.string().max(80)).max(10),
        domain: z.string().max(253).nullable(),
      }),
    )
    .max(20),
});

export interface EvalMetrics {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  precision: number | null;
  recall: number | null;
  /** Rows in batches the model refused, left out of the scores. */
  refusedRows: number;
}

export interface EvalDeps {
  rowsText: string;
  product: ClassifyProduct;
  classifier: Classifier;
  threshold?: number;
  log: (line: string) => void;
}

/** One row per line; a bad row is named by its line number, never printed. */
export function parseRows(text: string): Row[] {
  const rows: Row[] = [];
  text.split("\n").forEach((line, index) => {
    if (!line.trim()) return;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      throw new Error(`Line ${index + 1} is not JSON`);
    }
    const parsed = Row.safeParse(json);
    if (!parsed.success)
      throw new Error(
        `Line ${index + 1} does not match the row shape (${parsed.error.issues.map((i) => i.path.join(".")).join(", ")})`,
      );
    rows.push(parsed.data);
  });
  return rows;
}

const ratio = (part: number, whole: number) => (whole === 0 ? null : part / whole);
const show = (value: number | null) => (value === null ? "n/a" : value.toFixed(2));

export async function evalClassifier(deps: EvalDeps): Promise<EvalMetrics> {
  const threshold = deps.threshold ?? DEFAULT_THRESHOLD;
  const rows = parseRows(deps.rowsText);
  const counts = { tp: 0, fp: 0, fn: 0, tn: 0, agreed: 0, refusedRows: 0, refusedBatches: 0 };
  const falsePositives: string[] = [];
  const missed: string[] = [];

  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    const batch = rows.slice(start, start + BATCH_SIZE);
    const items: ClassifyItem[] = batch.map((row, i) => ({
      id: String(i),
      source: row.source,
      community: row.community,
      excerpt: row.excerpt,
    }));
    let labels;
    try {
      // "eval" is the product id for this run; the runner's loader returns deps.product for it.
      labels = await deps.classifier.classify("eval", items);
    } catch (error) {
      if (!(error instanceof LlmRefusalError)) throw error;
      counts.refusedBatches++;
      counts.refusedRows += batch.length;
      continue;
    }
    const byId = new Map(labels.map((l) => [l.id, l]));
    batch.forEach((row, i) => {
      const label = byId.get(String(i));
      const predicted =
        !!label && label.category !== "not_relevant" && label.relevance >= threshold;
      if (predicted && row.relevant) {
        counts.tp++;
        if (row.category && label.category === row.category) counts.agreed++;
      } else if (predicted) {
        counts.fp++;
        falsePositives.push(row.id);
      } else if (row.relevant) {
        counts.fn++;
        missed.push(row.id);
      } else counts.tn++;
    });
  }

  const precision = ratio(counts.tp, counts.tp + counts.fp);
  const recall = ratio(counts.tp, counts.tp + counts.fn);
  deps.log(`Rows: ${rows.length} (${rows.filter((r) => r.relevant).length} labeled relevant)`);
  deps.log(`Product: ${deps.product.name}`);
  deps.log(`Threshold: ${threshold}`);
  deps.log(`Precision: ${show(precision)} (${counts.tp} of ${counts.tp + counts.fp})`);
  deps.log(`Recall: ${show(recall)} (${counts.tp} of ${counts.tp + counts.fn})`);
  deps.log(`Category agreement on true positives: ${counts.agreed} of ${counts.tp}`);
  if (counts.refusedBatches > 0)
    deps.log(`Refused batches: ${counts.refusedBatches} (${counts.refusedRows} rows left out)`);
  if (falsePositives.length) deps.log(`False positives: ${falsePositives.join(", ")}`);
  if (missed.length) deps.log(`Missed: ${missed.join(", ")}`);
  deps.log(
    precision !== null && precision >= TARGET_PRECISION
      ? `Meets the ${TARGET_PRECISION} precision target`
      : `Below the ${TARGET_PRECISION} precision target`,
  );
  return {
    tp: counts.tp,
    fp: counts.fp,
    fn: counts.fn,
    tn: counts.tn,
    precision,
    recall,
    refusedRows: counts.refusedRows,
  };
}
