import { z } from "zod";
import { LlmCapError, LlmOutputError, LlmRefusalError, type Llm } from "@/server/llm/llm";
import { NEVER_INFER_RULE, UNTRUSTED_INPUT_RULE } from "@/server/llm/rules";
import {
  normalizeProductUrl,
  OwnSiteError,
  type OwnSiteErrorCode,
  type OwnSitePage,
} from "@/server/net/own-site";
import { isProfileCommunity, isSensitiveCommunity } from "@/sources/sensitive-communities";
import { pageText } from "./page-text";

/**
 * The onboarding draft (docs/PLAN.md 4.3, 8.3): from the user's own page to a draft product profile
 * (name, summary, audience, competitors, 20 to 30 search terms, suggested subreddits) in at most two
 * minutes. The product stays a draft: nothing is collected until the user confirms it (and is
 * entitled), so this module never creates a job and never changes the product's status.
 */

export const DRAFT_BUDGET_MS = 120_000;
const DRAFT_MODEL = "claude-sonnet-5-5" as const;
const MAX_TERMS = 30;
const MAX_COMPETITORS = 8;
const MAX_SUBREDDITS = 10;
/** The pasted description: enough to draft from, and at most this many characters sent. */
const MIN_DESCRIPTION = 20;
export const MAX_DESCRIPTION = 5_000;

/** The model's output (8.3). */
export const DraftSchema = z.object({
  name: z.string().min(1).max(120),
  one_liner: z.string().max(160),
  description: z.string().max(2000),
  audience: z.string().max(1000),
  competitors: z
    .array(z.object({ name: z.string().min(1).max(80), domain: z.string().max(253).nullable() }))
    .max(8),
  terms: z
    .array(
      z.object({
        term: z.string().min(2).max(60),
        intent: z.enum(["problem", "category", "alternative", "competitor"]),
      }),
    )
    .min(20)
    .max(30),
  subreddits: z.array(z.string().regex(/^[A-Za-z0-9_]{2,21}$/)).max(10),
});
export type Draft = z.infer<typeof DraftSchema>;
export type TermIntent = Draft["terms"][number]["intent"];

/** What is saved: the model's draft after the checks in cleanDraft(). */
export interface CleanDraft {
  name: string;
  one_liner: string;
  description: string;
  audience: string;
  competitors: { name: string; domain: string | null }[];
  terms: { term: string; intent: TermIntent }[];
  subreddits: string[];
}

export interface DraftStore {
  /** The caller's product while it is still a draft, created for `url` if there is none. */
  ensureDraftProduct(url: string): Promise<{ productId: string } | "confirmed">;
  /** Replaces the draft's profile, terms and draft competitors in one transaction. */
  saveDraft(productId: string, draft: CleanDraft): Promise<void>;
}

export interface DraftDeps {
  llm: Llm;
  fetchSite(url: string): Promise<OwnSitePage>;
  store: DraftStore;
  clock: () => Date;
  /** Tests shorten it; production uses DRAFT_BUDGET_MS. */
  budgetMs?: number;
}

export type DraftFailure =
  | { ok: false; reason: "invalid_url" }
  | { ok: false; reason: "invalid_description" }
  | { ok: false; reason: "already_confirmed" }
  | { ok: false; reason: "site_unreachable"; productId: string; siteError: OwnSiteErrorCode }
  | { ok: false; reason: "spend_cap" | "declined" | "failed" | "timeout" };

export type DraftResult = { ok: true; productId: string; draft: CleanDraft } | DraftFailure;

export const DRAFT_SYSTEM = [
  "You draft the product profile for AskedFor, which finds public posts where people ask for what " +
    "an indie maker's product does.",
  "From the product's web page (or the maker's own description) and its URL, write:",
  "- name: the product's name.",
  "- one_liner: what it does, in one plain sentence of at most 160 characters.",
  "- description: two to four plain sentences on what it does and who it is for.",
  "- audience: who it is for, in a phrase or two.",
  "- competitors: up to 8 products or companies it competes with, each with its domain when you " +
    "are confident of it, otherwise null. Products or companies only, never people.",
  "- terms: 20 to 30 short phrases people actually write in posts when they need this product: " +
    'questions and complaints such as "looking for a tool to ...", "how do I ...", "is there an ' +
    'app that ...", "tired of ...". Not marketing keywords or slogans. Label each with its intent: ' +
    'problem (describes the pain), category (names the kind of tool), alternative ("alternative ' +
    'to <rival>"), competitor (names a rival). When there are competitors, include 3 to 6 ' +
    '"alternative to <rival>" terms. Each term is 2 to 60 characters.',
  '- subreddits: up to 10 subreddit names, without "r/", where this audience asks for help. Never ' +
    "a community about health, sexuality, religion, politics, ethnicity or another sensitive topic, " +
    "and never a user profile.",
  "Use plain US English. Use only what the page says and common knowledge about the category; do " +
    "not invent features, numbers or customers.",
  NEVER_INFER_RULE,
  UNTRUSTED_INPUT_RULE,
  "Output only the JSON object the schema describes.",
].join("\n");

const squash = (text: string) => text.replace(/\s+/g, " ").trim();
const key = (text: string) => squash(text).toLowerCase();

/** A competitor domain as a bare host ("https://www.Example.com/x" becomes "example.com"), or null. */
export function normalizeDomain(raw: string | null): string | null {
  if (!raw) return null;
  const host = raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .split(/[/?#]/)[0]!
    .replace(/:\d+$/, "")
    .replace(/^www\./, "")
    .replace(/\.+$/, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) && host.length <= 253 ? host : null;
}

/**
 * The checks between the model and the database: squashed whitespace, duplicates dropped (case and
 * spacing ignored), the product itself never listed as its own rival, competitor domains reduced to
 * a bare host, and suggested subreddits filtered through the sensitive-community list and the
 * profile rule (2.3.7).
 */
export function cleanDraft(draft: Draft, fallbackName = "My product"): CleanDraft {
  const name = squash(draft.name).slice(0, 120) || fallbackName.slice(0, 120);

  const seenTerms = new Set<string>();
  const terms: CleanDraft["terms"] = [];
  for (const { term, intent } of draft.terms) {
    const t = squash(term);
    if (t.length < 2 || t.length > 60 || seenTerms.has(t.toLowerCase())) continue;
    seenTerms.add(t.toLowerCase());
    terms.push({ term: t, intent });
    if (terms.length === MAX_TERMS) break;
  }

  const seenRivals = new Set<string>([key(name)]);
  const competitors: CleanDraft["competitors"] = [];
  for (const competitor of draft.competitors) {
    const n = squash(competitor.name).slice(0, 80);
    if (!n || seenRivals.has(n.toLowerCase())) continue;
    seenRivals.add(n.toLowerCase());
    competitors.push({ name: n, domain: normalizeDomain(competitor.domain) });
    if (competitors.length === MAX_COMPETITORS) break;
  }

  const seenSubs = new Set<string>();
  const subreddits: string[] = [];
  for (const sub of draft.subreddits) {
    const s = sub.trim();
    if (seenSubs.has(s.toLowerCase()) || isSensitiveCommunity(s) || isProfileCommunity(s)) continue;
    seenSubs.add(s.toLowerCase());
    subreddits.push(s);
    if (subreddits.length === MAX_SUBREDDITS) break;
  }

  return {
    name,
    one_liner: squash(draft.one_liner).slice(0, 160),
    description: draft.description.trim().slice(0, 2000),
    audience: draft.audience.trim().slice(0, 1000),
    competitors,
    terms,
    subreddits,
  };
}

/** Page text inside <page> tags, with any tag that could close them defused. */
function draftInput(url: string, text: string): string {
  const safe = text.replace(/<(\/?)page\b/gi, "<$1 page");
  return `<url>${url}</url>\n<page>\n${safe}\n</page>`;
}

/** The model call and the save, shared by the URL and the pasted-description paths. */
async function runDraft(
  input: { productId: string; url: string; text: string; fallbackName: string },
  started: number,
  deps: DraftDeps,
): Promise<DraftResult> {
  const budget = deps.budgetMs ?? DRAFT_BUDGET_MS;
  // Leave a little of the budget for saving.
  const margin = Math.min(5_000, budget / 10);
  const signal = AbortSignal.timeout(
    Math.max(1, budget - margin - (deps.clock().getTime() - started)),
  );

  let draft: Draft;
  try {
    draft = await deps.llm.callStructured({
      task: "draft",
      productId: input.productId,
      model: DRAFT_MODEL,
      system: [{ text: DRAFT_SYSTEM, cache: false }],
      input: draftInput(input.url, input.text),
      schema: DraftSchema,
      maxTokens: 16_000,
      effort: "medium",
      signal,
    });
  } catch (error) {
    if (error instanceof LlmCapError) return { ok: false, reason: "spend_cap" };
    if (error instanceof LlmRefusalError) return { ok: false, reason: "declined" };
    if (error instanceof LlmOutputError) return { ok: false, reason: "failed" };
    if (signal.aborted) return { ok: false, reason: "timeout" };
    return { ok: false, reason: "failed" };
  }

  const clean = cleanDraft(draft, input.fallbackName);
  await deps.store.saveDraft(input.productId, clean);
  return { ok: true, productId: input.productId, draft: clean };
}

/** Step 2 and 3 of onboarding (4.3): fetch the user's page once and draft the profile from it. */
export async function draftFromUrl(rawUrl: string, deps: DraftDeps): Promise<DraftResult> {
  const started = deps.clock().getTime();
  const url = normalizeProductUrl(rawUrl);
  if (!url) return { ok: false, reason: "invalid_url" };

  // The product row comes first, so the model call counts against this product's spend cap.
  const product = await deps.store.ensureDraftProduct(url);
  if (product === "confirmed") return { ok: false, reason: "already_confirmed" };

  let page: OwnSitePage;
  try {
    page = await deps.fetchSite(url);
  } catch (error) {
    if (error instanceof OwnSiteError)
      return {
        ok: false,
        reason: "site_unreachable",
        productId: product.productId,
        siteError: error.code,
      };
    throw error;
  }

  return runDraft(
    {
      productId: product.productId,
      url: page.url,
      text: pageText(page.text, page.contentType),
      fallbackName: new URL(url).hostname,
    },
    started,
    deps,
  );
}

/** The fallback when the site cannot be fetched (4.3): the same draft from the maker's own words. */
export async function draftFromDescription(
  input: { url: string; description: string },
  deps: DraftDeps,
): Promise<DraftResult> {
  const started = deps.clock().getTime();
  const url = normalizeProductUrl(input.url);
  if (!url) return { ok: false, reason: "invalid_url" };
  const description = input.description.trim().slice(0, MAX_DESCRIPTION);
  if (description.length < MIN_DESCRIPTION) return { ok: false, reason: "invalid_description" };

  const product = await deps.store.ensureDraftProduct(url);
  if (product === "confirmed") return { ok: false, reason: "already_confirmed" };

  return runDraft(
    {
      productId: product.productId,
      url,
      text: `Description from the maker:\n${description}`,
      fallbackName: new URL(url).hostname,
    },
    started,
    deps,
  );
}
