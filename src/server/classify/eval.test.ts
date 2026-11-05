import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Classifier, Label } from "@/server/pipeline/collect-step";
import { formatResult, parseLabeled, runEval } from "./eval";

/** The classifier eval (docs/PLAN.md 8.6) on the 5-row invented sample, with a fake model. */

const rows = parseLabeled(readFileSync("eval/sample.jsonl", "utf8"));

const label = (id: string, relevance: number, category: Label["category"]): Label => ({
  id,
  relevance,
  category,
  reason: "Invented.",
  highlight: null,
  toolMentioned: null,
  competitorId: null,
  rival: null,
});

/** s1 and s2 found, s3 a false positive, s4 dropped, s5 found below the threshold. */
const fake: Classifier = {
  async classify(_productId, items) {
    const answers: Record<string, Label> = {
      s1: label("s1", 90, "looking_for_tool"),
      s2: label("s2", 72, "pain_point"),
      s3: label("s3", 65, "pain_point"),
      s5: label("s5", 45, "wish"),
    };
    return items.flatMap((i) => (answers[i.id] ? [answers[i.id]!] : []));
  },
};

describe("eval:classifier", () => {
  it("reads the sample file", () => {
    expect(rows.map((r) => r.id)).toEqual(["s1", "s2", "s3", "s4", "s5"]);
  });

  it("prints precision and recall at the default threshold", async () => {
    const result = await runEval({ classifier: fake, productId: "eval", rows, threshold: 60 });
    expect(result).toMatchObject({ truePositives: 2, falsePositives: 1, falseNegatives: 1 });
    const printed = formatResult(result);
    expect(printed).toContain("Precision: 0.67 (target 0.80)");
    expect(printed).toContain("Recall: 0.67");
    expect(printed).toContain("Category accuracy: 1.00");
  });

  it("refuses a malformed line, naming it", () => {
    expect(() =>
      parseLabeled('{"id":"x","source":"linkedin","excerpt":"a","relevant":true}'),
    ).toThrow(/line 1: source/);
  });
});
