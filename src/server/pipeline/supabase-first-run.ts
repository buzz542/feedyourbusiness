import "server-only";
import { FEED_CATEGORIES } from "@/lib/reply-filters";
import { createResendMailer } from "@/server/email/mailer";
import type { AdminClient } from "@/server/supabase/admin";
import type { Json } from "@/types/database";
import { summarizeFirstRun, type FirstRunStatus, type NotifyDeps } from "./first-run";

/** Supabase adapters for the first run (service role: jobs are deny-all for API roles). */

/**
 * Claim-then-send for a job's email: marks the job's payload once, so a job that runs again after
 * a crash never sends a second email (at most once; a crash between claim and send sends none).
 */
export async function claimJobEmail(db: AdminClient, jobId: string): Promise<boolean> {
  const current = await db.from("jobs").select("payload").eq("id", jobId).maybeSingle();
  if (current.error || !current.data) throw new Error("Supabase: could not read the job");
  const payload =
    current.data.payload && typeof current.data.payload === "object"
      ? (current.data.payload as Record<string, Json>)
      : {};
  if (payload.email_claimed) return false;
  const { data, error } = await db
    .from("jobs")
    .update({ payload: { ...payload, email_claimed: true } })
    .eq("id", jobId)
    .is("payload->email_claimed", null)
    .select("id");
  if (error) throw new Error("Supabase: could not claim the email");
  return (data ?? []).length === 1;
}

/** The Resend mailer, or null until RESEND_API_KEY and EMAIL_FROM are set (F6). */
export function optionalMailer() {
  try {
    return createResendMailer();
  } catch {
    return null;
  }
}

export function createSupabaseNotifyDeps(db: AdminClient): NotifyDeps {
  return {
    async pending(productId) {
      const { count, error } = await db
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .eq("product_id", productId)
        .eq("kind", "first_run")
        .not("source", "is", null)
        .in("status", ["queued", "running", "waiting"]);
      if (error) throw new Error("Supabase: could not count pending jobs");
      return count ?? 0;
    },
    async counts(productId) {
      // Cards waiting in the Reply tab, per category: new, and not past delete_after (2.3.4).
      const now = new Date().toISOString();
      const entries = await Promise.all(
        FEED_CATEGORIES.map(async (category) => {
          const { count, error } = await db
            .from("product_posts")
            .select("id, posts!inner(delete_after)", { count: "exact", head: true })
            .eq("product_id", productId)
            .eq("state", "new")
            .eq("category", category)
            .gt("posts.delete_after", now);
          if (error) throw new Error("Supabase: could not count posts");
          return [category, count ?? 0] as const;
        }),
      );
      return Object.fromEntries(entries);
    },
    async recipient(productId) {
      const { data, error } = await db
        .from("products")
        .select("owner_id")
        .eq("id", productId)
        .maybeSingle();
      if (error) throw new Error("Supabase: could not load the product");
      if (!data) return null;
      const user = await db.auth.admin.getUserById(data.owner_id);
      if (user.error) throw new Error("Supabase: could not load the user");
      return user.data.user?.email ?? null;
    },
    claim: (jobId) => claimJobEmail(db, jobId),
    mailer: optionalMailer,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  };
}

/** The first run's progress by source, for a product whose ownership the caller has checked. */
export async function loadFirstRunStatus(
  db: AdminClient,
  productId: string,
): Promise<FirstRunStatus | null> {
  const { data, error } = await db
    .from("jobs")
    .select("source, status")
    .eq("product_id", productId)
    .eq("kind", "first_run")
    .order("created_at");
  if (error) throw new Error("Supabase: could not load the first run");
  return summarizeFirstRun(data ?? []);
}
