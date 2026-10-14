import { describe, expect, it, vi } from "vitest";
import { HANDLED_EVENT_TYPES } from "@/server/billing/events";
import { TEST_PRICE } from "@/server/billing/fakes";
import type { PriceInfo, WebhookEndpointInfo } from "@/server/billing/ports";
import { createHealthHandler, runHealthChecks, type HealthDeps } from "./checks";

const CRON_SECRET = "a-long-random-cron-secret";
const SECRETS = {
  SUPABASE_SECRET_KEY: "sb_secret_supersecretvalue",
  STRIPE_SECRET_KEY: "sk_test_supersecretvalue",
  STRIPE_WEBHOOK_SECRET: "whsec_supersecretvalue",
  RESEND_API_KEY: "re_supersecretvalue",
  CRON_SECRET,
};

const GOOD_ENV = {
  ...SECRETS,
  NEXT_PUBLIC_SITE_URL: "https://askedfor.app",
  NEXT_PUBLIC_SUPABASE_URL: "https://hoqbflkszzoojdswbrgy.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_abc",
  STRIPE_PRICE_ID: "price_abc123",
  EMAIL_FROM: "AskedFor <hello@askedfor.app>",
  VERCEL_ENV: "production",
};

const GOOD_ENDPOINT: WebhookEndpointInfo = {
  url: "https://askedfor.app/api/billing/webhook",
  status: "enabled",
  enabledEvents: [...HANDLED_EVENT_TYPES],
};

function deps(
  overrides: {
    env?: Record<string, string | undefined>;
    price?: PriceInfo | Error;
    endpoints?: WebhookEndpointInfo[] | Error;
    ping?: Error;
  } = {},
): HealthDeps {
  return {
    env: overrides.env ?? GOOD_ENV,
    pingDatabase: vi.fn(async () => {
      if (overrides.ping) throw overrides.ping;
    }),
    stripe: () => ({
      async getPrice() {
        if (overrides.price instanceof Error) throw overrides.price;
        return overrides.price ?? TEST_PRICE;
      },
      async listWebhookEndpoints() {
        if (overrides.endpoints instanceof Error) throw overrides.endpoints;
        return overrides.endpoints ?? [GOOD_ENDPOINT];
      },
    }),
    timeoutMs: 50,
  };
}

const withEnv = (patch: Record<string, string | undefined>) => ({ ...GOOD_ENV, ...patch });

describe("runHealthChecks", () => {
  it("passes when Supabase, Stripe, the webhook endpoint and email are all set up", async () => {
    const report = await runHealthChecks(deps());
    expect(report.ok).toBe(true);
    for (const [name, check] of Object.entries(report.checks))
      expect(check.status, name).toBe("ok");
    expect(Object.keys(report.checks).sort()).toEqual(
      ["email", "site_url", "stripe_config", "stripe_price", "stripe_webhook", "supabase"].sort(),
    );
    expect(report.checks.stripe_config?.detail).toContain("test mode");
  });

  it("never puts a secret value in the report, even when every check fails", async () => {
    const failing = deps({
      ping: new Error(`boom ${SECRETS.SUPABASE_SECRET_KEY}`),
      price: new Error(`bad key ${SECRETS.STRIPE_SECRET_KEY}`),
      endpoints: new Error(`bad key ${SECRETS.STRIPE_SECRET_KEY}`),
    });
    const text = JSON.stringify(await runHealthChecks(failing));
    for (const secret of Object.values(SECRETS)) expect(text).not.toContain(secret);
  });

  describe("site_url", () => {
    it("is missing when NEXT_PUBLIC_SITE_URL is unset", async () => {
      const report = await runHealthChecks(
        deps({ env: withEnv({ NEXT_PUBLIC_SITE_URL: undefined }) }),
      );
      expect(report.ok).toBe(false);
      expect(report.checks.site_url?.status).toBe("missing");
    });

    it("is invalid on a Vercel deployment that still points at localhost or plain http", async () => {
      for (const url of ["http://localhost:3000", "http://askedfor.app"]) {
        const report = await runHealthChecks(deps({ env: withEnv({ NEXT_PUBLIC_SITE_URL: url }) }));
        expect(report.checks.site_url?.status, url).toBe("invalid");
      }
    });

    it("accepts localhost in local development", async () => {
      const env = withEnv({ NEXT_PUBLIC_SITE_URL: "http://localhost:3000", VERCEL_ENV: undefined });
      const report = await runHealthChecks(deps({ env }));
      expect(report.checks.site_url?.status).toBe("ok");
    });
  });

  describe("supabase", () => {
    it("is missing without the secret key, and does not try to connect", async () => {
      const d = deps({ env: withEnv({ SUPABASE_SECRET_KEY: undefined }) });
      const report = await runHealthChecks(d);
      expect(report.checks.supabase?.status).toBe("missing");
      expect(d.pingDatabase).not.toHaveBeenCalled();
    });

    it("is invalid when the URL points at a different Supabase project", async () => {
      const env = withEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://someotherref.supabase.co" });
      const report = await runHealthChecks(deps({ env }));
      expect(report.checks.supabase?.status).toBe("invalid");
    });

    it("reports a failed query by error class only", async () => {
      class PostgrestError extends Error {
        override name = "PostgrestError";
      }
      const report = await runHealthChecks(deps({ ping: new PostgrestError("details") }));
      expect(report.checks.supabase).toEqual({ status: "error", detail: "PostgrestError" });
    });

    it("times out instead of hanging the request", async () => {
      const d = deps();
      d.pingDatabase = () => new Promise(() => {});
      const report = await runHealthChecks(d);
      expect(report.checks.supabase).toEqual({ status: "error", detail: "HealthCheckTimeout" });
    });
  });

  describe("stripe", () => {
    it("is missing without Stripe keys, and skips the checks that need them", async () => {
      const env = withEnv({ STRIPE_SECRET_KEY: undefined, STRIPE_WEBHOOK_SECRET: undefined });
      const report = await runHealthChecks(deps({ env }));
      expect(report.checks.stripe_config?.status).toBe("missing");
      expect(report.checks.stripe_price?.status).toBe("skipped");
      expect(report.checks.stripe_webhook?.status).toBe("skipped");
      expect(report.ok).toBe(false);
    });

    it("refuses a live key while live billing is locked", async () => {
      const env = withEnv({ STRIPE_SECRET_KEY: "sk_live_abc" });
      const report = await runHealthChecks(deps({ env }));
      expect(report.checks.stripe_config?.status).toBe("invalid");
      expect(JSON.stringify(report)).not.toContain("sk_live_abc");
    });

    it("flags an inactive or one-off price", async () => {
      for (const price of [
        { ...TEST_PRICE, active: false },
        { ...TEST_PRICE, interval: null },
        { ...TEST_PRICE, unitAmount: null },
      ]) {
        const report = await runHealthChecks(deps({ price }));
        expect(report.checks.stripe_price?.status).toBe("invalid");
      }
    });

    it("describes a good price without exposing ids", async () => {
      const report = await runHealthChecks(deps());
      expect(report.checks.stripe_price?.detail).toBe("2900 usd every 1 month");
    });

    it("reports a Stripe API failure by error class only", async () => {
      class StripeAuthenticationError extends Error {
        override name = "StripeAuthenticationError";
      }
      const report = await runHealthChecks(deps({ price: new StripeAuthenticationError("x") }));
      expect(report.checks.stripe_price).toEqual({
        status: "error",
        detail: "StripeAuthenticationError",
      });
    });
  });

  describe("stripe_webhook", () => {
    it("is missing when no endpoint points at this site's webhook route", async () => {
      const other = { ...GOOD_ENDPOINT, url: "https://preview.example.test/api/billing/webhook" };
      const report = await runHealthChecks(deps({ endpoints: [other] }));
      expect(report.checks.stripe_webhook?.status).toBe("missing");
    });

    it("is invalid when the endpoint is disabled", async () => {
      const report = await runHealthChecks(
        deps({ endpoints: [{ ...GOOD_ENDPOINT, status: "disabled" }] }),
      );
      expect(report.checks.stripe_webhook?.status).toBe("invalid");
    });

    it("names the events the endpoint does not send", async () => {
      const endpoint = { ...GOOD_ENDPOINT, enabledEvents: ["checkout.session.completed"] };
      const report = await runHealthChecks(deps({ endpoints: [endpoint] }));
      expect(report.checks.stripe_webhook?.status).toBe("invalid");
      expect(report.checks.stripe_webhook?.detail).toContain("customer.subscription.updated");
    });

    it("accepts an endpoint that sends every event", async () => {
      const report = await runHealthChecks(
        deps({ endpoints: [{ ...GOOD_ENDPOINT, enabledEvents: ["*"] }] }),
      );
      expect(report.checks.stripe_webhook?.status).toBe("ok");
    });
  });

  describe("email", () => {
    it("is missing without a Resend key", async () => {
      const report = await runHealthChecks(deps({ env: withEnv({ RESEND_API_KEY: undefined }) }));
      expect(report.checks.email?.status).toBe("missing");
    });

    it("is invalid while EMAIL_FROM is still the placeholder", async () => {
      const env = withEnv({ EMAIL_FROM: "AskedFor <hello@example.invalid>" });
      const report = await runHealthChecks(deps({ env }));
      expect(report.checks.email?.status).toBe("invalid");
    });
  });
});

describe("createHealthHandler", () => {
  const request = (headers: Record<string, string> = {}) =>
    new Request("https://askedfor.app/api/health", { headers });

  it("answers a plain liveness probe without running any check", async () => {
    const run = vi.fn();
    const response = await createHealthHandler({ cronSecret: CRON_SECRET, run })(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "up" });
    expect(run).not.toHaveBeenCalled();
  });

  it("does not run checks for a wrong secret", async () => {
    const run = vi.fn();
    const handler = createHealthHandler({ cronSecret: CRON_SECRET, run });
    await handler(request({ authorization: "Bearer not-the-right-secret" }));
    expect(run).not.toHaveBeenCalled();
  });

  it("returns 200 with the report when every check passes, 503 when one fails", async () => {
    const auth = { authorization: `Bearer ${CRON_SECRET}` };
    const good = createHealthHandler({
      cronSecret: CRON_SECRET,
      run: () => runHealthChecks(deps()),
    });
    const goodResponse = await good(request(auth));
    expect(goodResponse.status).toBe(200);
    expect(goodResponse.headers.get("cache-control")).toBe("no-store");

    const bad = createHealthHandler({
      cronSecret: CRON_SECRET,
      run: () => runHealthChecks(deps({ env: withEnv({ RESEND_API_KEY: undefined }) })),
    });
    const badResponse = await bad(request(auth));
    expect(badResponse.status).toBe(503);
    expect((await badResponse.json()).checks.email.status).toBe("missing");
  });
});
