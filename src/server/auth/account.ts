import "server-only";
import { createSupabaseServerClient } from "@/server/supabase/server";
import type { AccountState } from "./next-step";

class AccountLoadError extends Error {
  override name = "AccountLoadError";
  constructor(readonly code: string | undefined) {
    super("Could not load the account");
  }
}

export interface Account extends AccountState {
  productName: string | null;
}

/** The signed-in user's own profile and product, through RLS (the user-scoped client). */
export async function loadAccount(userId: string): Promise<Account> {
  const supabase = await createSupabaseServerClient();
  const [profile, product] = await Promise.all([
    supabase
      .from("profiles")
      .select("terms_accepted_at, subscription_status")
      .eq("id", userId)
      .maybeSingle(),
    supabase
      .from("products")
      .select("name, status")
      .eq("owner_id", userId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);
  if (profile.error) throw new AccountLoadError(profile.error.code);
  if (product.error) throw new AccountLoadError(product.error.code);
  return {
    termsAccepted: profile.data?.terms_accepted_at != null,
    subscriptionStatus: profile.data?.subscription_status ?? null,
    product: product.data ? { status: product.data.status } : null,
    productName: product.data?.name ?? null,
  };
}
