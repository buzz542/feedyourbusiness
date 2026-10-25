"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { clientIp, ipHash } from "@/server/privacy/ip-hash";
import { submitRemoval } from "@/server/privacy/removal";
import { createRemovalStore, sendRemovalReceived } from "@/server/privacy/supabase-removal";
import { createSupabaseAdminClient } from "@/server/supabase/admin";

/** The removal form (docs/PLAN.md 4.8, 12.7): 5 requests per IP hash per day. */
export async function submitRemovalAction(formData: FormData): Promise<void> {
  const now = new Date();
  const field = (name: string) => {
    const v = formData.get(name);
    return typeof v === "string" ? v : "";
  };
  let outcome: string;
  try {
    const hash = ipHash(process.env.APP_HMAC_SECRET, clientIp(await headers()), now);
    const result = await submitRemoval(
      { store: createRemovalStore(createSupabaseAdminClient()), notify: sendRemovalReceived },
      {
        link_or_handle: field("link_or_handle"),
        source: field("source") || null,
        contact_email: field("contact_email"),
        details: field("details"),
      },
      hash,
      now,
    );
    outcome = result.ok ? "sent" : result.reason;
  } catch (error) {
    console.error(`[removal] submit failed: ${error instanceof Error ? error.name : "Unknown"}`);
    outcome = "error";
  }
  redirect(`/remove-my-post?status=${outcome}`);
}
