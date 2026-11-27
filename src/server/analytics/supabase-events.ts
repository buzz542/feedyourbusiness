import "server-only";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import type { Json } from "@/types/database";
import type { PublicEventStore } from "./public-events";
import type { EventStore } from "./track";

class EventInsertError extends Error {
  override name = "EventInsertError";
  constructor(readonly code: string | undefined) {
    super("Could not record the event");
  }
}

/** events is deny-all for API roles, so it is written with the service role, server-side only. */
export function createSupabaseEventStore(): EventStore {
  return {
    async insert(row) {
      const { error } = await createSupabaseAdminClient()
        .from("events")
        .insert({ name: row.name, user_id: row.userId, props: row.props });
      // A unique violation is a first-time event already recorded (events_first_once): done.
      if (error?.code === "23505") return;
      if (error) throw new EventInsertError(error.code);
    },
  };
}

/** The homepage's events under their daily cap (record_public_event, service role only). */
export function createSupabasePublicEventStore(): PublicEventStore {
  return {
    async record(name, props, now, cap) {
      const { data, error } = await createSupabaseAdminClient().rpc("record_public_event", {
        p_name: name,
        p_props: props as Json,
        p_now: now.toISOString(),
        p_daily_cap: cap,
      });
      if (error) throw new EventInsertError(error.code);
      return data === true;
    },
  };
}
