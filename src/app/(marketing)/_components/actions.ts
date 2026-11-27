"use server";

import { recordPublicEvent } from "@/server/analytics/public-events";
import { createSupabasePublicEventStore } from "@/server/analytics/supabase-events";

/** The homepage's CTA and example events (src/server/analytics/public-events.ts). */
export async function recordHomeEvent(event: unknown): Promise<void> {
  await recordPublicEvent(createSupabasePublicEventStore(), event, new Date());
}
