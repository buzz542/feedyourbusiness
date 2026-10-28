import { z } from "zod";
import { DATA_NOT_INSTRUCTIONS_RULE, NEVER_INFER_RULE } from "@/server/llm/rules";
import { isSensitiveCommunity } from "@/sources/sensitive-communities";
import type { ProductDraft } from "./ports";

/**
 * The onboarding draft (docs/PLAN.md 8.3): the schema the model answers in, the prompt, and the
 * cleanup that turns an answer into what is saved. The schema keeps 8.3's counts; limits on single
 * items (term length, the subreddit pattern) are applied in normalizeDraft instead, so one stray
 * item is dropped rather than costing a retry of the whole draft.
 */

const INTENTS = ["problem", "category", "alternative", "competitor"] as const;

export const DraftSchema = z.object({
  name: z.string().min(1).max(120),
  one_liner: z.string().max(160),
  description: z.string().max(2000),
  audience: z.string().max(1000),
  competitors: z
    .array(z.object({ name: z.string().min(1).max(80), domain: z.string().max(253).nullable() }))
    .max(8),
  terms: z
    .array(z.object({ term: z.string().min(1).max(120), intent: z.enum(INTENTS) }))
    .min(20)
    .max(30),
  subreddits: z.array(z.string().max(40)).max(10),
});

export type RawDraft = z.infer<typeof DraftSchema>;

export const DRAFT_SYSTEM = `You set up AskedFor for a maker. AskedFor finds public posts where people ask for a product like the maker's, describe the problem it solves, or mention its competitors. From the maker's product page (or their own description of it) and its URL, draft the profile below. Return only the JSON the schema asks for.

${DATA_NOT_INSTRUCTIONS_RULE}

Fields:
- name: the product's name, as the page gives it.
- one_liner: what it does, in one plain sentence of at most 160 characters.
- description: what it does and for whom, in plain words, at most 2000 characters.
- audience: who it is for, at most 1000 characters.
- competitors: up to 8 products or companies people compare it with or use instead. Give the domain (like "example.com") only when you are sure of it, otherwise null. Products and companies only, never a person.
- terms: 20 to 30 search phrases, written the way people write when they need this product, not marketing keywords. For example: "looking for a tool to send invoices", "how do I get clients to pay on time", "is there an app that", "alternative to <competitor>". Each 2 to 60 characters, without quotation marks. intent is "problem" (describes the pain), "category" (names the kind of tool), "alternative" (asks for an alternative to a named product) or "competitor" (names a competitor). When there are competitors, include 3 to 6 "alternative to <competitor>" terms.
- subreddits: up to 10 subreddit names, without "r/", where this audience asks for tools or for help with this problem.

Rules:
- ${NEVER_INFER_RULE} Never suggest communities about health, sexuality, religion, politics, ethnicity or similar topics.
- If the page says little, draft from what it does say. Do not invent features.
- US English. Never use em dashes.`;

export function draftInput(
  url: string,
  source: { pageText: string } | { description: string },
): string {
  return "pageText" in source
    ? `Product URL: ${url}\n\nThe visible text of the product page:\n<page_text>\n${source.pageText}\n</page_text>`
    : `Product URL: ${url}\n\nThe maker's description of the product:\n<maker_description>\n${source.description}\n</maker_description>`;
}

const MAX_URL = 2048;

/**
 * The product URL as typed: "myproduct.com" and http:// become https://, the fragment goes. Null
 * for anything that is not a public web address we could store (products.url is https only).
 */
export function normalizeProductUrl(raw: string): string | null {
  let text = raw.trim();
  if (!text) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) text = `https://${text}`;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol === "http:") url.protocol = "https:";
  if (url.protocol !== "https:" || url.username || url.password) return null;
  if (!url.hostname.includes(".")) return null;
  url.hash = "";
  return url.href.length <= MAX_URL ? url.href : null;
}

/** No em or en dashes in what the user will see and edit (copy rules). */
const tidy = (s: string) =>
  s
    .replace(/\s*—\s*/g, ", ")
    .replace(/–/g, "-")
    .trim();
const oneLine = (s: string) => tidy(s).replace(/\s+/g, " ");

const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const bareDomain = (host: string) => host.replace(/^www\./, "").replace(/\.+$/, "");

/** "https://www.Example.com/pricing" -> "example.com"; null unless it is a plain domain. */
function cleanDomain(raw: string | null): string | null {
  if (!raw) return null;
  const host = bareDomain(
    raw
      .trim()
      .toLowerCase()
      .replace(/^[a-z]+:\/\//, "")
      .split(/[/?#]/)[0]!,
  );
  return DOMAIN.test(host) && host.length <= 253 ? host : null;
}

const SUBREDDIT = /^[A-Za-z0-9_]{2,21}$/;

export function normalizeDraft(raw: RawDraft, productUrl: string): ProductDraft {
  const ownHost = bareDomain(new URL(productUrl).hostname);
  const name = oneLine(raw.name).slice(0, 120) || ownHost;

  const termKeys = new Set<string>();
  const terms: ProductDraft["terms"] = [];
  for (const t of raw.terms) {
    const term = oneLine(t.term);
    const key = term.toLowerCase();
    if (term.length < 2 || term.length > 60 || termKeys.has(key)) continue;
    termKeys.add(key);
    terms.push({ term, intent: t.intent });
  }

  const competitorKeys = new Set([name.toLowerCase()]);
  const competitors: ProductDraft["competitors"] = [];
  for (const c of raw.competitors) {
    const competitorName = oneLine(c.name).slice(0, 80);
    const key = competitorName.toLowerCase();
    const domain = cleanDomain(c.domain);
    if (!competitorName || competitorKeys.has(key) || domain === ownHost) continue;
    competitorKeys.add(key);
    competitors.push({ name: competitorName, domain });
  }

  const subredditKeys = new Set<string>();
  const subreddits: string[] = [];
  for (const s of raw.subreddits) {
    const sub = s.trim().replace(/^\/?r\//i, "");
    const key = sub.toLowerCase();
    const profile = key.startsWith("u_");
    if (!SUBREDDIT.test(sub) || profile || subredditKeys.has(key) || isSensitiveCommunity(sub))
      continue;
    subredditKeys.add(key);
    subreddits.push(sub);
  }

  return {
    name,
    oneLiner: oneLine(raw.one_liner).slice(0, 160),
    description: tidy(raw.description).slice(0, 2000),
    audience: tidy(raw.audience).slice(0, 1000),
    competitors: competitors.slice(0, 8),
    terms: terms.slice(0, 30),
    subreddits: subreddits.slice(0, 10),
  };
}
