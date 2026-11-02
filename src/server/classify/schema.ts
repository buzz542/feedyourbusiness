import { z } from "zod";

/**
 * The classification schema (docs/PLAN.md 8.2). `Classification` is what the API is asked for;
 * `ClassificationAnswer` reads the answer with the same shape but without lengths and ranges,
 * which the API treats as hints, so one long reason cannot lose a whole batch. The classifier
 * enforces every limit itself afterwards.
 *
 * No property here names a sensitive trait (2.3.7); `guard.test.ts` checks every model schema.
 */

export const Issue = z.enum([
  "pricing",
  "reliability",
  "missing_feature",
  "support",
  "usability",
  "performance",
  "integration",
  "other",
]);

export const Category = z.enum([
  "looking_for_tool",
  "pain_point",
  "mentions_you",
  "mentions_competitor",
  "wish",
  "not_relevant",
]);

const Sentiment = z.enum(["negative", "mixed", "positive"]);

export const Classification = z.object({
  results: z
    .array(
      z.object({
        id: z.string(),
        relevance: z.number().int().min(0).max(100),
        category: Category,
        reason: z.string().max(160),
        highlight: z.string().max(140),
        tool_mentioned: z.string().max(60).nullable(),
        competitor_key: z.string().max(40).nullable(),
        rival: z
          .object({
            issue: Issue,
            sentiment: Sentiment,
            switching: z.boolean(),
            summary: z.string().max(200),
          })
          .nullable(),
      }),
    )
    .max(20),
});

export type ClassificationResult = z.infer<typeof Classification>;

export const ClassificationAnswer: z.ZodType<ClassificationResult> = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      relevance: z.number(),
      category: Category,
      reason: z.string(),
      highlight: z.string(),
      tool_mentioned: z.string().nullable(),
      competitor_key: z.string().nullable(),
      rival: z
        .object({ issue: Issue, sentiment: Sentiment, switching: z.boolean(), summary: z.string() })
        .nullable(),
    }),
  ),
});
