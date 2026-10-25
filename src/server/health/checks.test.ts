import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { HANDLED_EVENT_TYPES } from "@/server/billing/events";
import { TEST_PRICE } from "@/server/billing/fakes";
import type { PriceInfo, WebhookEndpointInfo } from "@/server/billing/ports";
import { createHealthHandler, runHealthChecks, type HealthDeps } from "./checks";

const CRON_SECRET = "a-long-random-cron-secret-of-32-chars-plus";
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
  VERCEL_PROJECT_PRODUCTION_URL: "askedfor.app",
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
    undelivered?: number | Error;
    ping?: Error;
  } = {},
): HealthDeps & { undeliveredCalls: { since: Date; types: readonly string[] }[] } {
  const undeliveredCalls: { since: Date; types: readonly string[] }[] = [];
  return {
    env: overrides.env ?? GOOD_ENV,
    now: () => new Date("2026-10-15T12:00:00Z"),
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
      async countUndeliveredEvents(args) {
        undeliveredCalls.push(args);
        if (overrides.undelivered instanceof Error) throw overrides.undelivered;
        return overrides.undelivered ?? 0;
      },
    }),
    timeoutMs: 50,
    undeliveredCalls,
  };
}

const withEnv = (patch: Record<string, string | undefined>) => ({ ...GOOD_ENV, ...patch });

describe("runHealthChecks", () => {
  it("passes when Supabase, Stripe, the webhook endpoint, email and the cron secret are all set up", async () => {
    const report = await runHealthChecks(deps());
    expect(report.ok).toBe(true);
    for (const [name, check] of Object.entries(report.checks))
      expect(check.status, name).toBe("ok");
    expect(Object.keys(report.checks).sort()).toEqual(
      [
        "cron_secret",
        "email",
        "site_url",
        "sources",
        "stripe_config",
        "stripe_price",
        "stripe_webhook",
        "supabase",
      ].sort(),
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

  it("rejects every placeholder value from .env.example", async () => {
    const env = withEnv({
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_replace_me",
      RESEND_API_KEY: "re_replace_me",
      CRON_SECRET: "replace_me_with_a_long_random_string",
      STRIPE_PRICE_ID: "price_replace_me",
    });
    const report = await runHealthChecks(deps({ env }));
    expect(report.checks.supabase?.status).toBe("invalid");
    expect(report.checks.email?.status).toBe("invalid");
    expect(report.checks.cron_secret?.status).toBe("invalid");
    expect(report.checks.stripe_config?.status).toBe("invalid");
    expect(report.ok).toBe(false);
  });

  describe("cron_secret", () => {
    it("asks for 32 or more characters", async () => {
      const report = await runHealthChecks(deps({ env: withEnv({ CRON_SECRET: "x".repeat(20) }) }));
      expect(report.checks.cron_secret?.status).toBe("invalid");
    });
  });

  describe("site_url", () => {
    it("is missing when NEXT_PUBLIC_SITE_URL is unset", async () => {
      const report = await runHealthChecks(
        deps({ env: withEnv({ NEXT_PUBLIC_SITE_URL: undefined }) }),
      );
      expect(report.ok).toBe(false);
      expect(report.checks.site_url?.status).toBe("missing");
    });

    it("is invalid on a Vercel deployment that points at localhost or plain http", async () => {
      for (const url of ["http://localhost:3000", "https://localhost", "http://askedfor.app"]) {
        const env = withEnv({ NEXT_PUBLIC_SITE_URL: url, VERCEL_ENV: "preview" });
        const report = await runHealthChecks(deps({ env }));
        expect(report.checks.site_url?.status, url).toBe("invalid");
      }
    });

    it("is invalid in production when the domain is not attached to this project yet", async () => {
      const env = withEnv({ VERCEL_PROJECT_PRODUCTION_URL: "askedfor.vercel.app" });
      const report = await runHealthChecks(deps({ env }));
      expect(report.checks.site_url?.status).toBe("invalid");
      expect(report.checks.site_url?.detail).toContain("askedfor.vercel.app");
    });

    it("trusts the setting when both are custom domains (Vercel reports only one of several)", async () => {
      const env = withEnv({ VERCEL_PROJECT_PRODUCTION_URL: "askedfor.dev" });
      const report = await runHealthChecks(deps({ env }));
      expect(report.checks.site_url?.status).toBe("ok");
    });

    it("is invalid on a vercel.app URL once a custom production domain exists", async () => {
      const env = withEnv({ NEXT_PUBLIC_SITE_URL: "https://askedfor.vercel.app" });
      const report = await runHealthChecks(deps({ env }));
      expect(report.checks.site_url?.status).toBe("invalid");
    });

    it("accepts the www twin of the production domain", async () => {
      const env = withEnv({ NEXT_PUBLIC_SITE_URL: "https://www.askedfor.app" });
      const report = await runHealthChecks(
        deps({
          env,
          endpoints: [{ ...GOOD_ENDPOINT, url: "https://www.askedfor.app/api/billing/webhook" }],
        }),
      );
      expect(report.checks.site_url?.status).toBe("ok");
    });

    it("accepts localhost in local development", async () => {
      const env = withEnv({
        NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
        VERCEL_ENV: undefined,
        VERCEL_PROJECT_PRODUCTION_URL: undefined,
      });
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

    it("reports a real Stripe SDK error by class and code, never its message", async () => {
      const error = new Stripe.errors.StripeAuthenticationError({
        message: `Invalid API Key provided: ${SECRETS.STRIPE_SECRET_KEY}`,
        code: "api_key_expired",
      });
      expect(error.name).toBe("Error"); // the class lives in `type`, which is why the check reads it
      const report = await runHealthChecks(deps({ price: error }));
      expect(report.checks.stripe_price).toEqual({
        status: "error",
        detail: "StripeAuthenticationError (api_key_expired)",
      });
      expect(JSON.stringify(report)).not.toContain(SECRETS.STRIPE_SECRET_KEY);
    });
  });

  describe("stripe_webhook", () => {
    it("is missing when no endpoint points at this site's webhook route", async () => {
      const other = { ...GOOD_ENDPOINT, url: "https://preview.example.test/api/billing/webhook" };
      const report = await runHealthChecks(deps({ endpoints: [other] }));
      expect(report.checks.stripe_webhook?.status).toBe("missing");
    });

    it("matches a host that differs only in case or a default port", async () => {
      const env = withEnv({ NEXT_PUBLIC_SITE_URL: "https://AskedFor.app" });
      const endpoint = { ...GOOD_ENDPOINT, url: "https://askedfor.app:443/api/billing/webhook" };
      const report = await runHealthChecks(deps({ env, endpoints: [endpoint] }));
      expect(report.checks.stripe_webhook?.status).toBe("ok");
    });

    it.each([
      ["a trailing slash", "https://askedfor.app/api/billing/webhook/"],
      ["plain http", "http://askedfor.app/api/billing/webhook"],
      ["the www twin", "https://www.askedfor.app/api/billing/webhook"],
    ])(
      "names a near miss that would redirect, which Stripe counts as a failure: %s",
      async (_label, url) => {
        const report = await runHealthChecks(deps({ endpoints: [{ ...GOOD_ENDPOINT, url }] }));
        expect(report.checks.stripe_webhook?.status).toBe("invalid");
        expect(report.checks.stripe_webhook?.detail).toContain(url);
        expect(report.checks.stripe_webhook?.detail).toContain("redirect");
      },
    );

    it("accepts an endpoint with a query string, which does not redirect", async () => {
      const endpoint = {
        ...GOOD_ENDPOINT,
        url: "https://askedfor.app/api/billing/webhook?env=prod",
      };
      const report = await runHealthChecks(deps({ endpoints: [endpoint] }));
      expect(report.checks.stripe_webhook?.status).toBe("ok");
    });

    it("is invalid when the endpoint is disabled", async () => {
      const report = await runHealthChecks(
        deps({ endpoints: [{ ...GOOD_ENDPOINT, status: "disabled" }] }),
      );
      expect(report.checks.stripe_webhook?.status).toBe("invalid");
    });

    it("flags two enabled endpoints at the same URL, since only one signing secret can match", async () => {
      const report = await runHealthChecks(deps({ endpoints: [GOOD_ENDPOINT, GOOD_ENDPOINT] }));
      expect(report.checks.stripe_webhook?.status).toBe("invalid");
      expect(report.checks.stripe_webhook?.detail).toContain("2 enabled endpoints");
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

    it("catches a wrong signing secret through events undelivered in the last 24 hours", async () => {
      const d = deps({ undelivered: 3 });
      const report = await runHealthChecks(d);
      expect(report.checks.stripe_webhook?.status).toBe("invalid");
      expect(report.checks.stripe_webhook?.detail).toContain("STRIPE_WEBHOOK_SECRET");
      expect(report.checks.stripe_webhook?.detail).toContain("resend");
      expect(d.undeliveredCalls[0]?.types).toEqual([...HANDLED_EVENT_TYPES]);
      // A short lookback, so the check clears soon after a fix instead of staying red for a week.
      expect(d.undeliveredCalls[0]?.since.toISOString()).toBe("2026-10-14T12:00:00.000Z");
    });

    it("explains a key that cannot read events, and reports other failures by class", async () => {
      const denied = new Stripe.errors.StripePermissionError({ message: "no access" });
      const deniedReport = await runHealthChecks(deps({ undelivered: denied }));
      expect(deniedReport.checks.stripe_webhook?.status).toBe("error");
      expect(deniedReport.checks.stripe_webhook?.detail).toContain("Events");

      const down = new Stripe.errors.StripeAPIError({ message: "boom" });
      const downReport = await runHealthChecks(deps({ undelivered: down }));
      expect(downReport.checks.stripe_webhook).toEqual({
        status: "error",
        detail: "StripeAPIError",
      });
    });

    it("explains a restricted key that cannot read webhook endpoints", async () => {
      const error = new Stripe.errors.StripePermissionError({ message: "no access" });
      const report = await runHealthChecks(deps({ endpoints: error }));
      expect(report.checks.stripe_webhook?.status).toBe("error");
      expect(report.checks.stripe_webhook?.detail).toContain("StripePermissionError");
      expect(report.checks.stripe_webhook?.detail).toContain("Webhook Endpoints");
    });
  });

  describe("sources", () => {
    const PEPPER = { AUTHOR_HASH_PEPPER: "a-long-random-pepper-of-32-characters-plus" };
    const BLUESKY = {
      SOURCE_BLUESKY_ENABLED: "true",
      BLUESKY_IDENTIFIER: "askedfor.example.test",
      BLUESKY_APP_PASSWORD: "app-password-value",
    };

    it("is ok with no collect source on, and lists the ones that are", async () => {
      expect((await runHealthChecks(deps())).checks.sources).toEqual({
        status: "ok",
        detail: "no collect source is on",
      });
      const on = withEnv({ SOURCE_HACKERNEWS_ENABLED: "true", ...BLUESKY, ...PEPPER });
      expect((await runHealthChecks(deps({ env: on }))).checks.sources).toEqual({
        status: "ok",
        detail: "on: hackernews, bluesky",
      });
    });

    it("names missing credentials of a source that is on, never their values", async () => {
      const env = withEnv({ SOURCE_BLUESKY_ENABLED: "true", BLUESKY_IDENTIFIER: "a", ...PEPPER });
      expect((await runHealthChecks(deps({ env }))).checks.sources).toEqual({
        status: "missing",
        detail: "bluesky: BLUESKY_APP_PASSWORD is not set",
      });
    });

    it("needs a real author-hash pepper once any collect source is on", async () => {
      const missing = withEnv({ SOURCE_HACKERNEWS_ENABLED: "true" });
      expect((await runHealthChecks(deps({ env: missing }))).checks.sources).toEqual({
        status: "missing",
        detail: "AUTHOR_HASH_PEPPER is not set (32 or more random characters, never rotated)",
      });
      const placeholder = withEnv({
        SOURCE_HACKERNEWS_ENABLED: "true",
        AUTHOR_HASH_PEPPER: "replace_me_with_a_long_random_string",
      });
      expect((await runHealthChecks(deps({ env: placeholder }))).checks.sources).toMatchObject({
        status: "invalid",
        detail: expect.stringMatching(/AUTHOR_HASH_PEPPER/),
      });
    });

    it("reports a source that would refuse to start, or make no calls: an unpinned dataset, or X with no budget", async () => {
      // A local run: deployments hold Reddit back until the notice states snapshot retention.
      const reddit = withEnv({
        ...PEPPER,
        VERCEL_ENV: "development",
        SOURCE_REDDIT_ENABLED: "true",
        BRIGHTDATA_DPA_SIGNED_ON: "2026-10-02",
        BRIGHTDATA_API_TOKEN: "bd-token-value",
        BRIGHTDATA_REDDIT_DATASET_ID: "gd_l1viktl72bvl7bjuj0",
      });
      const redditReport = await runHealthChecks(deps({ env: reddit }));
      expect(redditReport.checks.sources).toEqual({
        status: "invalid",
        detail: "reddit: BRIGHTDATA_REDDIT_DATASET_ID is not a pinned dataset id",
      });
      expect(JSON.stringify(redditReport)).not.toContain("bd-token-value");
      const x = withEnv({ ...PEPPER, SOURCE_X_ENABLED: "true", X_BEARER_TOKEN: "x-token" });
      expect((await runHealthChecks(deps({ env: x }))).checks.sources).toEqual({
        status: "invalid",
        detail: "x: X_DAILY_READS_PER_PRODUCT is 0 or unset, so it makes no calls",
      });
      const xOn = withEnv({
        ...PEPPER,
        SOURCE_X_ENABLED: "true",
        X_BEARER_TOKEN: "x-token",
        X_DAILY_READS_PER_PRODUCT: "50",
      });
      expect((await runHealthChecks(deps({ env: xOn }))).checks.sources).toMatchObject({
        status: "ok",
        detail: "on: x",
      });
    });

    it("reports Reddit held back in production until the vendor's DPA date is set", async () => {
      const held = await runHealthChecks(deps({ env: withEnv({ SOURCE_REDDIT_ENABLED: "true" }) }));
      expect(held.ok).toBe(false);
      expect(held.checks.sources).toEqual({
        status: "missing",
        detail:
          "reddit stays off until BRIGHTDATA_DPA_SIGNED_ON holds the DPA date, YYYY-MM-DD and not in the future (docs/PLAN.md 2.1.7)",
      });
      const signed = withEnv({
        SOURCE_REDDIT_ENABLED: "true",
        BRIGHTDATA_DPA_SIGNED_ON: "2026-10-02",
        BRIGHTDATA_API_TOKEN: "bd-token-value",
        BRIGHTDATA_REDDIT_DATASET_ID: "gd_lvz8ah06191smkebj4",
        AUTHOR_HASH_PEPPER: "a-long-random-pepper-of-32-characters-plus",
      });
      expect((await runHealthChecks(deps({ env: signed }))).checks.sources).toEqual({
        status: "missing",
        detail:
          "reddit stays off until the privacy notice states how long Bright Data keeps snapshots (docs/PLAN.md 2.3.12)",
      });
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

  it("answers 401 to a wrong secret instead of looking healthy", async () => {
    const run = vi.fn();
    const handler = createHealthHandler({ cronSecret: CRON_SECRET, run });
    const response = await handler(request({ authorization: "Bearer not-the-right-secret" }));
    expect(response.status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it("answers 401 when the server's secret is too short for the cron to work at all", async () => {
    const run = vi.fn();
    const handler = createHealthHandler({ cronSecret: "short-secret", run });
    const response = await handler(request({ authorization: "Bearer short-secret" }));
    expect(response.status).toBe(401);
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
