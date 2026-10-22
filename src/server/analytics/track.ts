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

/** A short label: lowercase words joined by underscores or hyphens, no spaces, dots or @. */
const Label = z.string().regex(/^[a-z0-9_-]{1,40}$/);
const Props = z
  .record(
    z.string().regex(/^[a-z][a-z0-9_]{0,29}$/),
    z.union([Label, z.number().finite(), z.boolean()]),
  )
  .refine((p) => Object.keys(p).length <= 8);
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
