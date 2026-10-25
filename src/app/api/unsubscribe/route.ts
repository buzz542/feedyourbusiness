import { createUnsubscribeHandler, type EmailList } from "@/server/email/unsubscribe";
import { createSupabaseAdminClient } from "@/server/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const turnOff = (list: EmailList) =>
  list === "daily" ? { email_daily: false } : { email_weekly: false };

const handler = () =>
  createUnsubscribeHandler({
    secret: process.env.APP_HMAC_SECRET,
    async apply(userId, list) {
      const { error } = await createSupabaseAdminClient()
        .from("profiles")
        .update(turnOff(list))
        .eq("id", userId);
      if (error) throw new Error("Supabase: could not unsubscribe");
    },
  });

/** GET shows a confirm page; POST applies it (RFC 8058 one-click). docs/PLAN.md 11. */
export async function GET(request: Request) {
  return handler()(request);
}

export async function POST(request: Request) {
  return handler()(request);
}
