import "server-only";
import { createSupabaseServerClient } from "@/server/supabase/server";
import type { AccountState } from "./next-step";
import { getSessionUser } from "./supabase-auth";

export interface Account extends AccountState {
  userId: string;
  email: string | null;
  isAdmin: boolean;
  productName: string | null;
}

/** The signed-in user's account, read with the user-scoped client (RLS applies). Null when signed out. */
export async function loadAccount(): Promise<Account | null> {
  const user = await getSessionUser();
  if (!user) return null;
  const supabase = await createSupabaseServerClient();
  const [profile, product] = await Promise.all([
    supabase
      .from("profiles")
      .select("terms_accepted_at, subscription_status, is_admin")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("products")
      .select("name, status")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);
  if (profile.error || product.error) throw new Error("Supabase: could not load account");
  return {
    userId: user.id,
    email: user.email,
    isAdmin: profile.data?.is_admin === true,
    termsAcceptedAt: profile.data?.terms_accepted_at
      ? new Date(profile.data.terms_accepted_at)
      : null,
    subscriptionStatus: profile.data?.subscription_status ?? null,
    product: product.data ? { status: product.data.status } : null,
    productName: product.data?.name ?? null,
  };
}
