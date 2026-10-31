import "server-only";
import type { LlmClient, LlmReply } from "@/server/llm/ports";
import type { OwnSitePage } from "@/server/net/own-site";
import { OwnSiteError } from "@/server/net/own-site";

/**
 * Fake model and site for localhost E2E (docs/TASKS.md M2, onboarding UI). Honored only when
 * E2E_FAKE_SERVICES is exactly "1", no Vercel environment is set (production, preview and
 * development deployments alike) and the site URL is localhost, so no deployment can ever answer a
 * user with invented data. Nothing here opens a connection.
 */

type Env = Readonly<Record<string, string | undefined>>;

export function fakeServicesAllowed(env: Env = process.env): boolean {
  if (env.E2E_FAKE_SERVICES !== "1" || env.VERCEL_ENV !== undefined) return false;
  try {
    const site = new URL(env.NEXT_PUBLIC_SITE_URL ?? "");
    return (
      site.protocol === "http:" && (site.hostname === "localhost" || site.hostname === "127.0.0.1")
    );
  } catch {
    return false;
  }
}

/** An invented product, the same for every paste. */
export const FAKE_DRAFT = {
  name: "Invoicer",
  one_liner: "Invoices from a photo of a receipt, for freelancers.",
  description: "Invoicer turns a photo of a receipt into an invoice you can send in a minute.",
  audience: "Freelancers and small agencies who bill clients.",
  competitors: [
    { name: "Billfast", domain: "billfast.example", aliases: ["Billfast App"] },
    { name: "Ledgerly", domain: null, aliases: [] },
  ],
  terms: Array.from({ length: 22 }, (_, i) => ({
    term: i === 0 ? "alternative to Billfast" : `how do I send invoice number ${i}`,
    intent: i === 0 ? ("alternative" as const) : ("problem" as const),
  })),
  subreddits: ["freelance", "smallbusiness"],
};

export const fakeLlmClient: LlmClient = {
  async complete(): Promise<LlmReply> {
    return {
      stopReason: "end_turn",
      text: JSON.stringify(FAKE_DRAFT),
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    };
  },
};

/** Any site reads as one invented page; a host ending in ".unreadable.example" cannot be read. */
export async function fakeFetchPage(url: string): Promise<OwnSitePage> {
  const host = new URL(url).hostname;
  if (host.endsWith(".unreadable.example") || new URL(url).pathname === "/robots.txt")
    throw new OwnSiteError("http_status", host, "404", 404);
  return {
    url,
    contentType: "text/html",
    body: "<html><title>Invoicer</title><body><p>Invoices from a photo of a receipt.</p></body></html>",
  };
}
