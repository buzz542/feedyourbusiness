import { existsSync, readFileSync } from "node:fs";
import { it } from "vitest";
import { createClassifier } from "@/server/classify/classify";
import { createAnthropicClient } from "@/server/llm/anthropic";
import { loadLlmConfig } from "@/server/llm/config";
import { createLlm } from "@/server/llm/llm";
import type { UsageRow } from "@/server/llm/ports";
import { DEFAULT_THRESHOLD, evalClassifier, ProductFile } from "./eval-classifier";

/**
 * `npm run eval:classifier` (founder only, F16): the live model, the caps from the environment,
 * spend kept in memory for this run. Each batch prints its tokens, so the second batch's cache read
 * shows prompt caching working on the real API.
 */
it(
  "evaluates the classifier against the labeled posts",
  async () => {
    const file = process.env.EVAL_FILE ?? "eval/labeled.jsonl";
    const productFile = process.env.EVAL_PRODUCT ?? "eval/product.json";
    for (const path of [file, productFile])
      if (!existsSync(path)) throw new Error(`${path} is missing; see scripts/eval-classifier.ts`);
    const product = ProductFile.parse(JSON.parse(readFileSync(productFile, "utf8")));
    const threshold = Number(process.env.EVAL_THRESHOLD ?? DEFAULT_THRESHOLD);
    if (!Number.isInteger(threshold) || threshold < 40 || threshold > 95)
      throw new Error("EVAL_THRESHOLD must be a whole number from 40 to 95");

    const { apiKey, caps } = loadLlmConfig();
    const rows: UsageRow[] = [];
    const llm = createLlm({
      client: createAnthropicClient(apiKey),
      usage: {
        async record(row) {
          rows.push(row);
          console.log(
            `Batch ${rows.length}: ${row.input_tokens} input, ${row.cache_write_tokens} cache write, ` +
              `${row.cache_read_tokens} cache read, ${row.output_tokens} output tokens, $${row.cost_usd.toFixed(4)}`,
          );
        },
        spendSince: async ({ productId }) =>
          rows
            .filter((row) => productId === null || row.product_id === productId)
            .reduce((sum, row) => sum + row.cost_usd, 0),
      },
      clock: () => new Date(),
      caps,
    });
    await evalClassifier({
      rowsText: readFileSync(file, "utf8"),
      product,
      classifier: createClassifier({ llm, product: async () => product }),
      threshold,
      log: (line) => console.log(line),
    });
    console.log(
      `Model cost for this run: $${rows.reduce((sum, row) => sum + row.cost_usd, 0).toFixed(4)}`,
    );
  },
  30 * 60_000,
);
