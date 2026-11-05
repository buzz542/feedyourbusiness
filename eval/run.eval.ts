import { readFileSync } from "node:fs";
import { describe, it } from "vitest";
import { createClassifier } from "@/server/classify/classifier";
import { formatResult, parseLabeled, runEval } from "@/server/classify/eval";
import { createAnthropicClientFromEnv } from "@/server/llm/anthropic-client";
import { loadSpendCaps } from "@/server/llm/config";
import { FakeUsageStore } from "@/server/llm/fakes";
import { createLlm } from "@/server/llm/llm";

/**
 * `npm run eval:classifier` (docs/PLAN.md 8.6): the live run, by hand only (EVAL_LIVE=1 and an
 * Anthropic key). It records usage in memory, not in any database. See eval/README.md.
 */
describe("classifier eval (live)", () => {
  const live = process.env.EVAL_LIVE === "1";
  it.runIf(live)(
    "prints precision and recall on eval/labeled.jsonl",
    async () => {
      const rows = parseLabeled(readFileSync("eval/labeled.jsonl", "utf8"));
      const profile = JSON.parse(readFileSync("eval/profile.json", "utf8"));
      const llm = createLlm({
        client: createAnthropicClientFromEnv(),
        usage: new FakeUsageStore(),
        clock: { now: () => new Date() },
        caps: loadSpendCaps(),
      });
      const classifier = createClassifier({ llm, profiles: { profile: async () => profile } });
      const result = await runEval({ classifier, productId: "eval", rows, threshold: 60 });
      console.log(`\n${formatResult(result)}\n`);
    },
    600_000,
  );
  it.skipIf(live)("is skipped unless EVAL_LIVE=1 (it calls the live API)", () => {});
});
