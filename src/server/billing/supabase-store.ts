import "server-only";
import type { AdminClient } from "@/server/supabase/admin";
import type { Json } from "@/types/database";
import type { BillingProfile, EventClaim, ProfileStore, SubscriptionStatus } from "./ports";
import { normalizeStatus } from "./subscription";

function must<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(`Supabase: ${result.error.message}`);
  return result.data;
}

/** Supabase implementation of the ProfileStore port. Needs the service-role client. */
export function createSupabaseProfileStore(db: AdminClient): ProfileStore {
  return {
    async getBillingProfile(userId): Promise<BillingProfile | null> {
      const row = must(
        await db
          .from("profiles")
          .select("id, stripe_customer_id, stripe_subscription_id, subscription_status")
          .eq("id", userId)
          .maybeSingle(),
      );
      if (!row) return null;
      return {
        id: row.id,
        stripeCustomerId: row.stripe_customer_id,
        stripeSubscriptionId: row.stripe_subscription_id,
        subscriptionStatus: row.subscription_status
          ? normalizeStatus(row.subscription_status)
          : null,
      };
    },

    async findUserIdByCustomerId(customerId) {
      const row = must(
        await db.from("profiles").select("id").eq("stripe_customer_id", customerId).maybeSingle(),
      );
      return row?.id ?? null;
    },

    async applyBillingPatch(userId, patch, eventAt) {
      const applied = must(
        await db.rpc("apply_billing_patch", {
          p_user_id: userId,
          p_event_at: eventAt.toISOString(),
          p_patch: patch as Json,
        }),
      );
      return applied === true;
    },

    async claimEvent(eventId, type): Promise<EventClaim> {
      const claim = must(
        await db.rpc("claim_billing_event", { p_event_id: eventId, p_type: type }),
      );
      if (claim === "new" || claim === "retry" || claim === "duplicate") return claim;
      throw new Error("Supabase: unexpected claim_billing_event result");
    },

    async markEventProcessed(eventId) {
      must(
        await db
          .from("billing_events")
          .update({ processed_at: new Date().toISOString() })
          .eq("stripe_event_id", eventId),
      );
    },

    async listTrialingProfilesWithoutReminder() {
      const rows =
        must(
          await db
            .from("profiles")
            .select("id, trial_end, cancel_at_period_end")
            .eq("subscription_status", "trialing" satisfies SubscriptionStatus)
            .is("trial_reminder_sent_at", null)
            .not("trial_end", "is", null),
        ) ?? [];
      return rows.flatMap((r) =>
        r.trial_end
          ? [
              {
                id: r.id,
                trialEnd: new Date(r.trial_end),
                cancelAtPeriodEnd: r.cancel_at_period_end,
              },
            ]
          : [],
      );
    },

    async claimTrialReminder(userId, now) {
      const rows =
        must(
          await db
            .from("profiles")
            .update({ trial_reminder_sent_at: now.toISOString() })
            .eq("id", userId)
            .is("trial_reminder_sent_at", null)
            .select("id"),
        ) ?? [];
      return rows.length === 1;
    },

    async releaseTrialReminder(userId) {
      must(await db.from("profiles").update({ trial_reminder_sent_at: null }).eq("id", userId));
    },
  };
}
