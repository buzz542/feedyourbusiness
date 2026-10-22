import { z } from "zod";

/**
 * First-party, server-side analytics (docs/PLAN.md 12.6): one row in `events`, no cookies, IPs or
 * user agents, nothing sent to a third party. Props are small labels and counts only; anything that
 * looks like an email, a URL or free text is refused, so post text and personal data never land here.
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
export type EventProps = Record<string, string | number | boolean>;

export interface EventStore {
  insert(row: { userId: string | null; name: EventName; props: EventProps }): Promise<void>;
}

/**
 * Props are a closed vocabulary: known keys, string values from fixed lists of our own labels, and
 * numbers or booleans. A free string could carry a handle or a community name (D5), so none is taken.
 */
const Value = z.union([z.number().finite(), z.boolean()]);
const Props = z
  .object({
    source: z.enum(["hackernews", "bluesky", "reddit", "x"]),
    category: z.enum([
      "looking_for_tool",
      "pain_point",
      "mentions_you",
      "mentions_competitor",
      "wish",
    ]),
    view: z.enum(["today", "all", "saved", "replied"]),
    tab: z.enum(["reply", "rivals", "build"]),
    method: z.enum(["magic_link", "google"]),
    count: Value,
    first: Value,
    weeks: Value,
  })
  .partial()
  .strict();
const Name = z.enum(EVENT_NAMES);

export type Track = (
  name: EventName,
  userId: string | null,
  props?: EventProps,
) => Promise<boolean>;

export function createTracker(store: EventStore): Track {
  return async (name, userId, props = {}) => {
    const n = Name.safeParse(name);
    const p = Props.safeParse(props);
    if (!n.success || !p.success) {
      console.error("[track] refused: invalid event or props");
      return false;
    }
    try {
      await store.insert({ userId, name: n.data, props: p.data });
      return true;
    } catch (error) {
      console.error(`[track] failed: ${error instanceof Error ? error.name : "Unknown"}`);
      return false;
    }
  };
}
