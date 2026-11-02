import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { NEVER_INFER } from "@/server/llm/llm";
import { Draft, DRAFT_SYSTEM } from "@/server/onboarding/draft";
import { CLASSIFY_SYSTEM } from "./prompt";
import { Classification } from "./schema";

/**
 * The sensitive-trait guard (docs/PLAN.md 2.3.7, 8.2): no property of any model output schema
 * names a sensitive trait, and every system prompt carries the never-infer rule. Add each new
 * model schema and prompt here (synthesis and preview arrive with M6, M7 and M9).
 */

const BANNED =
  /health|medical|religio|politic|sexual|gender|race|ethnic|age|disab|pregnan|union|crime|nationality|immigration/i;

export const MODEL_SCHEMAS: Record<string, z.ZodType> = { draft: Draft, classify: Classification };
export const SYSTEM_PROMPTS: Record<string, string> = {
  draft: DRAFT_SYSTEM,
  classify: CLASSIFY_SYSTEM,
};

function propertyNames(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) for (const item of node) propertyNames(item, out);
  else if (node && typeof node === "object")
    for (const [key, value] of Object.entries(node)) {
      if (key === "properties" && value && typeof value === "object")
        out.push(...Object.keys(value));
      propertyNames(value, out);
    }
  return out;
}

const bannedNames = (schema: z.ZodType) =>
  propertyNames(z.toJSONSchema(schema)).filter((name) => BANNED.test(name));

describe("model schemas", () => {
  it.each(Object.entries(MODEL_SCHEMAS))(
    "%s has no property naming a sensitive trait",
    (_, schema) => {
      expect(propertyNames(z.toJSONSchema(schema)).length).toBeGreaterThan(5);
      expect(bannedNames(schema)).toEqual([]);
    },
  );

  it("catches a planted property at any depth", () => {
    expect(bannedNames(z.object({ age_range: z.string() }))).toEqual(["age_range"]);
    expect(
      bannedNames(
        z.object({ results: z.array(z.object({ rival: z.object({ religion: z.string() }) })) }),
      ),
    ).toEqual(["religion"]);
  });
});

describe("system prompts", () => {
  it.each(Object.entries(SYSTEM_PROMPTS))("%s contains the never-infer rule", (_, prompt) => {
    expect(prompt).toContain(NEVER_INFER);
  });
});

describe("classifier fixtures", () => {
  const dir = path.resolve(import.meta.dirname, "../../../tests/fixtures/classifier");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

  it.each(files)("%s validates against the classification schema", (file) => {
    const answer: unknown = JSON.parse(readFileSync(path.join(dir, file), "utf8"));
    expect(Classification.safeParse(answer).success).toBe(true);
  });

  it("refuses an answer with an unknown category or a 21st result (planted)", () => {
    const one = {
      id: "0",
      relevance: 50,
      category: "wish",
      reason: "r",
      highlight: "",
      tool_mentioned: null,
      competitor_key: null,
      rival: null,
    };
    expect(Classification.safeParse({ results: [{ ...one, category: "religion" }] }).success).toBe(
      false,
    );
    expect(Classification.safeParse({ results: Array(21).fill(one) }).success).toBe(false);
  });
});
