import "server-only";
import { createSupabaseEventStore } from "@/server/analytics/supabase-events";
import { track } from "@/server/analytics/track";
import { getBillingCore } from "@/server/billing/deps";
import type { BillingStripe } from "@/server/billing/ports";
import { createSupabaseProfileStore } from "@/server/billing/supabase-store";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import { createSupabaseServerClient } from "@/server/supabase/server";
import type { AccountDeletionDeps } from "./delete-account";
import type { ExportSource } from "./export";

class AccountDataError extends Error {
  override name = "AccountDataError";
  constructor(readonly code: string | undefined) {
    super("Could not read or change account data");
  }
}

class BillingNotConfiguredError extends Error {
  override name = "BillingNotConfiguredError";
}

/**
 * Deletion runs with the service role: the user cannot delete their own auth row (10.6). Stripe is
 * loaded only when there is something to ask it: without billing configured no subscription can
 * exist here, so an account with no Stripe ids is still deleted; one with ids is not, until Stripe
 * can cancel them.
 */
export function accountDeletionDeps(): AccountDeletionDeps {
  const admin = createSupabaseAdminClient();
  const store = createSupabaseProfileStore(admin);
  let stripe: BillingStripe | null | undefined;
  const billing = () => {
    if (stripe === undefined) {
      try {
        stripe = getBillingCore().stripe;
      } catch {
        stripe = null;
      }
    }
    return stripe;
  };
  const required = () => {
    const s = billing();
    if (!s) throw new BillingNotConfiguredError("Stripe is needed to cancel a subscription");
    return s;
  };
  return {
    getBillingProfile: (userId) => store.getBillingProfile(userId),
    cancelSubscriptionNow: (id) => required().cancelNow(id),
    liveSubscriptionIds: (customerId) => required().liveSubscriptionIds(customerId),
    liveSubscriptionIdsForUser: async (userId) =>
      billing()?.liveSubscriptionIdsForUser(userId) ?? [],
    async writeAudit(entry) {
      const { error } = await admin.from("audit_log").insert(entry);
      if (error) throw new AccountDataError(error.code);
    },
    async deleteAuthUser(userId) {
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) throw new AccountDataError(error.code);
    },
    async track(name, userId) {
      await track(createSupabaseEventStore(), name, userId);
    },
  };
}

const PAGE = 1000;

/**
 * The export reads through the user's own client: RLS keeps every other account out (10.7). The
 * user's own events are deny-all to API roles, so they are read with the service role, filtered
 * to this user.
 */
export async function loadAccountExport(
  userId: string,
  email: string | null,
): Promise<ExportSource> {
  const db = await createSupabaseServerClient();
  const product = await db.from("products").select("*").eq("owner_id", userId).maybeSingle();
  if (product.error) throw new AccountDataError(product.error.code);
  const productId = product.data?.id ?? "00000000-0000-0000-0000-000000000000";
  const [profile, terms, competitors, events] = await Promise.all([
    db.from("profiles").select("*").eq("id", userId).maybeSingle(),
    db.from("search_terms").select("*").eq("product_id", productId).order("created_at"),
    db.from("competitors").select("*").eq("product_id", productId).order("created_at"),
    createSupabaseAdminClient()
      .from("events")
      .select("name, props, at")
      .eq("user_id", userId)
      .order("at")
      .limit(10_000),
  ]);
  for (const r of [profile, terms, competitors, events])
    if (r.error) throw new AccountDataError(r.error.code);
  // Page through the feed: PostgREST returns at most 1,000 rows a request.
  const feed: Array<Record<string, unknown>> = [];
  for (let from = 0; ; from += PAGE) {
    const page = await db
      .from("feed_items")
      .select(
        "id, url, source, community, posted_at, created_at, state, relevance, category, reason, tool_mentioned, switching, rival_issue, rival_sentiment",
      )
      .eq("product_id", productId)
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, from + PAGE - 1);
    if (page.error) throw new AccountDataError(page.error.code);
    feed.push(...(page.data ?? []));
    if ((page.data ?? []).length < PAGE) break;
  }
  return {
    email,
    profile: profile.data,
    product: product.data,
    terms: terms.data ?? [],
    competitors: competitors.data ?? [],
    feed,
    events: events.data ?? [],
  };
}
