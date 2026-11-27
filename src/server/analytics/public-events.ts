import { z } from "zod";

/**
 * The homepage's two events (the founder's redesign brief, 27 Nov 2026): the primary CTA clicked,
 * labeled by where it sits, and the example viewed. The visitor is not signed in, so they are
 * recorded with no user, no cookie, no IP and nothing else (docs/PLAN.md 12.6). Called from a
 * server action, which Next checks is from our own origin; only these two names and these fields,
 * and at most PUBLIC_EVENT_DAILY_CAP of each a day (record_public_event), so a script posting in
 * a loop can neither fill the table nor skew the counts past it.
 */

/** Each public event's most rows a UTC day, across all visitors. */
export const PUBLIC_EVENT_DAILY_CAP = 5_000;

export interface PublicEventStore {
  /** record_public_event: false once today's cap for the name is reached. */
  record(name: string, props: Record<string, unknown>, now: Date, cap: number): Promise<boolean>;
}

const Body = z.discriminatedUnion("name", [
  z.strictObject({
    name: z.literal("cta_clicked"),
    placement: z.enum(["nav", "hero", "pricing", "final"]),
  }),
  z.strictObject({ name: z.literal("example_viewed") }),
]);

export type PublicEvent = z.infer<typeof Body>;

/** True when recorded; anything else is refused without a word about what was sent. */
export async function recordPublicEvent(
  store: PublicEventStore,
  raw: unknown,
  now: Date,
): Promise<boolean> {
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return false;
  const { name, ...props } = parsed.data;
  try {
    return await store.record(name, props, now, PUBLIC_EVENT_DAILY_CAP);
  } catch (error) {
    console.error(
      `[track] public event failed: ${error instanceof Error ? error.name : "UnknownError"}`,
    );
    return false;
  }
}
