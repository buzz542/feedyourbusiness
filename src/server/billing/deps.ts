import "server-only";
import { loadAccount } from "@/server/auth/account";
import { loadAllowlist } from "@/server/auth/allowlist";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import { createSupabaseServerClient } from "@/server/supabase/server";
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
