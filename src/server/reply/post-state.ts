import { z } from "zod";
import type { EventName } from "@/server/analytics/track";

/**
 * Save, Mark replied, Hide and Undo on a Reply card (docs/PLAN.md 4.4). The only write is the
 * link's `state`, through the user's own client: the column grant and RLS refuse anything else.
 * Undo sets the state the card had before.
 */

export const PostState = z.enum(["new", "saved", "replied", "hidden"]);
export type PostState = z.infer<typeof PostState>;

const Input = z.object({ id: z.uuid(), state: PostState });

const EVENTS: Partial<Record<PostState, EventName>> = {
  saved: "post_saved",
  replied: "post_replied",
  hidden: "post_hidden",
};

export interface PostStateDeps {
  /** Sets `state` on the user's own link; false when no row was changed (not theirs, or gone). */
  setState(id: string, state: PostState): Promise<boolean>;
  track(name: EventName, userId: string): Promise<unknown>;
}

export function createPostStateAction(deps: PostStateDeps) {
  return async (userId: string, raw: unknown): Promise<{ ok: boolean }> => {
    const parsed = Input.safeParse(raw);
    if (!parsed.success) return { ok: false };
    const ok = await deps.setState(parsed.data.id, parsed.data.state);
    const event = EVENTS[parsed.data.state];
    if (ok && event) await deps.track(event, userId);
    return { ok };
  };
}
