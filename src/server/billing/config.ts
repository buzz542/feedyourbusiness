import { z } from "zod";

export class BillingConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingConfigError";
  }
}

export interface BillingConfig {
  secretKey: string;
  webhookSecret: string;
  priceId: string;
  siteUrl: string;
  /** Stripe Managed Payments (merchant of record). Defaults to on, as the brief requires. */
  managedPayments: boolean;
  mode: "test" | "live";
}

const bool = z.enum(["true", "false"]).default("false");

const schema = z.object({
  STRIPE_SECRET_KEY: z
    .string()
    .regex(/^(sk|rk)_(test|live)_[A-Za-z0-9]+$/, "must be a Stripe secret or restricted key"),
  STRIPE_WEBHOOK_SECRET: z.string().regex(/^whsec_[A-Za-z0-9]+$/, "must start with whsec_"),
  STRIPE_PRICE_ID: z.string().regex(/^price_[A-Za-z0-9]+$/, "must start with price_"),
  NEXT_PUBLIC_SITE_URL: z.url(),
  STRIPE_MANAGED_PAYMENTS: z.enum(["true", "false"]).default("true"),
  BILLING_LIVE_ENABLED: bool,
});

type Env = Readonly<Record<string, string | undefined>>;

/**
 * Parse billing config from the environment, and refuse to run in live mode unless two things
 * are explicitly true: the founder has switched live billing on, and a merchant of record is in
 * place (hard compliance rule: VAT and sales tax handled for us).
 */
export function loadBillingConfig(env: Env = process.env): BillingConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new BillingConfigError(`Invalid billing configuration: ${fields}`);
  }
  const e = parsed.data;
  const mode = e.STRIPE_SECRET_KEY.includes("_live_") ? "live" : "test";
  const managedPayments = e.STRIPE_MANAGED_PAYMENTS === "true";

  if (mode === "live") {
    if (e.BILLING_LIVE_ENABLED !== "true") {
      throw new BillingConfigError("Live Stripe key present but BILLING_LIVE_ENABLED is not true");
    }
    if (!managedPayments) {
      throw new BillingConfigError(
        "Live billing requires a merchant of record. Enable Stripe Managed Payments or replace this module with Paddle.",
      );
    }
  }

  return {
    secretKey: e.STRIPE_SECRET_KEY,
    webhookSecret: e.STRIPE_WEBHOOK_SECRET,
    priceId: e.STRIPE_PRICE_ID,
    siteUrl: e.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, ""),
    managedPayments,
    mode,
  };
}
