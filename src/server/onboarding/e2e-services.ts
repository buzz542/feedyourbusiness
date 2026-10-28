import { isLocalDevServer } from "@/server/auth/local-env";
import { fakeMessage, FakeUsageStore } from "@/server/llm/fakes";
import { createLlm } from "@/server/llm/llm";
import type { LlmClient } from "@/server/llm/ports";
import { createFetchOwnSite, type RawResponse } from "@/server/net/own-site";
import { rawDraft } from "./fakes";
import type { OnboardingDeps } from "./service";

/**
 * E2E_FAKE_SERVICES=1 (docs/TASKS.md M2): the localhost E2E drafts from a fixture page with a
 * canned model, so it needs no API key and spends nothing. Honored only on a developer's own dev
 * server: never on Vercel, never for a site that is not localhost, never in a production build.
 */
export function fakeServicesEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.E2E_FAKE_SERVICES === "1" && env.NODE_ENV !== "production" && isLocalDevServer(env);
}

const FIXTURE_PAGE = `<!doctype html><html><head><title>E2E Product: invoices that get paid</title>
<meta name="description" content="An invented product page for the localhost E2E."></head>
<body><main><h1>Invoices that get paid on time</h1>
<p>An invented invoicing tool that sends invoices, reminds late clients and takes card payments.</p>
<p>For freelancers and small studios who bill a handful of clients each month.</p></main></body></html>`;

/** The real fetchOwnSite checks (platform hosts, schemes, ports), then the fixture page. */
function fixtureFetch() {
  return createFetchOwnSite({
    resolve: async () => [{ address: "93.184.215.14", family: 4 }],
    transport: async () => {
      const response: RawResponse = {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
        body: (async function* () {
          yield new TextEncoder().encode(FIXTURE_PAGE);
        })(),
        abort: () => {},
      };
      return response;
    },
  });
}

const cannedModel: LlmClient = {
  async createMessage(params) {
    return fakeMessage({ text: JSON.stringify(rawDraft({ name: "E2E Product" })) }, params.model);
  },
};

export function fakeOnboardingServices(): Pick<OnboardingDeps, "llm" | "fetchSite"> {
  return {
    fetchSite: fixtureFetch(),
    llm: createLlm({
      client: cannedModel,
      usage: new FakeUsageStore(),
      clock: () => new Date(),
      caps: { productMonthlyUsd: 3, globalDailyUsd: 25 },
    }),
  };
}
