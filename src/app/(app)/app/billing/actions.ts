"use server";

import { getBillingDeps } from "@/server/billing/deps";
import {
  createCancelHandler,
  createCheckoutHandler,
  createPortalHandler,
} from "@/server/billing/handlers";

/**
 * Server actions for the billing buttons. They run the same tested handlers as the
 * /api/billing/* routes (same-origin by construction: Next checks a server action's origin), so
 * the rules live in one place: consent required, no second subscription, two-click cancel.
 */

type Result = { ok: true; url?: string } | { ok: false; error: string };

async function run(
  make: typeof createCheckoutHandler,
  path: string,
  body?: unknown,
): Promise<Result> {
  const deps = getBillingDeps();
  const response = await make(deps)(
    new Request(`${deps.config.siteUrl}${path}`, {
      method: "POST",
      headers: { origin: deps.config.siteUrl, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  const data = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
  return response.ok
    ? { ok: true, ...(data.url ? { url: data.url } : {}) }
    : { ok: false, error: data.error ?? "billing_unavailable" };
}

export async function startCheckoutAction(consent: boolean): Promise<Result> {
  try {
    return await run(
      createCheckoutHandler,
      "/api/billing/checkout",
      consent ? { consent: true } : {},
    );
  } catch {
    return { ok: false, error: "billing_unavailable" };
  }
}

export async function setCancelAction(action: "cancel" | "resume"): Promise<Result> {
  try {
    return await run(createCancelHandler, "/api/billing/cancel", { action });
  } catch {
    return { ok: false, error: "billing_unavailable" };
  }
}

export async function openPortalAction(): Promise<Result> {
  try {
    return await run(createPortalHandler, "/api/billing/portal");
  } catch {
    return { ok: false, error: "billing_unavailable" };
  }
}
