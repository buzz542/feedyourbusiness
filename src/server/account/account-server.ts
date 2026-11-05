import "server-only";
import { createSupabaseEventStore } from "@/server/analytics/supabase-events";
import { track } from "@/server/analytics/track";
import { getBillingCore } from "@/server/billing/deps";
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

/** Deletion runs with the service role: the user cannot delete their own auth row (10.6). */
export function accountDeletionDeps(): AccountDeletionDeps {
  const admin = createSupabaseAdminClient();
  const billing = getBillingCore();
  return {
    getBillingProfile: (userId) => billing.store.getBillingProfile(userId),
    cancelSubscriptionNow: (id) => billing.stripe.cancelNow(id),
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

/** The export reads through the user's own client: RLS keeps every other account out (10.7). */
export async function loadAccountExport(
  userId: string,
  email: string | null,
): Promise<ExportSource> {
  const db = await createSupabaseServerClient();
  const product = await db.from("products").select("*").eq("owner_id", userId).maybeSingle();
  if (product.error) throw new AccountDataError(product.error.code);
  const productId = product.data?.id ?? "00000000-0000-0000-0000-000000000000";
  const [profile, terms, competitors, feed] = await Promise.all([
    db.from("profiles").select("*").eq("id", userId).maybeSingle(),
    db.from("search_terms").select("*").eq("product_id", productId).order("created_at"),
    db.from("competitors").select("*").eq("product_id", productId).order("created_at"),
    db
      .from("feed_items")
      .select(
        "url, source, community, posted_at, created_at, state, relevance, category, reason, tool_mentioned, switching, rival_issue, rival_sentiment",
      )
      .eq("product_id", productId)
      .order("created_at", { ascending: false }),
  ]);
  for (const r of [profile, terms, competitors, feed])
    if (r.error) throw new AccountDataError(r.error.code);
  return {
    email,
    profile: profile.data,
    product: product.data,
    terms: terms.data ?? [],
    competitors: competitors.data ?? [],
    feed: feed.data ?? [],
  };
}
