import type { Issue } from "@/server/classify/schema";
import { LlmCapError, LlmRefusalError, type Llm } from "@/server/llm/llm";
import type { JobHandler } from "@/server/pipeline/ports";
import { previousWeek, textProblem, trendFor, weekOf } from "./checks";
import { BUILD_SYSTEM, RIVAL_SYSTEM } from "./prompt";
import {
  BuildSynthesisSchema,
  RivalSynthesisSchema,
  type BuildSynthesis,
  type RivalSynthesis,
} from "./schema";

/**
 * Weekly synthesis (docs/PLAN.md 8.4): one Sonnet call for Build and one for Rivals per product
 * with 5 or more relevant posts that week. Counts come from our labels, not the model; trends are
 * against last week's rows with the same key; post ids we did not send are dropped; a summary that
 * quotes an excerpt (8 or more consecutive words) or carries a handle is regenerated once, then
 * dropped. Re-running a week replaces that week's rows.
 */

export const SYNTH_MODEL = "claude-sonnet-5-5" as const;
const MAX_TOKENS = 6_000;
const MAX_POSTS = 150;
export const MIN_POSTS = 5;

export interface WeekPost {
  id: string;
  category: string;
  excerpt: string;
  competitorId: string | null;
  toolMentioned: string | null;
  rival: { issue: Issue; sentiment: "negative" | "mixed" | "positive"; switching: boolean } | null;
}

export interface ThemeRow {
  kind: "ask" | "wish" | "pain" | "opportunity" | "rival_fix";
  themeKey: string;
  title: string;
  summary: string;
  count: number;
  trend: "new" | "up" | "down" | "flat";
  examplePostIds: string[];
}

export interface RivalRow {
  competitorId: string | null;
  toolName: string | null;
  issue: Issue;
  complaints: number;
  switching: number;
  trend: "new" | "up" | "down" | "flat";
  summary: string;
  examplePostIds: string[];
}

export interface SynthesisStore {
  product(productId: string): Promise<{
    name: string;
    oneLiner: string | null;
    competitors: { id: string; name: string }[];
  } | null>;
  /** This week's stored relevant posts for the product, best first. */
  weekPosts(productId: string, since: Date, until: Date, limit: number): Promise<WeekPost[]>;
  lastThemes(
    productId: string,
    week: string,
  ): Promise<{ kind: string; themeKey: string | null; count: number }[]>;
  lastRivals(
    productId: string,
    week: string,
  ): Promise<
    { competitorId: string | null; toolName: string | null; issue: string; complaints: number }[]
  >;
  /** Replaces the week's themes for the product. */
  saveThemes(productId: string, week: string, rows: ThemeRow[]): Promise<void>;
  /** Replaces the week's rival insights for the product. */
  saveRivals(productId: string, week: string, rows: RivalRow[]): Promise<void>;
}

const rivalKey = (competitorId: string | null, tool: string | null) =>
  competitorId ? `c:${competitorId}` : `t:${(tool ?? "").toLowerCase()}`;

/** Monday 00:00 London for the week, as a UTC instant (close enough for a 7-day window start). */
const weekStart = (week: string) => new Date(`${week}T00:00:00Z`);

type Problem = { where: string; problem: "quote" | "handle" };

/** One call, regenerated once if any text quotes an excerpt or has a handle. */
async function callChecked<T>(
  llm: Llm,
  call: Parameters<Llm["callStructured"]>[0] & { schema: import("zod").ZodType<T> },
  problemsOf: (reply: T) => Problem[],
): Promise<T> {
  const first = await llm.callStructured(call);
  const problems = problemsOf(first);
  if (problems.length === 0) return first;
  const note =
    "\n\nYour previous answer had text that quoted a post or named a person in: " +
    problems.map((p) => p.where).join(", ") +
    ". Rewrite those items in your own words with no quotes and no names.";
  return llm.callStructured({ ...call, input: call.input + note });
}

export function createSynthesizeHandler(deps: { llm: Llm; store: SynthesisStore }): JobHandler {
  return async (job, { now }) => {
    if (!job.productId) return { status: "done", payload: { result: "no_product" } };
    const productId = job.productId;
    const until = now();
    const week = weekOf(until);
    const product = await deps.store.product(productId);
    if (!product) return { status: "done", payload: { result: "no_product" } };
    const posts = await deps.store.weekPosts(productId, weekStart(week), until, MAX_POSTS);
    if (posts.length < MIN_POSTS)
      return { status: "done", payload: { result: "too_few", posts: posts.length } };

    const sent = new Map(posts.map((p) => [p.id, p]));
    const excerpts = posts.map((p) => p.excerpt);
    const validIds = (ids: readonly string[]) => [...new Set(ids.filter((id) => sent.has(id)))];
    const keyOf = new Map(product.competitors.map((c, i) => [c.id, `c${i + 1}`]));
    const idOfKey = new Map(product.competitors.map((c, i) => [`c${i + 1}`, c.id]));
    const productBlock = JSON.stringify({
      name: product.name,
      one_liner: product.oneLiner,
      competitors: product.competitors.map((c) => ({ key: keyOf.get(c.id), name: c.name })),
    });

    try {
      // Build.
      const lastThemes = await deps.store.lastThemes(productId, previousWeek(week));
      const build = await callChecked<BuildSynthesis>(
        deps.llm,
        {
          task: "synthesize",
          productId,
          model: SYNTH_MODEL,
          system: [{ text: BUILD_SYSTEM, cache: true }],
          input:
            `<product>${productBlock}</product>\n` +
            `<last_week>${JSON.stringify(lastThemes.filter((t) => t.themeKey).map((t) => t.themeKey))}</last_week>\n` +
            `<posts>${JSON.stringify(posts.map((p) => ({ id: p.id, category: p.category, excerpt: p.excerpt })))}</posts>`,
          schema: BuildSynthesisSchema,
          maxTokens: MAX_TOKENS,
        },
        (reply) =>
          [...reply.themes, ...reply.opportunities].flatMap((item, i) => {
            const problem = textProblem(`${item.title}\n${item.summary}`, excerpts);
            return problem ? [{ where: `item ${i + 1} (${item.theme_key})`, problem }] : [];
          }),
      );
      const lastCount = new Map(
        lastThemes.filter((t) => t.themeKey).map((t) => [`${t.kind}:${t.themeKey}`, t.count]),
      );
      const themeRows: ThemeRow[] = [];
      const seen = new Set<string>();
      const add = (
        kind: ThemeRow["kind"],
        item: { theme_key: string; title: string; summary: string; post_ids: string[] },
      ) => {
        const ids = validIds(item.post_ids);
        const key = `${kind}:${item.theme_key}`;
        if (ids.length === 0 || seen.has(key)) return;
        if (textProblem(`${item.title}\n${item.summary}`, excerpts)) return;
        seen.add(key);
        themeRows.push({
          kind,
          themeKey: item.theme_key,
          title: item.title,
          summary: item.summary,
          count: ids.length,
          trend: trendFor(ids.length, lastCount.get(key)),
          examplePostIds: ids.slice(0, 3),
        });
      };
      for (const t of build.themes) add(t.kind, t);
      for (const o of build.opportunities) add("opportunity", o);

      // Rivals: counts from labels.
      const rivalPosts = posts.filter((p) => p.rival && (p.competitorId || p.toolMentioned));
      const groups = new Map<
        string,
        { competitorId: string | null; toolName: string | null; issue: Issue; posts: WeekPost[] }
      >();
      for (const p of rivalPosts) {
        const key = `${rivalKey(p.competitorId, p.toolMentioned)}|${p.rival!.issue}`;
        const g = groups.get(key) ?? {
          competitorId: p.competitorId,
          toolName: p.competitorId ? null : p.toolMentioned,
          issue: p.rival!.issue,
          posts: [],
        };
        g.posts.push(p);
        groups.set(key, g);
      }
      let rivalRows: RivalRow[] = [];
      if (groups.size > 0) {
        const rivals = await callChecked<RivalSynthesis>(
          deps.llm,
          {
            task: "synthesize",
            productId,
            model: SYNTH_MODEL,
            system: [{ text: RIVAL_SYSTEM, cache: true }],
            input:
              `<product>${productBlock}</product>\n` +
              `<posts>${JSON.stringify(
                rivalPosts.map((p) => ({
                  id: p.id,
                  excerpt: p.excerpt,
                  competitor_key: p.competitorId ? (keyOf.get(p.competitorId) ?? null) : null,
                  tool_name: p.competitorId ? null : p.toolMentioned,
                  issue: p.rival!.issue,
                  sentiment: p.rival!.sentiment,
                  switching: p.rival!.switching,
                })),
              )}</posts>`,
            schema: RivalSynthesisSchema,
            maxTokens: MAX_TOKENS,
          },
          (reply) =>
            [
              ...reply.rivals.map((r) => ({ title: "", summary: r.summary, k: r.issue })),
              ...reply.fixes.map((f) => ({ title: f.title, summary: f.summary, k: f.theme_key })),
            ].flatMap((item, i) => {
              const problem = textProblem(`${item.title}\n${item.summary}`, excerpts);
              return problem ? [{ where: `item ${i + 1} (${item.k})`, problem }] : [];
            }),
        );
        const summaries = new Map<string, string>();
        for (const r of rivals.rivals) {
          const competitorId = r.competitor_key ? (idOfKey.get(r.competitor_key) ?? null) : null;
          if (r.competitor_key && !competitorId) continue;
          if (!competitorId && !r.tool_name) continue;
          if (textProblem(r.summary, excerpts)) continue;
          summaries.set(`${rivalKey(competitorId, r.tool_name)}|${r.issue}`, r.summary);
        }
        const lastRivals = await deps.store.lastRivals(productId, previousWeek(week));
        const lastComplaints = new Map(
          lastRivals.map((r) => [
            `${rivalKey(r.competitorId, r.toolName)}|${r.issue}`,
            r.complaints,
          ]),
        );
        rivalRows = [...groups.entries()].map(([key, g]) => {
          const complaints = g.posts.filter((p) => p.rival!.sentiment !== "positive").length;
          return {
            competitorId: g.competitorId,
            toolName: g.toolName,
            issue: g.issue,
            complaints,
            switching: g.posts.filter((p) => p.rival!.switching).length,
            trend: trendFor(complaints, lastComplaints.get(key)),
            summary: summaries.get(key) ?? "",
            examplePostIds: g.posts.slice(0, 3).map((p) => p.id),
          };
        });
        for (const f of rivals.fixes) add("rival_fix", f);
      }

      await deps.store.saveThemes(productId, week, themeRows);
      await deps.store.saveRivals(productId, week, rivalRows);
      return {
        status: "done",
        payload: { result: "ok", themes: themeRows.length, rivals: rivalRows.length },
      };
    } catch (error) {
      if (error instanceof LlmCapError)
        return { status: "done", payload: { result: "spend_cap", cap: error.cap } };
      if (error instanceof LlmRefusalError)
        return { status: "done", payload: { result: "refused" } };
      throw error;
    }
  };
}
