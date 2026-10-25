import { z } from "zod";

/**
 * Track a discovered tool (docs/PLAN.md 4.5): it becomes a competitor (origin "discovered") and
 * "<tool> alternative" is offered as a search term. Product names only: anything that looks like a
 * person, a handle, an email or a link is refused.
 */

export const ToolName = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .refine((s) => !/[@/\\]|https?:|www\.|\.(com|io|app|net|org)\b/i.test(s), "not a product name");

export interface TrackToolStore {
  competitorNames(productId: string): Promise<string[]>;
  termCount(productId: string): Promise<number>;
  addCompetitor(productId: string, name: string): Promise<void>;
  addTerm(productId: string, term: string): Promise<void>;
}

export const MAX_TERMS = 40;

export type TrackResult =
  { ok: true; term: string | null } | { ok: false; reason: "invalid" | "already_tracked" };

export async function trackTool(
  store: TrackToolStore,
  productId: string,
  raw: unknown,
): Promise<TrackResult> {
  const parsed = ToolName.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  const name = parsed.data;
  const existing = (await store.competitorNames(productId)).map((n) => n.toLowerCase());
  if (existing.includes(name.toLowerCase())) return { ok: false, reason: "already_tracked" };
  await store.addCompetitor(productId, name);
  const term = `${name} alternative`.slice(0, 60);
  if ((await store.termCount(productId)) >= MAX_TERMS) return { ok: true, term: null };
  await store.addTerm(productId, term);
  return { ok: true, term };
}
