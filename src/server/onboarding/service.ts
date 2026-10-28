import { LlmCapError, type Llm } from "@/server/llm/llm";
import { OwnSiteError, type OwnSitePage } from "@/server/net/own-site";
import {
  DRAFT_SYSTEM,
  DraftSchema,
  draftInput,
  normalizeDraft,
  normalizeProductUrl,
} from "./draft";
import { extractPageText } from "./page-text";
import type { OnboardingStore } from "./ports";

/**
 * Onboarding steps 2 and 3 (docs/PLAN.md 4.3, 8.3): the product URL, or a pasted description when
 * the page cannot be read, becomes a saved draft within the 2 minute budget. The product stays a
 * draft: nothing is collected until the owner confirms it, and only for an entitled account.
 */

export type DraftOutcome =
  | { kind: "saved"; productId: string }
  | { kind: "invalid_url" }
  | { kind: "invalid_description" }
  | { kind: "needs_description"; reason: "fetch_failed" | "platform_page" | "too_little_text" }
  | { kind: "already_confirmed" }
  | { kind: "busy" }
  | { kind: "timed_out" }
  | { kind: "failed" };

/** Less visible text than this is an app shell drawn by scripts, not a page to draft from. */
const MIN_PAGE_TEXT = 200;
export const DESCRIPTION_LENGTH = { min: 40, max: 5000 } as const;
const BUDGET_MS = 120_000;
const MAX_TOKENS = 16_000;

export interface OnboardingDeps {
  store: OnboardingStore;
  llm: Llm;
  fetchSite: (url: string) => Promise<OwnSitePage>;
  budgetMs?: number;
}

export function createOnboarding(deps: OnboardingDeps) {
  const { store, llm, fetchSite } = deps;
  const budgetMs = deps.budgetMs ?? BUDGET_MS;

  /** The owner's draft product, created when there is none. Null once it has been confirmed. */
  async function draftProductId(
    userId: string,
    existing: { id: string; status: string } | null,
    url: string,
  ): Promise<string | null> {
    if (existing) return existing.status === "draft" ? existing.id : null;
    const created = await store.createDraftProduct(userId, { url, name: new URL(url).hostname });
    if (created) return created;
    // Another request created it first (one per owner, D9).
    const raced = await store.findProduct(userId);
    return raced?.status === "draft" ? raced.id : null;
  }

  async function draft(
    userId: string,
    url: string,
    existing: { id: string; status: string } | null,
    source: { pageText: string } | { description: string },
    signal: AbortSignal,
  ): Promise<DraftOutcome> {
    try {
      const productId = await draftProductId(userId, existing, url);
      if (!productId) return { kind: "already_confirmed" };
      const { output } = await llm.callStructured({
        task: "draft",
        productId,
        model: "claude-sonnet-5-5",
        system: [{ text: DRAFT_SYSTEM }],
        input: draftInput(url, source),
        schema: DraftSchema,
        maxTokens: MAX_TOKENS,
        effort: "medium",
        signal,
      });
      await store.saveDraft(productId, url, normalizeDraft(output, url));
      return { kind: "saved", productId };
    } catch (error) {
      if (signal.aborted) return { kind: "timed_out" };
      if (error instanceof LlmCapError) return { kind: "busy" };
      console.error(
        `[onboarding] draft failed: ${error instanceof Error ? error.name : "UnknownError"}`,
      );
      return { kind: "failed" };
    }
  }

  return {
    async draftFromUrl(userId: string, rawUrl: string): Promise<DraftOutcome> {
      const url = normalizeProductUrl(rawUrl);
      if (!url) return { kind: "invalid_url" };
      const signal = AbortSignal.timeout(budgetMs);
      const existing = await store.findProduct(userId);
      if (existing && existing.status !== "draft") return { kind: "already_confirmed" };

      let page: OwnSitePage;
      try {
        page = await fetchSite(url);
      } catch (error) {
        const platform = error instanceof OwnSiteError && error.code === "platform_host";
        return { kind: "needs_description", reason: platform ? "platform_page" : "fetch_failed" };
      }
      const pageText = extractPageText(page.body, page.contentType);
      if (pageText.length < MIN_PAGE_TEXT)
        return { kind: "needs_description", reason: "too_little_text" };
      return draft(userId, url, existing, { pageText }, signal);
    },

    async draftFromDescription(
      userId: string,
      rawUrl: string,
      rawDescription: string,
    ): Promise<DraftOutcome> {
      const url = normalizeProductUrl(rawUrl);
      if (!url) return { kind: "invalid_url" };
      const description = rawDescription.trim();
      if (
        description.length < DESCRIPTION_LENGTH.min ||
        description.length > DESCRIPTION_LENGTH.max
      )
        return { kind: "invalid_description" };
      const signal = AbortSignal.timeout(budgetMs);
      const existing = await store.findProduct(userId);
      if (existing && existing.status !== "draft") return { kind: "already_confirmed" };
      return draft(userId, url, existing, { description }, signal);
    },
  };
}

export type Onboarding = ReturnType<typeof createOnboarding>;
