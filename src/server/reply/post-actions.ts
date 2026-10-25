import { z } from "zod";

/**
 * Save, Mark replied, Hide and Undo on a Reply card (docs/PLAN.md 4.4). Each changes only the
 * card's `state`; the column grant on product_posts allows nothing else, and row-level security
 * keeps it to the user's own product. Pure input handling here; the store is a port.
 */

export const POST_STATES = ["new", "saved", "replied", "hidden"] as const;
export type PostState = (typeof POST_STATES)[number];

export const PostActionInput = z.object({
  id: z.uuid(),
  to: z.enum(POST_STATES),
});
export type PostActionInput = z.infer<typeof PostActionInput>;

export interface PostStateStore {
  /** Sets the state of one of the user's own cards; returns what it was, or null if not found. */
  setState(
    id: string,
    to: PostState,
  ): Promise<{ from: PostState; source: string; category: string; relevance: number } | null>;
}

const EVENT_FOR: Partial<Record<PostState, "post_saved" | "post_replied" | "post_hidden">> = {
  saved: "post_saved",
  replied: "post_replied",
  hidden: "post_hidden",
};

export type PostActionResult =
  { ok: true; from: PostState; to: PostState } | { ok: false; reason: "invalid" | "not_found" };

export async function applyPostAction(
  store: PostStateStore,
  raw: unknown,
  onEvent?: (
    name: "post_saved" | "post_replied" | "post_hidden",
    props: { source: string; category: string; relevance: number },
  ) => Promise<unknown>,
): Promise<PostActionResult> {
  const input = PostActionInput.safeParse(raw);
  if (!input.success) return { ok: false, reason: "invalid" };
  const before = await store.setState(input.data.id, input.data.to);
  if (!before) return { ok: false, reason: "not_found" };
  const event = EVENT_FOR[input.data.to];
  if (event && before.from !== input.data.to)
    await onEvent?.(event, {
      source: before.source,
      category: before.category,
      relevance: before.relevance,
    });
  return { ok: true, from: before.from, to: input.data.to };
}
