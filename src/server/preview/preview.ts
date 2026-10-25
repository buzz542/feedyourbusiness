import { toLabel } from "@/server/classify/classify";
import { classificationSystem } from "@/server/classify/prompt";
import { ClassificationSchema } from "@/server/classify/schema";
import type { Llm } from "@/server/llm/llm";
import { normalizeProductUrl } from "@/server/net/own-site";
import { embedsPlatformUrl, isPlatformHost } from "@/server/net/platform-hosts";
import { textProblem } from "@/server/synthesis/checks";
import type { CollectContext, CollectSource } from "@/sources/types";
import {
  PREVIEW_DRAFT_SYSTEM,
  PREVIEW_THEME_SYSTEM,
  PreviewDraftSchema,
  PreviewResult,
  PreviewThemeSchema,
} from "./schema";

/**
 * The instant preview (docs/PLAN.md 8.5, 12.7): paste a URL, see up to 5 real posts from the last
 * week. Hacker News and Bluesky only: Reddit and X cost money per record, so they can never be
 * called from here. 3 previews per IP hash per day and a global daily cap. Results pass the same
 * filters as ingest (relevance 40 or more, suppressed authors and NSFW dropped, 280-character
 * excerpts) and are stored for 24 hours at most, with no author fields.
 */

export const PREVIEW_SOURCES = ["hackernews", "bluesky"] as const;
export const PER_IP_DAILY = 3;
const DEFAULT_GLOBAL_CAP = 200;
const PER_SOURCE_BUDGET = 40;
const MAX_CANDIDATES = 40;
const BATCH = 20;
const PREVIEW_MODEL = "claude-haiku-5-5" as const;

export interface PreviewDeps {
  llm: Llm;
  /** The page text of the user's own site (fetchOwnSite + pageText). Throws when unreachable. */
  siteText(url: string): Promise<string>;
  /** Registered collect sources whose kill switch is on; only Hacker News and Bluesky are used. */
  sources: readonly CollectSource[];
  fetchFor(source: CollectSource): CollectContext["fetch"];
  credential(name: string): string | undefined;
  hash(source: string, authorKey: string): string;
  suppressed(pairs: readonly { source: string; authorHash: string }[]): Promise<Set<string>>;
  store: {
    countIp(ipHash: string, since: Date): Promise<number>;
    countAll(since: Date): Promise<number>;
    /** Records the attempt before any paid work, so failed runs count toward the limits too. */
    start(row: { ipHash: string; urlHost: string }): Promise<string>;
    finish(id: string, result: PreviewResult): Promise<void>;
  };
  globalCap?: number;
  userAgent: string;
  sleep?: (ms: number) => Promise<void>;
}

export type PreviewOutcome =
  | { ok: true; result: PreviewResult }
  | {
      ok: false;
      reason:
        | "invalid_url"
        | "platform_url"
        | "rate_limited"
        | "busy"
        | "site_unreachable"
        | "unavailable";
    };

const DAY = 86_400_000;

export async function runPreview(
  deps: PreviewDeps,
  rawUrl: unknown,
  ipHash: string,
  now: Date,
): Promise<PreviewOutcome> {
  const normalized = typeof rawUrl === "string" ? normalizeProductUrl(rawUrl) : null;
  if (!normalized) return { ok: false, reason: "invalid_url" };
  const url = new URL(normalized);
  if (isPlatformHost(url.hostname) || embedsPlatformUrl(url))
    return { ok: false, reason: "platform_url" };

  const since = new Date(now.getTime() - DAY);
  if ((await deps.store.countIp(ipHash, since)) >= PER_IP_DAILY)
    return { ok: false, reason: "rate_limited" };
  if ((await deps.store.countAll(since)) >= (deps.globalCap ?? DEFAULT_GLOBAL_CAP))
    return { ok: false, reason: "busy" };

  const runId = await deps.store.start({ ipHash, urlHost: url.hostname });
  let text: string;
  try {
    text = await deps.siteText(normalized);
  } catch {
    return { ok: false, reason: "site_unreachable" };
  }

  try {
    const draft = await deps.llm.callStructured({
      task: "preview",
      productId: null,
      model: PREVIEW_MODEL,
      system: [{ text: PREVIEW_DRAFT_SYSTEM, cache: false }],
      input: `<page url="${url.host}">${text.slice(0, 20_000)}</page>`,
      schema: PreviewDraftSchema,
      maxTokens: 800,
    });

    // Hacker News and Bluesky only, whatever else is switched on.
    const usable = deps.sources.filter((s) =>
      (PREVIEW_SOURCES as readonly string[]).includes(s.id),
    );
    const terms = draft.terms.slice(0, 8).map((term, i) => ({ id: `t${i}`, term }));
    const candidates: {
      id: string;
      source: string;
      url: string;
      community: string | null;
      excerpt: string;
      authorHash: string;
    }[] = [];
    for (const source of usable) {
      const ctx: CollectContext = {
        fetch: deps.fetchFor(source),
        terms,
        since: new Date(now.getTime() - 7 * DAY),
        budget: PER_SOURCE_BUDGET,
        now,
        userAgent: deps.userAgent,
        sleep: deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
        credential: (name) =>
          source.credentials.includes(name) ? deps.credential(name) : undefined,
      };
      const state = await source.start(ctx).catch(() => null);
      if (!state || state.kind !== "done") continue;
      for (const post of state.posts) {
        if (post.nsfw) continue;
        candidates.push({
          id: `p${candidates.length}`,
          source: source.id,
          url: post.url,
          community: post.community,
          excerpt: post.excerpt.slice(0, 280),
          authorHash: deps.hash(source.id, post.authorKey),
        });
      }
    }
    const blocked = await deps.suppressed(
      candidates.map((c) => ({ source: c.source, authorHash: c.authorHash })),
    );
    const allowed = candidates
      .filter((c) => !blocked.has(`${c.source}|${c.authorHash}`))
      .slice(0, MAX_CANDIDATES);

    const product = {
      name: draft.name,
      oneLiner: draft.one_liner,
      description: "",
      audience: "",
      competitors: [],
    };
    const labeled: {
      c: (typeof allowed)[number];
      label: NonNullable<ReturnType<typeof toLabel>>;
    }[] = [];
    for (let i = 0; i < allowed.length; i += BATCH) {
      const batch = allowed.slice(i, i + BATCH);
      const items = batch.map((c) => ({
        id: c.id,
        source: c.source,
        community: c.community,
        excerpt: c.excerpt,
      }));
      const reply = await deps.llm.callStructured({
        task: "preview",
        productId: null,
        model: PREVIEW_MODEL,
        system: classificationSystem(product),
        input: `<posts>${JSON.stringify(items)}</posts>`,
        schema: ClassificationSchema,
        maxTokens: 8_000,
      });
      const byId = new Map(items.map((it) => [it.id, it]));
      for (const result of reply.results) {
        const item = byId.get(result.id);
        const c = batch.find((b) => b.id === result.id);
        if (!item || !c || labeled.some((l) => l.c.id === c.id)) continue;
        const label = toLabel(result, item, new Map());
        if (label && label.category !== "not_relevant" && label.relevance >= 40)
          labeled.push({ c, label });
      }
    }
    const top = labeled.sort((a, b) => b.label.relevance - a.label.relevance).slice(0, 5);

    let theme: PreviewResult["theme"] = null;
    if (top.length >= 2) {
      const excerpts = top.map((t) => t.c.excerpt);
      const reply = await deps.llm
        .callStructured({
          task: "preview",
          productId: null,
          model: PREVIEW_MODEL,
          system: [{ text: PREVIEW_THEME_SYSTEM, cache: false }],
          input: `<posts>${JSON.stringify(excerpts)}</posts>`,
          schema: PreviewThemeSchema,
          maxTokens: 400,
        })
        .catch(() => null);
      if (reply && !textProblem(`${reply.title}\n${reply.summary}`, excerpts)) theme = reply;
    }

    const result = PreviewResult.parse({
      name: draft.name,
      one_liner: draft.one_liner,
      posts: top.map(({ c, label }) => ({
        url: c.url,
        source: c.source,
        community: c.community,
        excerpt: c.excerpt,
        category: label.category,
        reason: label.reason,
        relevance: label.relevance,
        highlight_start: label.highlight?.start ?? null,
        highlight_end: label.highlight?.end ?? null,
      })),
      theme,
    });
    await deps.store.finish(runId, result);
    return { ok: true, result };
  } catch (error) {
    console.error(`[preview] failed: ${error instanceof Error ? error.name : "Unknown"}`);
    return { ok: false, reason: "unavailable" };
  }
}
