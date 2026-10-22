import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { isAllowedEmail, parseAllowlist } from "./allowlist";
import { termsGate, type AccountState } from "./next-step";
import { getSessionUser } from "./supabase-auth";

export interface Account extends AccountState {
  userId: string;
  email: string | null;
  isAdmin: boolean;
  productName: string | null;
}

/** The signed-in user's account, read with the user-scoped client (RLS applies). Null when signed out. */
export const loadAccount = cache(async (): Promise<Account | null> => {
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
});

/**
 * The signed-in, allowlisted account, or a redirect: to sign-in when signed out, and to the
 * private-beta exit when the session belongs to someone off SIGNUP_ALLOWLIST (docs/PLAN.md 12.10).
 */
export async function requireAccount(next: string): Promise<Account> {
  const account = await loadAccount();
  if (!account) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (!isAllowedEmail(account.email, parseAllowlist(process.env.SIGNUP_ALLOWLIST))) {
    redirect("/auth/private-beta");
  }
  return account;
}

/**
 * Every page under /app calls this first (tests/compliance/app-pages.test.ts checks). Layouts do not
 * re-run on client-side navigation, so the allowlist and terms gates must live in each page.
 */
export async function requireAppPage(path: string): Promise<Account> {
  const account = await requireAccount(path);
  const gate = termsGate(path, account.termsAcceptedAt);
  if (gate) redirect(gate);
  return account;
}
