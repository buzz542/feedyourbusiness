import "server-only";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import type { EventSink } from "./track";

/** The events table is deny-all for API roles, so events are written with the service role. */
export function createSupabaseEventSink(): EventSink {
  return {
    async insert(row) {
      const { error } = await createSupabaseAdminClient().from("events").insert(row);
      if (error) throw new Error("Supabase: could not record event");
    },
  };
}
