import { z } from "zod";
import { Issue } from "@/server/classify/schema";

/** The weekly synthesis output schemas (docs/PLAN.md 8.4), as the plan specifies them. */

export const Slug = z.string().regex(/^[a-z0-9-]{1,60}$/);

export const BuildSynthesisSchema = z.object({
  themes: z
    .array(
      z.object({
        theme_key: Slug,
        kind: z.enum(["ask", "wish", "pain"]),
        title: z.string().max(120),
        summary: z.string().max(600),
        post_ids: z.array(z.string()).min(1),
      }),
    )
    .max(8),
  opportunities: z
    .array(
      z.object({
        theme_key: Slug,
        title: z.string().max(120),
        summary: z.string().max(600),
        post_ids: z.array(z.string()).min(1),
      }),
    )
    .max(3),
});
export type BuildSynthesis = z.infer<typeof BuildSynthesisSchema>;

export const RivalSynthesisSchema = z.object({
  rivals: z
    .array(
      z.object({
        competitor_key: z.string().nullable(),
        tool_name: z.string().max(60).nullable(),
        issue: Issue,
        summary: z.string().max(600),
        post_ids: z.array(z.string()).min(1),
      }),
    )
    .max(24),
  fixes: z
    .array(
      z.object({
        theme_key: Slug,
        title: z.string().max(120),
        summary: z.string().max(600),
        post_ids: z.array(z.string()).min(1),
      }),
    )
    .max(3),
});
export type RivalSynthesis = z.infer<typeof RivalSynthesisSchema>;
