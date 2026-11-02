"use server";

import { getBillingDeps } from "@/server/billing/deps";
import { createCheckoutHandler } from "@/server/billing/handlers";

/**
 * Start Checkout from /app/billing (docs/PLAN.md 10.1, 10.2). Runs the checkout handler itself, so
 * every rule holds here too (allowlist, terms, confirmed product, one subscription, consent);
 * server actions also get Next's origin check (12.2).
 */
export async function startCheckout(consent: boolean): Promise<{ url?: string; error?: string }> {
  let deps;
  try {
    deps = getBillingDeps();
  } catch {
    return { error: "billing_unavailable" };
  }
  const site = deps.config.siteUrl;
  const response = await createCheckoutHandler(deps)(
    new Request(`${site}/api/billing/checkout`, {
      method: "POST",
      headers: { origin: site, "content-type": "application/json" },
      body: JSON.stringify({ consent: consent === true }),
    }),
  );
  const body = (await response.json()) as { url?: string; error?: string };
  return response.ok && body.url
    ? { url: body.url }
    : { error: body.error ?? "billing_unavailable" };
}
