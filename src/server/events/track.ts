import { z } from "zod";

/**
 * First-party, cookieless analytics (docs/PLAN.md 12.6): events written server-side to our own
 * events table. Each event has its own strict props schema of enums and bounded numbers, so no free
 * text can be stored: no IPs, user agents, emails, URLs, usernames, ids or post text. Nothing is
 * sent to a third party; the only side effect is the sink.
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

const SOURCE = z.enum(["hackernews", "bluesky", "reddit", "x"]);
const CATEGORY = z.enum([
  "looking_for_tool",
  "pain_point",
  "mentions_you",
  "mentions_competitor",
  "wish",
]);
const count = (max: number) => z.number().int().min(0).max(max);
const postAction = z.strictObject({
  source: SOURCE.optional(),
  category: CATEGORY.optional(),
  relevance: count(100).optional(),
});
const none = z.strictObject({});

/** The only props each event may carry. Strict: any other key is refused. */
const EVENT_PROPS = {
  signed_up: none,
  product_confirmed: z.strictObject({
    terms: count(40).optional(),
    competitors: count(20).optional(),
  }),
  checkout_started: none,
  trial_started: none,
  feed_opened: z.strictObject({ view: z.enum(["today", "all", "saved", "replied"]).optional() }),
  rivals_opened: z.strictObject({ rival: z.enum(["all", "tracked", "discovered"]).optional() }),
  build_opened: none,
  post_saved: postAction,
  post_replied: postAction,
  post_hidden: postAction,
  digest_opened: z.strictObject({ kind: z.enum(["daily", "weekly"]).optional() }),
  subscription_canceled: none,
  account_deleted: none,
} satisfies Record<EventName, z.ZodType>;

export type EventProps = Record<string, number | boolean | string>;

export interface EventSink {
  insert(row: {
    name: EventName;
    user_id: string | null;
    props: EventProps;
    at: string;
  }): Promise<void>;
}

export type TrackResult =
  { ok: true } | { ok: false; reason: "unknown_event" | "invalid_props" | "sink_failed" };

const isEventName = (name: string): name is EventName =>
  (EVENT_NAMES as readonly string[]).includes(name);

/** Record an event. Never throws: analytics must not break the action it describes. */
export async function track(
  sink: EventSink,
  name: string,
  userId: string | null,
  input: Record<string, unknown> | undefined,
  now: Date,
): Promise<TrackResult> {
  if (!isEventName(name)) return { ok: false, reason: "unknown_event" };
  const parsed = EVENT_PROPS[name].safeParse(input ?? {});
  if (!parsed.success) return { ok: false, reason: "invalid_props" };
  try {
    await sink.insert({ name, user_id: userId, props: parsed.data, at: now.toISOString() });
    return { ok: true };
  } catch (error) {
    console.error(`[events] write failed: ${error instanceof Error ? error.name : "UnknownError"}`);
    return { ok: false, reason: "sink_failed" };
  }
}
