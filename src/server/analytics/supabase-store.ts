import "server-only";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import { createTracker, type EventStore, type Track } from "./track";

/** `events` is deny-all for API roles, so writes go through the service role. */
export function createSupabaseEventStore(): EventStore {
  return {
    async insert({ userId, name, props }) {
      const { error } = await createSupabaseAdminClient()
        .from("events")
        .insert({ user_id: userId, name, props });
      // signed_up is once per user (unique index); a repeat is not an error.
      if (error && !(name === "signed_up" && error.code === "23505")) {
        throw new Error("Supabase: event not recorded");
      }
    },
  };
}

export const track: Track = (name, userId, props) =>
  createTracker(createSupabaseEventStore())(name, userId, props);
