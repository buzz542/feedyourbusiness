import "server-only";
import { createStripeAdapter } from "@/server/billing/stripe-adapter";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import type { HealthDeps } from "./checks";

class SupabaseQueryError extends Error {
  override name = "SupabaseQueryError";
  constructor(readonly code: string | undefined) {
    super("Supabase query failed");
  }
}

/** Real adapters for the health check. Built per request, so `next build` needs no secrets. */
export function getHealthDeps(): HealthDeps {
  return {
    env: process.env,
    async pingDatabase() {
      // Proves three things at once: the URL, the secret key, and that the migrations ran.
      const { error } = await createSupabaseAdminClient().from("profiles").select("id").limit(1);
      if (error) throw new SupabaseQueryError(error.code);
    },
    stripe: (config) => createStripeAdapter(config),
  };
}
