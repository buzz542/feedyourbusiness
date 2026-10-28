import { z } from "zod";
import { isSensitiveCommunity } from "@/sources/sensitive-communities";
import { cleanDomain, INTENTS, normalizeProductUrl, SUBREDDIT } from "./draft";
import type { OnboardingStore, ReviewEdits } from "./ports";

/**
 * Review and confirm (docs/PLAN.md 4.3, steps 4 and 5): the owner edits every field of the draft,
 * then confirms it. Validated here with zod before anything is written; the database checks the
 * same limits again. Once confirmed, the product changes only through Settings.
 */

export const MAX_TERMS = 40;
/** Every competitor and alias goes into the classifier's prompt (8.2), so the list is bounded. */
export const MAX_COMPETITORS = 20;

const json = <T extends z.ZodType>(schema: T) =>
  z
    .string()
    .transform((text, ctx) => {
      try {
        return JSON.parse(text) as unknown;
      } catch {
        ctx.addIssue({ code: "custom", message: "not JSON" });
        return z.NEVER;
      }
    })
    .pipe(schema);

const ReviewForm = z.object({
  url: z.string(),
  name: z.string().trim().min(1).max(120),
  one_liner: z.string().trim().max(160),
  description: z.string().trim().max(2000),
  audience: z.string().trim().max(1000),
  relevance_threshold: z.coerce.number().int().min(40).max(95),
  terms: json(
    z
      .array(z.object({ term: z.string().trim().min(2).max(60), intent: z.enum(INTENTS) }))
      .max(MAX_TERMS),
  ),
  competitors: json(
    z
      .array(
        z.object({
          name: z.string().trim().min(1).max(80),
          domain: z.string().trim().max(253),
          aliases: z.array(z.string().trim().min(1).max(80)).max(10),
        }),
      )
      .max(MAX_COMPETITORS),
  ),
  subreddits: json(z.array(z.string().trim().max(40)).max(10)),
});

const FIELDS = Object.keys(ReviewForm.shape) as (keyof typeof ReviewForm.shape)[];

export type ReviewOutcome =
  | { kind: "saved"; leftOut: string[] }
  | { kind: "confirmed"; leftOut: string[] }
  | { kind: "invalid"; fields: string[] }
  | { kind: "needs_terms" }
  | { kind: "no_product" }
  | { kind: "already_confirmed" }
  | { kind: "failed" };

type Parsed = { ok: true; edits: ReviewEdits; leftOut: string[] } | { ok: false; fields: string[] };

const spaced = (s: string) => s.replace(/\s+/g, " ");

export function parseReviewForm(form: FormData): Parsed {
  const raw = Object.fromEntries(
    FIELDS.map((key) => {
      const value = form.get(key);
      return [key, typeof value === "string" ? value : undefined];
    }),
  );
  const parsed = ReviewForm.safeParse(raw);
  const bad = new Set<string>();
  if (!parsed.success) {
    for (const issue of parsed.error.issues) bad.add(String(issue.path[0]));
    return { ok: false, fields: FIELDS.filter((f) => bad.has(f)) };
  }
  const data = parsed.data;

  const url = normalizeProductUrl(data.url);
  if (!url) bad.add("url");

  const termKeys = new Set<string>();
  const terms: ReviewEdits["terms"] = [];
  for (const t of data.terms) {
    const term = spaced(t.term);
    if (termKeys.has(term.toLowerCase())) continue;
    termKeys.add(term.toLowerCase());
    terms.push({ term, intent: t.intent });
  }

  const nameKeys = new Set<string>();
  const competitors: ReviewEdits["competitors"] = [];
  for (const c of data.competitors) {
    const name = spaced(c.name);
    const domain = c.domain ? cleanDomain(c.domain) : null;
    if (c.domain && !domain) bad.add("competitors");
    if (nameKeys.has(name.toLowerCase())) continue;
    nameKeys.add(name.toLowerCase());
    competitors.push({ name, domain, aliases: c.aliases.map(spaced) });
  }

  const subKeys = new Set<string>();
  const subreddits: string[] = [];
  const leftOut: string[] = [];
  for (const s of data.subreddits) {
    const sub = s.replace(/^\/?r\//i, "");
    if (!SUBREDDIT.test(sub) || sub.toLowerCase().startsWith("u_")) bad.add("subreddits");
    else if (isSensitiveCommunity(sub)) leftOut.push(sub);
    else if (!subKeys.has(sub.toLowerCase())) {
      subKeys.add(sub.toLowerCase());
      subreddits.push(sub);
    }
  }

  if (bad.size > 0 || !url) return { ok: false, fields: FIELDS.filter((f) => bad.has(f)) };
  return {
    ok: true,
    leftOut,
    edits: {
      url,
      name: data.name,
      oneLiner: data.one_liner,
      description: data.description,
      audience: data.audience,
      relevanceThreshold: data.relevance_threshold,
      terms,
      competitors,
      subreddits,
    },
  };
}

export async function submitReview(
  store: OnboardingStore,
  userId: string,
  form: FormData,
  intent: "save" | "confirm",
  now: Date,
): Promise<ReviewOutcome> {
  const parsed = parseReviewForm(form);
  if (!parsed.ok) return { kind: "invalid", fields: parsed.fields };
  try {
    const product = await store.loadReview(userId);
    if (!product) return { kind: "no_product" };
    if (product.status !== "draft") return { kind: "already_confirmed" };
    if (intent === "confirm" && parsed.edits.terms.length === 0) return { kind: "needs_terms" };

    await store.saveReview(product.id, parsed.edits);
    if (intent === "save") return { kind: "saved", leftOut: parsed.leftOut };
    const confirmed = await store.confirmProduct(product.id, now);
    return confirmed
      ? { kind: "confirmed", leftOut: parsed.leftOut }
      : { kind: "already_confirmed" };
  } catch (error) {
    console.error(
      `[onboarding] review failed: ${error instanceof Error ? error.name : "UnknownError"}`,
    );
    return { kind: "failed" };
  }
}
