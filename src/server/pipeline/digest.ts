import { renderDailyPosts } from "../../../emails/daily-posts";
import { renderWeeklyDigest } from "../../../emails/weekly-digest";
import { ageLabel, CATEGORY_LABELS, whereLabel } from "@/lib/reply-tips";
import type { FeedCategory } from "@/lib/reply-filters";
import type { Mailer } from "@/server/billing/trial-reminders";
import {
  signUnsubscribe,
  unsubscribeHeaders,
  unsubscribeUrl,
  type EmailList,
} from "@/server/email/unsubscribe";
import type { JobHandler, JobKind, JobStore, NewJob } from "./ports";

/**
 * Daily posts email and the Monday digest (docs/PLAN.md 7.2, 11), sent at 08:00 UK time. Vercel
 * Hobby fires a cron at most once a day, somewhere within its hour, so two daily crons run: 07:00
 * UTC (08:00 in British Summer Time) and 08:00 UTC (08:00 in winter). Each enqueues only when it is
 * the 08:00 hour in London, so exactly one of them sends, either side of the clock change. Jobs are
 * deduped per product and London day, and every send is claimed first, so nobody gets two.
 */

const LONDON = "Europe/London";

/** The hour (0 to 23) and date (YYYY-MM-DD) in London at `now`. */
export function londonClock(now: Date): { hour: number; day: string; weekday: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: LONDON,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    hour: Number(parts.hour),
    day: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: weekdays.indexOf(parts.weekday ?? ""),
  };
}

export const DIGEST_HOUR = 8;

/**
 * 08:00 London on the London date of `now`, as an instant. The daily email covers the 24 hours to
 * this point, so the windows tile exactly whatever minute the cron fires in its hour.
 */
export function londonDigestTime(now: Date): Date {
  const clock = londonClock(now);
  const [y, m, d] = clock.day.split("-").map(Number) as [number, number, number];
  // London is UTC or UTC+1: the offset is London's hour minus UTC's hour at `now`.
  const offsetHours = (clock.hour - now.getUTCHours() + 24) % 24;
  return new Date(Date.UTC(y, m - 1, d, DIGEST_HOUR - offsetHours));
}

const BOTH: ReadonlySet<JobKind> = new Set(["digest_daily", "digest_weekly"]);

/**
 * The digest jobs due at `now`: none outside 08:00 London; the weekly one on Mondays too. Only
 * kinds that have a handler (`kinds`) are made.
 */
export function digestJobs(
  productIds: readonly string[],
  now: Date,
  kinds: ReadonlySet<JobKind> = BOTH,
): NewJob[] {
  const clock = londonClock(now);
  if (clock.hour !== DIGEST_HOUR) return [];
  const jobs: NewJob[] = kinds.has("digest_daily")
    ? productIds.map((productId) => ({
        kind: "digest_daily" as const,
        productId,
        source: null,
        dedupeKey: `digest_daily:${productId}:${clock.day}`,
        runAfter: now,
      }))
    : [];
  if (clock.weekday === 1 && kinds.has("digest_weekly"))
    for (const productId of productIds)
      jobs.push({
        kind: "digest_weekly",
        productId,
        source: null,
        dedupeKey: `digest_weekly:${productId}:${clock.day}`,
        runAfter: now,
      });
  return jobs;
}

export async function enqueueDigests(input: {
  store: JobStore;
  products: () => Promise<string[]>;
  now: Date;
  kinds?: ReadonlySet<JobKind>;
}): Promise<number> {
  if (londonClock(input.now).hour !== DIGEST_HOUR) return 0;
  const jobs = digestJobs(await input.products(), input.now, input.kinds);
  return jobs.length ? input.store.enqueue(jobs) : 0;
}

export interface DigestCard {
  id: string;
  source: string;
  community: string | null;
  category: FeedCategory;
  reason: string;
  postedAt: Date;
}

export interface DigestRecipient {
  userId: string;
  email: string;
  daily: boolean;
  weekly: boolean;
}

export interface DailyDigestDeps {
  recipient(productId: string): Promise<DigestRecipient | null>;
  /** The product's top new cards by match (not saved, replied or hidden), linked in [since, until). */
  newCards(productId: string, since: Date, until: Date, limit: number): Promise<DigestCard[]>;
  /** Marks this job's email as claimed; false if already claimed (never sent twice). */
  claim(jobId: string): Promise<boolean>;
  mailer: () => Mailer | null;
  siteUrl: string;
  secret: string | undefined;
}

export function listUnsubscribe(
  deps: Pick<DailyDigestDeps, "siteUrl" | "secret">,
  userId: string,
  list: EmailList,
) {
  const url = unsubscribeUrl(deps.siteUrl, signUnsubscribe(deps.secret, userId, list));
  return { url, headers: unsubscribeHeaders(url) };
}

export function createDailyDigestHandler(deps: DailyDigestDeps): JobHandler {
  return async (job, { now }) => {
    if (!job.productId) return { status: "done", payload: { result: "no_product" } };
    const who = await deps.recipient(job.productId);
    if (!who || !who.daily) return { status: "done", payload: { result: "off" } };
    const until = londonDigestTime(now());
    const cards = await deps.newCards(
      job.productId,
      new Date(until.getTime() - 24 * 60 * 60_000),
      until,
      5,
    );
    // No email when there are no new posts.
    if (cards.length === 0) return { status: "done", payload: { result: "nothing_new" } };
    const mailer = deps.mailer();
    if (!mailer) return { status: "done", payload: { result: "email_off" } };
    // Everything that can fail is built before the claim, so a claimed email is always attempted.
    const site = deps.siteUrl.replace(/\/$/, "");
    const { url, headers } = listUnsubscribe(deps, who.userId, "daily");
    const email = renderDailyPosts({
      items: cards.map((c) => ({
        where: whereLabel(c.source, c.community),
        age: ageLabel(c.postedAt, until),
        category: CATEGORY_LABELS[c.category],
        reason: c.reason,
        cardUrl: `${site}/app/reply?view=all#card-${c.id}`,
      })),
      appUrl: `${site}/app/reply`,
      unsubscribeUrl: url,
    });
    if (!(await deps.claim(job.id))) return { status: "done", payload: { result: "already_sent" } };
    await mailer.send({ to: who.email, ...email, headers, idempotencyKey: `job-${job.id}` });
    return { status: "done", payload: { result: "sent", cards: cards.length } };
  };
}

export interface WeeklySummary {
  week: string;
  themes: { title: string; count: number; trend: "new" | "up" | "down" | "flat" }[];
  rivals: { name: string; complaints: number; trend: "new" | "up" | "down" | "flat" }[];
  next: { title: string; summary: string }[];
}

export interface WeeklyDigestDeps {
  recipient(productId: string): Promise<DigestRecipient | null>;
  /** The newest synthesized week on or before `before` (themes, rival insights, next steps). */
  summary(productId: string, before: Date): Promise<WeeklySummary | null>;
  claim(jobId: string): Promise<boolean>;
  mailer: () => Mailer | null;
  siteUrl: string;
  secret: string | undefined;
}

const TREND_WORDS = { new: "new", up: "up", down: "down", flat: "steady" } as const;

/** The Monday digest (docs/PLAN.md 11). Nothing is sent for a week with nothing to say. */
export function createWeeklyDigestHandler(deps: WeeklyDigestDeps): JobHandler {
  return async (job, { now }) => {
    if (!job.productId) return { status: "done", payload: { result: "no_product" } };
    const who = await deps.recipient(job.productId);
    if (!who || !who.weekly) return { status: "done", payload: { result: "off" } };
    const summary = await deps.summary(job.productId, now());
    if (!summary || (summary.themes.length === 0 && summary.rivals.length === 0))
      return { status: "done", payload: { result: "nothing_new" } };
    const mailer = deps.mailer();
    if (!mailer) return { status: "done", payload: { result: "email_off" } };
    const site = deps.siteUrl.replace(/\/$/, "");
    const { url, headers } = listUnsubscribe(deps, who.userId, "weekly");
    const email = renderWeeklyDigest({
      weekLabel: new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(
        new Date(`${summary.week}T00:00:00Z`),
      ),
      themes: summary.themes.slice(0, 5).map((t) => ({ ...t, trend: TREND_WORDS[t.trend] })),
      rivals: summary.rivals.slice(0, 5).map((r) => ({ ...r, trend: TREND_WORDS[r.trend] })),
      next: summary.next.slice(0, 3),
      buildUrl: `${site}/app/build?week=${summary.week}`,
      rivalsUrl: `${site}/app/rivals`,
      unsubscribeUrl: url,
    });
    if (!(await deps.claim(job.id))) return { status: "done", payload: { result: "already_sent" } };
    await mailer.send({ to: who.email, ...email, headers, idempotencyKey: `job-${job.id}` });
    return { status: "done", payload: { result: "sent" } };
  };
}
