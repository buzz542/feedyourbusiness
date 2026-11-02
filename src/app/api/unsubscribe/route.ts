import { createUnsubscribeHandler } from "@/server/email/unsubscribe";
import { createSupabaseAdminClient } from "@/server/supabase/admin";

/** One-click unsubscribe (docs/PLAN.md 11, RFC 8058): GET confirms, POST applies. */
export const dynamic = "force-dynamic";

class UnsubscribeError extends Error {
  override name = "UnsubscribeError";
}

const handler = () =>
  createUnsubscribeHandler({
    secret: () => process.env.APP_HMAC_SECRET,
    async turnOff(userId, list) {
      const { error } = await createSupabaseAdminClient()
        .from("profiles")
        .update(list === "daily" ? { email_daily: false } : { email_weekly: false })
        .eq("id", userId);
      if (error) throw new UnsubscribeError(error.code);
    },
  });

export function GET(request: Request) {
  return handler().GET(request);
}

export function POST(request: Request) {
  return handler().POST(request);
}
