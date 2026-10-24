import "server-only";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
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
      if (error) throw new EventInsertError(error.code);
    },
  };
}
