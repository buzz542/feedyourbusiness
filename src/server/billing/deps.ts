import "server-only";
import { loadAccount } from "@/server/auth/account";
import { loadAllowlist } from "@/server/auth/allowlist";
import { ensureFirstRun } from "@/server/pipeline/first-run-server";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { loadBillingConfig } from "./config";
import { startFirstRunAfterEvent } from "./first-run-trigger";
import type { BillingDeps, createWebhookHandler } from "./handlers";
import { createStripeAdapter } from "./stripe-adapter";
import { createSupabaseProfileStore } from "./supabase-store";

let cached: Pick<BillingDeps, "config" | "stripe" | "store"> | undefined;

function core() {
  // Built on first request, not at import time, so `next build` needs no secrets.
  cached ??= (() => {
    const config = loadBillingConfig();
    return {
      config,
      stripe: createStripeAdapter(config),
      store: createSupabaseProfileStore(createSupabaseAdminClient()),
    };
  })();
  return cached;
}

export function getBillingDeps(): BillingDeps {
  return {
    ...core(),
    isAllowed: loadAllowlist(),
    getAccount: loadAccount,
    async getUser() {
      const supabase = await createSupabaseServerClient();
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) return null;
      return { id: data.user.id, email: data.user.email ?? null };
    },
  };
}

/** The owner's first product, as the app shows it, read with the service role (no session here). */
async function firstProductOf(userId: string): Promise<{ id: string; status: string } | null> {
  const { data, error } = await createSupabaseAdminClient()
    .from("products")
    .select("id, status")
    .eq("owner_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error)
    throw Object.assign(new Error("Could not load the product"), { name: "ProductLoadError" });
  return data;
}

export function getWebhookDeps(): Parameters<typeof createWebhookHandler>[0] {
  const { stripe, store } = core();
  return {
    stripe,
    store,
    // The first run starts the moment the owner is entitled (the founder, 26 Nov 2026).
    afterEvent: (event) =>
      startFirstRunAfterEvent(event, {
        store,
        productFor: firstProductOf,
        startFirstRun: ensureFirstRun,
      }),
  };
}

export async function getEmailForUser(userId: string): Promise<string | null> {
  const { data, error } = await createSupabaseAdminClient().auth.admin.getUserById(userId);
  if (error) throw new Error("Supabase: could not load user");
  return data.user?.email ?? null;
}

export { core as getBillingCore };
