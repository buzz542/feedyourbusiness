import { z } from "zod";
import { track, type EventStore } from "./track";

/**
 * The homepage's two events (the founder's redesign brief, 27 Nov 2026): the primary CTA clicked,
 * labeled by where it sits, and the example viewed. The visitor is not signed in, so they are
 * recorded with no user, no cookie, no IP and nothing else (docs/PLAN.md 12.6). Called from a
 * server action, which Next checks is from our own origin; only these two names and these fields.
 */

const Body = z.discriminatedUnion("name", [
  z.strictObject({
    name: z.literal("cta_clicked"),
    placement: z.enum(["nav", "hero", "pricing", "final"]),
  }),
  z.strictObject({ name: z.literal("example_viewed") }),
]);

export type PublicEvent = z.infer<typeof Body>;

/** True when recorded; anything else is refused without a word about what was sent. */
export async function recordPublicEvent(store: EventStore, raw: unknown): Promise<boolean> {
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return false;
  const { name, ...props } = parsed.data;
  return track(store, name, null, props);
}
