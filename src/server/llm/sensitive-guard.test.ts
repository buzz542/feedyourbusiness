import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { walk } from "../../../compliance/lib/finding";
import { classificationSystem } from "@/server/classify/prompt";
import { ClassificationSchema } from "@/server/classify/schema";
import { DRAFT_SYSTEM, DraftSchema } from "@/server/onboarding/draft";
import { BUILD_SYSTEM, RIVAL_SYSTEM } from "@/server/synthesis/prompt";
import { BuildSynthesisSchema, RivalSynthesisSchema } from "@/server/synthesis/schema";
import { toOutputSchema } from "./llm";
import { NEVER_INFER_RULE } from "./rules";

/**
 * The sensitive-trait guard (docs/PLAN.md 2.3.7, 8.2): no model output has a field for a sensitive
 * trait, and every system prompt carries the never-infer rule. A new model call fails this test
 * until its schema and prompt are added here.
 */

const BANNED = [
  "health",
  "medical",
  "religio",
  "politic",
  "sexual",
  "gender",
  "race",
  "ethnic",
  "age",
  "disab",
  "pregnan",
  "union",
  "crime",
  "nationality",
  "immigration",
];

/** Every model output schema in the app. */
const MODEL_SCHEMAS: Record<string, z.ZodType> = {
  draft: DraftSchema,
  classify: ClassificationSchema,
  synthesize_build: BuildSynthesisSchema,
  synthesize_rivals: RivalSynthesisSchema,
};

/** Every system prompt, built with a sample product where it needs one. */
const SYSTEM_PROMPTS: Record<string, string> = {
  draft: DRAFT_SYSTEM,
  synthesize_build: BUILD_SYSTEM,
  synthesize_rivals: RIVAL_SYSTEM,
  classify: classificationSystem({
    name: "Invoicer",
    oneLiner: "Invoices that chase themselves",
    description: "A small tool for freelancers.",
    audience: "Freelancers",
    competitors: [{ key: "c1", name: "Ledgerly", aliases: [], domain: "ledgerly.example" }],
  })
    .map((block) => block.text)
    .join("\n"),
};

/** The files that call the model, each with its schema and prompt above. */
const CALL_SITES = [
  "src/server/classify/classify.ts",
  "src/server/onboarding/draft.ts",
  "src/server/synthesis/synthesize.ts",
];

/** Every property name in a JSON schema, at any depth. */
function propertyNames(schema: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(schema)) schema.forEach((s) => propertyNames(s, out));
  else if (schema && typeof schema === "object") {
    const props = (schema as { properties?: Record<string, unknown> }).properties;
    if (props) for (const key of Object.keys(props)) out.add(key);
    for (const value of Object.values(schema)) propertyNames(value, out);
  }
  return out;
}

const bannedIn = (names: Iterable<string>) =>
  [...names].filter((name) => BANNED.some((b) => name.toLowerCase().includes(b)));

describe("the sensitive-trait guard", () => {
  it.each(Object.entries(MODEL_SCHEMAS))(
    "the %s schema has no property for a sensitive trait",
    (_name, schema) => {
      const names = propertyNames(toOutputSchema(schema));
      expect(names.size).toBeGreaterThan(3);
      expect(bannedIn(names)).toEqual([]);
    },
  );

  it("catches a planted sensitive property, nested or not", () => {
    const planted = z.object({
      results: z.array(z.object({ id: z.string(), author_age: z.number() })),
      health_note: z.string(),
    });
    expect(bannedIn(propertyNames(toOutputSchema(planted))).sort()).toEqual([
      "author_age",
      "health_note",
    ]);
  });

  it.each(Object.entries(SYSTEM_PROMPTS))(
    "the %s system prompt carries the never-infer rule",
    (_name, prompt) => {
      expect(prompt).toContain(NEVER_INFER_RULE);
    },
  );

  it("knows every file that calls the model", () => {
    const callers = walk("src")
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
      .filter((f) => /\.callStructured\s*(<[^>]*>)?\s*\(/.test(readFileSync(f, "utf8")))
      .sort();
    expect(callers).toEqual([...CALL_SITES].sort());
  });
});

describe("the classification schema", () => {
  it("validates a recorded-shape reply", () => {
    const reply = JSON.parse(readFileSync("tests/fixtures/classify/reply-batch.json", "utf8"));
    expect(ClassificationSchema.safeParse(reply).success).toBe(true);
  });

  it.each([
    ["a relevance over 100", { relevance: 101 }],
    ["an unknown category", { category: "spam" }],
    ["a reason over 160 characters", { reason: "x".repeat(161) }],
    [
      "an unknown rival issue",
      { rival: { issue: "politics", sentiment: "negative", switching: false, summary: "" } },
    ],
  ])("refuses %s", (_label, over) => {
    const reply = JSON.parse(readFileSync("tests/fixtures/classify/reply-batch.json", "utf8"));
    reply.results[0] = { ...reply.results[0], ...over };
    expect(ClassificationSchema.safeParse(reply).success).toBe(false);
  });
});
