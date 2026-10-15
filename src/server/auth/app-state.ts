import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { gateFor, type AppPage, type AppState } from "./next-step";
import { requireUser, type SessionUser } from "./session";

const PRODUCT_STATUSES = new Set(["draft", "active", "paused"]);

/** The signed-in person's state, read with their own client (RLS applies). Cached per request. */
export const loadAppState = cache(async (userId: string): Promise<AppState> => {
  const supabase = await createSupabaseServerClient();
  const [profile, products] = await Promise.all([
    supabase
      .from("profiles")
      .select("terms_accepted_at, subscription_status")
      .eq("id", userId)
      .maybeSingle(),
    supabase
      .from("products")
      .select("id, name, status")
      .eq("owner_id", userId)
      .order("created_at")
      .limit(1),
  ]);
  if (profile.error || products.error) throw new Error("Supabase: could not load app state");

  const product = products.data?.[0];
  return {
    termsAccepted: profile.data?.terms_accepted_at != null,
    subscriptionStatus: profile.data?.subscription_status ?? null,
    product:
      product && PRODUCT_STATUSES.has(product.status)
        ? {
            id: product.id,
            name: product.name,
            status: product.status as "draft" | "active" | "paused",
          }
        : null,
  };
});

/** Signed in, on the allowlist, and in a state that may see `page`; otherwise redirects. */
export async function requirePage(
  page: AppPage,
  returnTo: string,
): Promise<{ user: SessionUser; state: AppState }> {
  const user = await requireUser(returnTo);
  const state = await loadAppState(user.id);
  const to = gateFor(page, state);
  if (to) redirect(to);
  return { user, state };
}
