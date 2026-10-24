import { z } from "zod";

/**
 * First-party analytics (docs/PLAN.md 12.6): one row in public.events, written server-side, with
 * no cookies, IPs or user agents, and nothing sent to a third party. Props are our own labels and
 * counts from a fixed list, so nothing that could identify a person or outlive post retention
 * (emails, URLs, handles, community names, post or product ids, free text) can be recorded.
 *
 * `digest_opened` is recorded only when someone follows a digest link into the app, never from a
 * tracking pixel or open tracking (section 11).
 */

export const EVENT_NAMES = [
  "signed_up",
  "product_confirmed",
  "checkout_started",
  "trial_started",
  "feed_opened",
  "rivals_opened",
  "build_opened",
  "post_saved",
  "post_replied",
  "post_hidden",
  "digest_opened",
  "subscription_canceled",
  "account_deleted",
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

export interface EventRow {
  name: EventName;
  userId: string | null;
  props: EventProps;
}

export interface EventStore {
  insert(row: EventRow): Promise<void>;
}

/**
 * Props are a fixed set of keys, each with its own type, and nothing else. Free-form values cannot
 * be judged by shape alone ("saas" could be a community, "someone" a username), so there are none.
 */
const Props = z.strictObject({
  view: z.enum(["today", "all", "saved", "replied"]).optional(),
  tab: z.enum(["reply", "rivals", "build"]).optional(),
  source: z.enum(["hackernews", "bluesky", "reddit", "x"]).optional(),
  category: z
    .enum(["looking_for_tool", "pain_point", "mentions_you", "mentions_competitor", "wish"])
    .optional(),
  list: z.enum(["daily", "weekly"]).optional(),
  count: z.number().int().min(0).max(1_000_000).optional(),
  first: z.boolean().optional(),
});

export type EventProps = z.input<typeof Props>;

const Event = z.object({
  name: z.enum(EVENT_NAMES),
  userId: z.uuid().nullable(),
  props: Props,
});

/** Record an event. Never throws: analytics must not break the action it describes. */
export async function track(
  store: EventStore,
  name: EventName,
  userId: string | null,
  props: EventProps = {},
): Promise<boolean> {
  const parsed = Event.safeParse({ name, userId, props });
  if (!parsed.success) {
    const rules = [
      ...new Set(parsed.error.issues.map((i) => `${String(i.path[0] ?? "event")}:${i.code}`)),
    ];
    console.warn(`[track] refused: ${rules.join(", ")}`);
    return false;
  }
  try {
    await store.insert(parsed.data as EventRow);
    return true;
  } catch (error) {
    console.error(`[track] failed: ${error instanceof Error ? error.name : "UnknownError"}`);
    return false;
  }
}
