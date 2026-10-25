import { BillingConfigError, loadBillingConfig, type BillingConfig } from "@/server/billing/config";
import { HANDLED_EVENT_TYPES } from "@/server/billing/events";
import type { BillingStripe, WebhookEndpointInfo } from "@/server/billing/ports";
import { isCronAuthorized } from "@/server/http/cron";
import { json } from "@/server/http/respond";
import { PROCESSOR_HOSTS } from "@/server/net/hosts";
import { BUDGET_ENV, dailyBudgetFor } from "@/server/pipeline/config";
import {
  collectSources,
  isEnabled,
  killSwitchName,
  sources,
  vendorClearance,
} from "@/sources/registry";

/**
 * Deployment health check. One authenticated request tells the founder whether this deployment
 * can reach the right Supabase project, whether Stripe is configured with a usable price and a
 * working webhook endpoint, whether email is set up and whether the cron secret is strong. It reads
 * configuration and makes read-only calls; it never writes anything and never returns a secret
 * value or an error message (error class names only, as everywhere else).
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
  stripe(
    config: BillingConfig,
  ): Pick<BillingStripe, "getPrice" | "listWebhookEndpoints" | "countUndeliveredEvents">;
  now?: () => Date;
  /** Per-check limit, so one slow dependency cannot hang the request. */
  timeoutMs?: number;
}

class HealthCheckTimeout extends Error {
  override name = "HealthCheckTimeout";
}

const DAY_MS = 86_400_000;
/** Scheme, host and path. A query string does not make Next redirect, so it is ignored. */
const endpointKey = (u: URL) => `${u.protocol}//${u.host}${u.pathname}`;
const SUPABASE_HOSTS: readonly string[] = PROCESSOR_HOSTS.filter((h) => h.endsWith(".supabase.co"));
/** Values copied from .env.example unchanged. */
const PLACEHOLDER = /replace_me/i;
const PERMISSION_DETAIL =
  "StripePermissionError: give the key read access to Webhook Endpoints and Events, or use a secret key";

/** Class name plus a short machine code when there is one. Never the message. */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return "UnknownError";
  // Stripe's SDK errors keep their class name in `type`; `name` is the generic "Error".
  const type = (error as { type?: unknown }).type;
  const name = typeof type === "string" && /^Stripe[A-Za-z]*Error$/.test(type) ? type : error.name;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && /^[A-Za-z0-9_]{2,40}$/.test(code) ? `${name} (${code})` : name;
}

const isPermissionError = (error: unknown) =>
  describeError(error).startsWith("StripePermissionError");

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
const placeholders = (env: Env, names: readonly string[]): string[] =>
  names.filter((n) => PLACEHOLDER.test(env[n] ?? ""));
const placeholderResult = (names: string[]): CheckResult => ({
  status: "invalid",
  detail: `still the .env.example placeholder: ${names.join(", ")}`,
});

/** True for the same host or its `www` twin. */
const sameSite = (a: string, b: string) => a === b || a === `www.${b}` || b === `www.${a}`;

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
    return { status: "invalid", detail: "NEXT_PUBLIC_SITE_URL must be this site's https URL" };
  }
  // Vercel sets this to the project's production domain (a custom domain once one is attached).
  const production =
    env.VERCEL_ENV === "production" ? env.VERCEL_PROJECT_PRODUCTION_URL?.toLowerCase() : undefined;
  if (production && !sameSite(url.hostname, production)) {
    const bothCustom = !production.endsWith(".vercel.app") && !url.hostname.endsWith(".vercel.app");
    // With several custom domains Vercel reports only one of them, so trust the setting then.
    if (!bothCustom) {
      return {
        status: "invalid",
        detail: `NEXT_PUBLIC_SITE_URL is ${url.origin} but this project's production domain is ${production}: attach the domain in Vercel or change the URL`,
      };
    }
  }
  return { status: "ok", detail: url.origin };
}

async function checkSupabase(deps: HealthDeps, timeoutMs: number): Promise<CheckResult> {
  const names = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SECRET_KEY",
  ];
  const missing = absent(deps.env, names);
  if (missing.length > 0) return { status: "missing", detail: missing.join(", ") };
  const unchanged = placeholders(deps.env, names);
  if (unchanged.length > 0) return placeholderResult(unchanged);

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
  const names = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_ID"];
  const missing = absent(env, names);
  if (missing.length > 0) return { result: { status: "missing", detail: missing.join(", ") } };
  const unchanged = placeholders(env, names);
  if (unchanged.length > 0) return { result: placeholderResult(unchanged) };
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

const parseUrl = (raw: string): URL | null => {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
};

async function checkStripeWebhook(
  stripe: Pick<BillingStripe, "listWebhookEndpoints" | "countUndeliveredEvents">,
  config: BillingConfig,
  now: Date,
  timeoutMs: number,
): Promise<CheckResult> {
  return probe(async () => {
    // URL parsing lowercases the host and drops a default port, so those differences still match.
    const target = new URL("/api/billing/webhook", config.siteUrl);
    let endpoints: WebhookEndpointInfo[];
    try {
      endpoints = await stripe.listWebhookEndpoints();
    } catch (error) {
      if (isPermissionError(error)) return { status: "error", detail: PERMISSION_DETAIL };
      throw error;
    }

    const parsed = endpoints.flatMap((e) => {
      const url = parseUrl(e.url);
      return url ? [{ endpoint: e, url }] : [];
    });
    const exact = parsed
      .filter((p) => endpointKey(p.url) === endpointKey(target))
      .map((p) => p.endpoint);
    if (exact.length === 0) {
      // Same site and path, but a trailing slash, http:// or the other www form: each redirects.
      const near = parsed.find(
        (p) =>
          sameSite(p.url.hostname, target.hostname) &&
          p.url.pathname.replace(/\/+$/, "") === target.pathname,
      );
      if (near) {
        return {
          status: "invalid",
          detail: `an endpoint is registered at ${near.endpoint.url}; register exactly ${target.href}. A trailing slash, http:// or the other www form makes Vercel or Next redirect, and Stripe counts a redirect as a failed delivery`,
        };
      }
      return { status: "missing", detail: `no endpoint for ${target.href}` };
    }

    const enabled = exact.filter((e) => e.status === "enabled");
    if (enabled.length === 0) return { status: "invalid", detail: "the endpoint is disabled" };
    if (enabled.length > 1) {
      return {
        status: "invalid",
        detail: `${enabled.length} enabled endpoints point at ${target.href}; keep one, because only one signing secret can match`,
      };
    }

    const events = enabled[0]?.enabledEvents ?? [];
    const missingEvents = events.includes("*")
      ? []
      : HANDLED_EVENT_TYPES.filter((t) => !events.includes(t));
    if (missingEvents.length > 0) {
      return {
        status: "invalid",
        detail: `the endpoint does not send: ${missingEvents.join(", ")}`,
      };
    }

    // A wrong STRIPE_WEBHOOK_SECRET makes every delivery fail signature checks with a 400.
    let undelivered: number;
    try {
      undelivered = await stripe.countUndeliveredEvents({
        since: new Date(now.getTime() - DAY_MS),
        types: HANDLED_EVENT_TYPES,
      });
    } catch (error) {
      if (isPermissionError(error)) return { status: "error", detail: PERMISSION_DETAIL };
      throw error;
    }
    if (undelivered > 0) {
      return {
        status: "invalid",
        detail: `${undelivered} billing events from the last 24 hours were not delivered: check that STRIPE_WEBHOOK_SECRET is this endpoint's signing secret and that the endpoint answers 2xx, then resend them from the Stripe Dashboard or wait for Stripe's retries`,
      };
    }
    return { status: "ok", detail: target.href };
  }, timeoutMs);
}

function checkEmail(env: Env): CheckResult {
  const names = ["RESEND_API_KEY", "EMAIL_FROM"];
  const missing = absent(env, names);
  if (missing.length > 0) return { status: "missing", detail: missing.join(", ") };
  const unchanged = placeholders(env, names);
  if (unchanged.length > 0) return placeholderResult(unchanged);
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

/**
 * Which collect sources are on, and what would stop them: a vendor held back for its DPA date
 * (2.1.7), a missing credential, a configuration the source refuses, or no usable author-hash
 * pepper. Env names only, never a value.
 */
function checkSources(env: Env): CheckResult {
  const missing: string[] = [];
  const invalid: string[] = [];
  for (const s of sources) {
    if (s.mode !== "collect" || env[killSwitchName(s)] !== "true") continue;
    if (!isEnabled(s, env)) {
      missing.push(
        vendorClearance(s, env) === "notice_missing"
          ? `${s.id} stays off until the privacy notice states how long ${s.vendor?.name} keeps snapshots (docs/PLAN.md 2.3.12)`
          : `${s.id} stays off until ${s.vendor?.dpaSignedOnEnv} holds the DPA date, YYYY-MM-DD and not in the future (docs/PLAN.md 2.1.7)`,
      );
      continue;
    }
    const absentNames = (s.requiredCredentials ?? []).filter((name) => !env[name]);
    if (absentNames.length > 0)
      missing.push(
        `${s.id}: ${absentNames.join(", ")} ${absentNames.length === 1 ? "is" : "are"} not set`,
      );
    const read = (name: string) => (s.credentials.includes(name) ? env[name] : undefined);
    for (const problem of s.configProblems?.(read) ?? []) invalid.push(`${s.id}: ${problem}`);
    // Switched on with no budget (X defaults to 0): it would make no calls at all.
    if (dailyBudgetFor(s, env) <= 0)
      invalid.push(
        `${s.id}: ${BUDGET_ENV[s.id] ?? "its daily budget"} is 0 or unset, so it makes no calls`,
      );
  }
  const on = collectSources(env).map((s) => s.id);
  if (on.length > 0) {
    const pepper = env.AUTHOR_HASH_PEPPER;
    if (!pepper)
      missing.push("AUTHOR_HASH_PEPPER is not set (32 or more random characters, never rotated)");
    else if (pepper.length < 32 || PLACEHOLDER.test(pepper))
      invalid.push(
        "AUTHOR_HASH_PEPPER is shorter than 32 characters or still the .env.example placeholder",
      );
  }
  if (missing.length > 0) return { status: "missing", detail: [...missing, ...invalid].join("; ") };
  if (invalid.length > 0) return { status: "invalid", detail: invalid.join("; ") };
  return { status: "ok", detail: on.length ? `on: ${on.join(", ")}` : "no collect source is on" };
}

function checkCronSecret(env: Env): CheckResult {
  const secret = env.CRON_SECRET;
  if (!secret) return { status: "missing", detail: "CRON_SECRET" };
  if (PLACEHOLDER.test(secret)) return placeholderResult(["CRON_SECRET"]);
  if (secret.length < 32) {
    return { status: "invalid", detail: "CRON_SECRET should be 32 or more random characters" };
  }
  return { status: "ok" };
}

export async function runHealthChecks(deps: HealthDeps): Promise<HealthReport> {
  const timeoutMs = deps.timeoutMs ?? 8000;
  const now = (deps.now ?? (() => new Date()))();
  const { env } = deps;

  const stripeConfig = checkStripeConfig(env);
  const config = stripeConfig.config;
  const skipped: CheckResult = { status: "skipped", detail: "needs a valid stripe_config" };
  const stripe = config ? deps.stripe(config) : null;

  const [supabase, stripePrice, stripeWebhook] = await Promise.all([
    checkSupabase(deps, timeoutMs),
    stripe && config ? checkStripePrice(stripe, config, timeoutMs) : skipped,
    stripe && config ? checkStripeWebhook(stripe, config, now, timeoutMs) : skipped,
  ]);

  const checks: Record<string, CheckResult> = {
    site_url: checkSiteUrl(env),
    supabase,
    stripe_config: stripeConfig.result,
    stripe_price: stripePrice,
    stripe_webhook: stripeWebhook,
    email: checkEmail(env),
    cron_secret: checkCronSecret(env),
    sources: checkSources(env),
  };
  return {
    ok: Object.values(checks).every((c) => c.status === "ok"),
    environment: env.VERCEL_ENV ?? "local",
    checks,
  };
}

/**
 * GET /api/health. Without credentials it is a liveness probe and runs nothing. With
 * `Authorization: Bearer $CRON_SECRET` it runs every check: 200 when all pass, 503 otherwise. A
 * credential that does not work (wrong, or the server's secret unset or too short) gets 401, so a
 * cron-breaking secret never looks healthy.
 */
export function createHealthHandler(args: {
  cronSecret: string | undefined;
  run: () => Promise<HealthReport>;
}) {
  return async (request: Request): Promise<Response> => {
    if (!isCronAuthorized(request, args.cronSecret)) {
      return request.headers.has("authorization")
        ? json(401, { error: "unauthorized" })
        : json(200, { status: "up" });
    }
    const report = await args.run();
    return json(report.ok ? 200 : 503, report);
  };
}
