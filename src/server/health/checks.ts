import { BillingConfigError, loadBillingConfig, type BillingConfig } from "@/server/billing/config";
import { HANDLED_EVENT_TYPES } from "@/server/billing/events";
import type { BillingStripe } from "@/server/billing/ports";
import { isCronAuthorized } from "@/server/http/cron";
import { json } from "@/server/http/respond";
import { PROCESSOR_HOSTS } from "@/server/net/hosts";

/**
 * Deployment health check. One authenticated request tells the founder whether this deployment
 * can reach the right Supabase project, whether Stripe is configured with a usable price and a
 * registered webhook endpoint, and whether email is set up. It reads configuration and makes
 * read-only calls; it never writes anything and never returns a secret value or an error message
 * (error class names only, as everywhere else).
 */

export type CheckStatus = "ok" | "missing" | "invalid" | "error" | "skipped";

export interface CheckResult {
  status: CheckStatus;
  detail?: string;
}

export interface HealthReport {
  ok: boolean;
  environment: string;
  checks: Record<string, CheckResult>;
}

type Env = Readonly<Record<string, string | undefined>>;

export interface HealthDeps {
  env: Env;
  /** A trivial read with the service-role client. Throws when the database cannot be queried. */
  pingDatabase(): Promise<void>;
  stripe(config: BillingConfig): Pick<BillingStripe, "getPrice" | "listWebhookEndpoints">;
  /** Per-check limit, so one slow dependency cannot hang the request. */
  timeoutMs?: number;
}

class HealthCheckTimeout extends Error {
  override name = "HealthCheckTimeout";
}

const SUPABASE_HOSTS: readonly string[] = PROCESSOR_HOSTS.filter((h) => h.endsWith(".supabase.co"));

/** Class name plus a short machine code when there is one. Never the message. */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return "UnknownError";
  // Stripe's SDK errors keep their class name in `type`; `name` is the generic "Error".
  const type = (error as { type?: unknown }).type;
  const name = typeof type === "string" && /^Stripe[A-Za-z]*Error$/.test(type) ? type : error.name;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && /^[A-Za-z0-9_]{2,40}$/.test(code) ? `${name} (${code})` : name;
}

async function probe(run: () => Promise<CheckResult>, timeoutMs: number): Promise<CheckResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new HealthCheckTimeout()), timeoutMs);
  });
  try {
    return await Promise.race([run(), timeout]);
  } catch (error) {
    return { status: "error", detail: describeError(error) };
  } finally {
    clearTimeout(timer);
  }
}

const absent = (env: Env, names: readonly string[]): string[] => names.filter((n) => !env[n]);

function checkSiteUrl(env: Env): CheckResult {
  const raw = env.NEXT_PUBLIC_SITE_URL;
  if (!raw) return { status: "missing", detail: "NEXT_PUBLIC_SITE_URL" };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { status: "invalid", detail: "NEXT_PUBLIC_SITE_URL is not a URL" };
  }
  const deployed = env.VERCEL_ENV === "production" || env.VERCEL_ENV === "preview";
  if (deployed && (url.protocol !== "https:" || url.hostname === "localhost")) {
    return {
      status: "invalid",
      detail: "NEXT_PUBLIC_SITE_URL must be this deployment's https URL",
    };
  }
  return { status: "ok", detail: url.origin };
}

async function checkSupabase(deps: HealthDeps, timeoutMs: number): Promise<CheckResult> {
  const missing = absent(deps.env, [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SECRET_KEY",
  ]);
  if (missing.length > 0) return { status: "missing", detail: missing.join(", ") };

  let host: string;
  try {
    host = new URL(deps.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname;
  } catch {
    return { status: "invalid", detail: "NEXT_PUBLIC_SUPABASE_URL is not a URL" };
  }
  if (!SUPABASE_HOSTS.includes(host)) {
    return { status: "invalid", detail: `NEXT_PUBLIC_SUPABASE_URL must be ${SUPABASE_HOSTS[0]}` };
  }
  return probe(async () => {
    await deps.pingDatabase();
    return { status: "ok", detail: host };
  }, timeoutMs);
}

function checkStripeConfig(env: Env): { result: CheckResult; config?: BillingConfig } {
  const missing = absent(env, ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_ID"]);
  if (missing.length > 0) return { result: { status: "missing", detail: missing.join(", ") } };
  try {
    const config = loadBillingConfig(env);
    const mop = config.managedPayments ? "Managed Payments on" : "Managed Payments off";
    return { result: { status: "ok", detail: `${config.mode} mode, ${mop}` }, config };
  } catch (error) {
    // Our own messages name fields and flags, never values.
    const detail = error instanceof BillingConfigError ? error.message : describeError(error);
    return { result: { status: "invalid", detail } };
  }
}

async function checkStripePrice(
  stripe: Pick<BillingStripe, "getPrice">,
  config: BillingConfig,
  timeoutMs: number,
): Promise<CheckResult> {
  return probe(async () => {
    const price = await stripe.getPrice(config.priceId);
    if (!price.active || price.unitAmount == null || !price.interval) {
      return { status: "invalid", detail: "STRIPE_PRICE_ID must be an active recurring price" };
    }
    const every = `${price.intervalCount ?? 1} ${price.interval}`;
    return { status: "ok", detail: `${price.unitAmount} ${price.currency} every ${every}` };
  }, timeoutMs);
}

async function checkStripeWebhook(
  stripe: Pick<BillingStripe, "listWebhookEndpoints">,
  config: BillingConfig,
  timeoutMs: number,
): Promise<CheckResult> {
  return probe(async () => {
    const target = `${config.siteUrl}/api/billing/webhook`;
    const endpoints = (await stripe.listWebhookEndpoints()).filter((e) => e.url === target);
    if (endpoints.length === 0) return { status: "missing", detail: `no endpoint for ${target}` };

    const enabled = endpoints.filter((e) => e.status === "enabled");
    if (enabled.length === 0) return { status: "invalid", detail: "the endpoint is disabled" };

    const missingEvents = enabled.map((e) =>
      e.enabledEvents.includes("*")
        ? []
        : HANDLED_EVENT_TYPES.filter((t) => !e.enabledEvents.includes(t)),
    );
    if (missingEvents.some((m) => m.length === 0)) return { status: "ok", detail: target };
    return {
      status: "invalid",
      detail: `the endpoint does not send: ${(missingEvents[0] ?? []).join(", ")}`,
    };
  }, timeoutMs);
}

function checkEmail(env: Env): CheckResult {
  const missing = absent(env, ["RESEND_API_KEY", "EMAIL_FROM"]);
  if (missing.length > 0) return { status: "missing", detail: missing.join(", ") };
  if (!/^re_[A-Za-z0-9_]+$/.test(env.RESEND_API_KEY ?? "")) {
    return { status: "invalid", detail: "RESEND_API_KEY must be a Resend API key (re_...)" };
  }
  const from = env.EMAIL_FROM ?? "";
  if (
    !/@[a-z0-9-]+(\.[a-z0-9-]+)+>?$/i.test(from) ||
    /@example\.(invalid|com|test)\b/i.test(from)
  ) {
    return { status: "invalid", detail: "EMAIL_FROM must use your verified sending domain" };
  }
  return { status: "ok" };
}

export async function runHealthChecks(deps: HealthDeps): Promise<HealthReport> {
  const timeoutMs = deps.timeoutMs ?? 8000;
  const { env } = deps;

  const stripeConfig = checkStripeConfig(env);
  const config = stripeConfig.config;
  const skipped: CheckResult = { status: "skipped", detail: "needs a valid stripe_config" };
  const stripe = config ? deps.stripe(config) : null;

  const [supabase, stripePrice, stripeWebhook] = await Promise.all([
    checkSupabase(deps, timeoutMs),
    stripe && config ? checkStripePrice(stripe, config, timeoutMs) : skipped,
    stripe && config ? checkStripeWebhook(stripe, config, timeoutMs) : skipped,
  ]);

  const checks: Record<string, CheckResult> = {
    site_url: checkSiteUrl(env),
    supabase,
    stripe_config: stripeConfig.result,
    stripe_price: stripePrice,
    stripe_webhook: stripeWebhook,
    email: checkEmail(env),
  };
  return {
    ok: Object.values(checks).every((c) => c.status === "ok"),
    environment: env.VERCEL_ENV ?? "local",
    checks,
  };
}

/**
 * GET /api/health. Without credentials it is a liveness probe and runs nothing. With
 * `Authorization: Bearer $CRON_SECRET` it runs every check: 200 when all pass, 503 otherwise.
 */
export function createHealthHandler(args: {
  cronSecret: string | undefined;
  run: () => Promise<HealthReport>;
}) {
  return async (request: Request): Promise<Response> => {
    if (!isCronAuthorized(request, args.cronSecret)) return json(200, { status: "up" });
    const report = await args.run();
    return json(report.ok ? 200 : 503, report);
  };
}
