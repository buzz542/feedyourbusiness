import { renderDailyPosts } from "../../../emails/daily-posts";
import { ageLabel, CATEGORY_LABELS, whereLabel } from "@/lib/reply-tips";
import type { FeedCategory } from "@/lib/reply-filters";
import type { Mailer } from "@/server/billing/trial-reminders";
import {
  signUnsubscribe,
  unsubscribeHeaders,
  unsubscribeUrl,
  type EmailList,
} from "@/server/email/unsubscribe";
import type { JobHandler, JobStore, NewJob } from "./ports";

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

/** The digest jobs due at `now`: none outside 08:00 London; the weekly one on Mondays too. */
export function digestJobs(productIds: readonly string[], now: Date): NewJob[] {
  const clock = londonClock(now);
  if (clock.hour !== DIGEST_HOUR) return [];
  const jobs: NewJob[] = productIds.map((productId) => ({
    kind: "digest_daily",
    productId,
    source: null,
    dedupeKey: `digest_daily:${productId}:${clock.day}`,
    runAfter: now,
  }));
  if (clock.weekday === 1)
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
}): Promise<number> {
  if (londonClock(input.now).hour !== DIGEST_HOUR) return 0;
  const jobs = digestJobs(await input.products(), input.now);
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
  /** The product's top cards by match, linked in [since, until), not replied or hidden. */
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
    const until = now();
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
    if (!(await deps.claim(job.id))) return { status: "done", payload: { result: "already_sent" } };
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
    await mailer.send({ to: who.email, ...email, headers });
    return { status: "done", payload: { result: "sent", cards: cards.length } };
  };
}
