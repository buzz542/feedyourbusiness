import "server-only";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import { getSessionUser } from "@/server/auth/session";
import { loadBillingConfig } from "./config";
import type { BillingDeps } from "./handlers";
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
    // Same check as every page: a session off the pre-launch allowlist is signed out (12.10).
    getUser: getSessionUser,
  };
}

export function getWebhookDeps(): Pick<BillingDeps, "stripe" | "store"> {
  const { stripe, store } = core();
  return { stripe, store };
}

export async function getEmailForUser(userId: string): Promise<string | null> {
  const { data, error } = await createSupabaseAdminClient().auth.admin.getUserById(userId);
  if (error) throw new Error("Supabase: could not load user");
  return data.user?.email ?? null;
}

export { core as getBillingCore };
