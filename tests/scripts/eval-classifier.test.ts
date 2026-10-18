import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { LlmCapError, LlmRefusalError } from "@/server/llm/llm";
import type { Classifier, ClassifyItem, Label } from "@/server/pipeline/collect-step";
import { evalClassifier, ProductFile } from "../../scripts/eval-classifier";

/** `npm run eval:classifier` (docs/PLAN.md 8.6) on the 5-row synthetic sample, with a fake model. */

const SAMPLE = readFileSync("eval/sample.jsonl", "utf8");
const PRODUCT = JSON.parse(readFileSync("eval/sample-product.json", "utf8"));

const label = (id: string, relevance: number, category: Label["category"]): Label => ({
  id,
  relevance,
  category,
  reason: "A reason.",
  highlight: null,
  toolMentioned: null,
  competitorId: null,
  rival: null,
});

/** Answers by excerpt: s1 and s2 relevant (right), s3 a false positive, s4 missed, s5 dropped. */
function fakeClassifier(): Classifier & { classify: ReturnType<typeof vi.fn> } {
  return {
    classify: vi.fn<Classifier["classify"]>(async (_productId, items) =>
      items.flatMap((item) => {
        if (item.excerpt.includes("invoice reminders"))
          return [label(item.id, 90, "looking_for_tool")];
        if (item.excerpt.includes("Ledgerly")) return [label(item.id, 75, "wish")];
        if (item.excerpt.includes("sunset")) return [label(item.id, 65, "pain_point")];
        if (item.excerpt.includes("pay late")) return [label(item.id, 50, "pain_point")];
        return [];
      }),
    ),
  };
}

function run(over: { rowsText?: string; classifier?: Classifier; threshold?: number } = {}) {
  const lines: string[] = [];
  const result = evalClassifier({
    rowsText: over.rowsText ?? SAMPLE,
    product: PRODUCT,
    classifier: over.classifier ?? fakeClassifier(),
    threshold: over.threshold,
    log: (line) => lines.push(line),
  });
  return { result, lines };
}

describe("eval:classifier", () => {
  it("prints precision and recall at the default threshold of 60", async () => {
    const { result, lines } = run();
    const metrics = await result;
    expect(metrics).toMatchObject({ tp: 2, fp: 1, fn: 1, tn: 1 });
    const output = lines.join("\n");
    expect(output).toContain("Rows: 5 (3 labeled relevant)");
    expect(output).toContain("Threshold: 60");
    expect(output).toContain("Precision: 0.67 (2 of 3)");
    expect(output).toContain("Recall: 0.67 (2 of 3)");
    expect(output).toContain("Category agreement on true positives: 1 of 2");
    expect(output).toContain("Below the 0.8 precision target");
    expect(output).toContain("False positives: s3");
    expect(output).toContain("Missed: s4");
  });

  it("moves with the threshold", async () => {
    const metrics = await run({ threshold: 40 }).result;
    expect(metrics).toMatchObject({ tp: 3, fp: 1, fn: 0 });
  });

  it("sends the model only an opaque id, the source, the community and the excerpt", async () => {
    const classifier = fakeClassifier();
    await run({ classifier }).result;
    const [productId, items] = classifier.classify.mock.calls[0]! as [string, ClassifyItem[]];
    expect(productId).toBe("eval");
    for (const item of items) {
      expect(Object.keys(item).sort()).toEqual(["community", "excerpt", "id", "source"]);
      expect(item.id).toMatch(/^\d{1,2}$/);
    }
  });

  it("never prints a post's text", async () => {
    const { result, lines } = run();
    await result;
    expect(lines.join("\n")).not.toMatch(/invoice reminders|sunset|Ledgerly|pay late|desk/i);
  });

  it("names the line of a bad row without printing it", async () => {
    const bad = `${SAMPLE.trim()}\n{"id":"s6","excerpt":"A secret post","relevant":"yes"}\n`;
    await expect(run({ rowsText: bad }).result).rejects.toThrow(/Line 6/);
    await expect(run({ rowsText: bad }).result).rejects.not.toThrow(/secret/);
  });

  it("counts a refused batch and leaves it out of the scores", async () => {
    const classifier = {
      classify: vi.fn<Classifier["classify"]>(async () => {
        throw new LlmRefusalError();
      }),
    };
    const { result, lines } = run({ classifier });
    expect(await result).toMatchObject({ tp: 0, fp: 0, fn: 0, refusedRows: 5 });
    expect(lines.join("\n")).toContain("Refused batches: 1 (5 rows left out)");
  });

  it("stops at a spend cap and says so", async () => {
    const classifier = {
      classify: vi.fn<Classifier["classify"]>(async () => {
        throw new LlmCapError("global_daily");
      }),
    };
    await expect(run({ classifier }).result).rejects.toThrow(/global_daily/);
  });
});

describe("eval files", () => {
  it("the sample product matches the product file shape", () => {
    expect(ProductFile.safeParse(PRODUCT).success).toBe(true);
  });

  it("keeps the founder's labeled posts out of git", () => {
    const ignored = readFileSync(".gitignore", "utf8");
    expect(ignored).toMatch(/^eval\/labeled\.jsonl$/m);
  });
});
