import type { LlmClient, UsageRow, UsageStore } from "@/server/llm/ports";
import { createLlm } from "@/server/llm/llm";
import { OwnSiteError } from "@/server/net/own-site-error";
import type { Draft, DraftDeps, DraftStore } from "@/server/onboarding/draft";

/**
 * Fake external services for localhost E2E (docs/TASKS.md M2): the onboarding draft runs without
 * fetching a site or calling the model. Honored only when E2E_FAKE_SERVICES is exactly "1", no
 * Vercel environment is set (no deployment of any kind), the server is `next dev` and the site URL
 * is localhost.
 */

type Env = Readonly<Record<string, string | undefined>>;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function fakeServicesEnabled(env: Env = process.env): boolean {
  // `next dev` only: a production build (next start, any deployment) never fakes a service.
  if (env.E2E_FAKE_SERVICES !== "1" || env.VERCEL_ENV || env.NODE_ENV !== "development")
    return false;
  try {
    return LOCAL_HOSTS.has(new URL(env.NEXT_PUBLIC_SITE_URL ?? "").hostname);
  } catch {
    return false;
  }
}

/** An invented product page. */
const FAKE_PAGE = `<!doctype html><html><head><title>Invoicer | Invoices that chase themselves</title>
<meta name="description" content="Invoicer sends polite reminders until your clients pay."></head>
<body><h1>Get paid on time</h1><p>A small tool for freelancers who send invoices.</p>
<h2>How it works</h2><p>Add your clients and your invoices. Invoicer sends a friendly reminder when a
payment is late, then another a week later, and stops the moment the client pays.</p></body></html>`;

const FAKE_DRAFT: Draft = {
  name: "Invoicer",
  one_liner: "Polite invoice reminders that run until clients pay",
  description:
    "Invoicer sends friendly reminders for unpaid invoices so freelancers do not have to chase clients themselves.",
  audience: "Freelance designers and developers",
  competitors: [
    { name: "Ledgerly", domain: "ledgerly.example" },
    { name: "Billwise", domain: null },
  ],
  terms: [
    { term: "alternative to Ledgerly", intent: "alternative" },
    { term: "alternative to Billwise", intent: "alternative" },
    { term: "Ledgerly too expensive", intent: "competitor" },
    ...[
      "how do I chase an unpaid invoice",
      "client will not pay my invoice",
      "invoice reminder tool",
      "automatic payment reminders",
      "looking for a tool to send invoice reminders",
      "late payment reminder email",
      "how to get clients to pay on time",
      "freelance invoice software",
      "tired of chasing clients for money",
      "overdue invoice follow up",
      "is there an app that reminds clients to pay",
      "late fees for freelancers",
      "polite payment reminder",
      "invoice follow up template",
      "recurring invoice reminders",
      "unpaid invoices freelance",
      "get paid faster as a freelancer",
      "payment chasing tool",
      "net 30 clients paying late",
      "how to ask a client for payment",
      "small business invoice reminders",
    ].map((term) => ({ term, intent: "problem" as const })),
  ],
  subreddits: ["freelance", "smallbusiness", "depression", "Entrepreneur"],
};

const fakeClient: LlmClient = {
  async create() {
    return {
      stopReason: "end_turn",
      text: JSON.stringify(FAKE_DRAFT),
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    };
  },
};

/** Usage kept in memory: fake calls cost nothing and never touch llm_usage. */
function memoryUsage(): UsageStore {
  const rows: UsageRow[] = [];
  return {
    record: async (row) => void rows.push(row),
    spendSince: async () => 0,
  };
}

export function createFakeDraftDeps(store: DraftStore): DraftDeps {
  return {
    llm: createLlm({ client: fakeClient, usage: memoryUsage(), clock: () => new Date() }),
    async fetchSite(url) {
      if (new URL(url).hostname === "unreachable.example") throw new OwnSiteError("network");
      return { url, contentType: "text/html", text: FAKE_PAGE };
    },
    store,
    clock: () => new Date(),
  };
}
