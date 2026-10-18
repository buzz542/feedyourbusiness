import { z } from "zod";

/** The classifier's output (docs/PLAN.md 8.2), exactly as the plan specifies it. */

export const ISSUES = [
  "pricing",
  "reliability",
  "missing_feature",
  "support",
  "usability",
  "performance",
  "integration",
  "other",
] as const;

export const CATEGORIES = [
  "looking_for_tool",
  "pain_point",
  "mentions_you",
  "mentions_competitor",
  "wish",
  "not_relevant",
] as const;

export const Issue = z.enum(ISSUES);

export const ClassificationSchema = z.object({
  results: z
    .array(
      z.object({
        id: z.string(),
        relevance: z.number().int().min(0).max(100),
        category: z.enum(CATEGORIES),
        reason: z.string().max(160),
        highlight: z.string().max(140),
        tool_mentioned: z.string().max(60).nullable(),
        competitor_key: z.string().max(40).nullable(),
        rival: z
          .object({
            issue: Issue,
            sentiment: z.enum(["negative", "mixed", "positive"]),
            switching: z.boolean(),
            summary: z.string().max(200),
          })
          .nullable(),
      }),
    )
    .max(20),
});

export type Classification = z.infer<typeof ClassificationSchema>;
export type ClassificationResult = Classification["results"][number];
