import { renderDailyPosts, renderFeedReady } from "../../../emails/daily-posts";
import type { Mailer } from "@/server/billing/trial-reminders";
import type { Job, JobHandler } from "@/server/pipeline/ports";
import { CATEGORY_LABELS, SOURCE_LABELS } from "@/server/reply/tips";
import type { FeedCategory } from "@/server/store/feed";
import { londonDate } from "./schedule";
import { listUnsubscribeHeaders, unsubscribeToken, unsubscribeUrl } from "./unsubscribe";

/**
 * The daily posts email and the first run's "feed ready" email (docs/PLAN.md 7.3, 11), as
 * `digest_daily` jobs. Each is sent once: the job records when its first send began, in the
 * database, before sending; every attempt sends with the same Resend idempotency key, so a retry
 * after a crash, a timeout or an error delivers nothing twice. A retry is made only while the key
 * still holds (23 hours, inside Resend's 24): after that the email is given up rather than risk a
 * second copy. A daily email whose London day has passed ends unsent.
 */

export interface DigestPostRow {
  id: string;
  source: string;
  community: string | null;
  postedAt: string;
  category: FeedCategory;
  reason: string;
}

export interface DigestStore {
  /** The product owner's address and settings, or null when the product is gone. */
  recipient(
    productId: string,
  ): Promise<{ userId: string; email: string | null; daily: boolean; entitled: boolean } | null>;
  /** New links since `since`, best match first. */
  newPosts(productId: string, since: Date, limit: number): Promise<DigestPostRow[]>;
  /** Links by category, for the feed-ready email. */
  categoryCounts(productId: string): Promise<{ category: FeedCategory; count: number }[]>;
  /** True while any first-run job for the product is still to finish. */
  firstRunPending(productId: string): Promise<boolean>;
  /**
   * Record that this job's email is being sent, if no record exists, and return when the first
   * attempt began. The record outlives a crash, so a retry knows whether the provider's
   * idempotency key still covers it.
   */
  claimSend(jobId: string, now: Date): Promise<Date>;
}

export interface DigestDeps {
  store: DigestStore;
  /** Null when email is not configured yet (F6): the email is skipped, the job does not fail. */
  mailer: () => Mailer | null;
  siteUrl: () => string;
  secret: () => string | undefined;
}

const TOP = 5;
/** Resend keeps an idempotency key for 24 hours; retry only well inside that. */
const KEY_HOLDS_MS = 23 * 3_600_000;
/** One send may take this long, so the run's deadline is never reached mid-send. */
const SEND_TIMEOUT_MS = 15_000;

class SendTimeoutError extends Error {
  override name = "SendTimeoutError";
}

async function sendWithin(send: () => Promise<void>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      send(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SendTimeoutError()), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** The key was used before with another body (a re-rendered retry): the first one went out. */
const alreadySent = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  (error as { code?: unknown }).code === "invalid_idempotent_request";
const DAY_MS = 24 * 3_600_000;
const WAIT_MS = 2 * 60_000;

const ago = (postedAt: string, now: Date) => {
  const h = Math.max(0, Math.floor((now.getTime() - Date.parse(postedAt)) / 3_600_000));
  return h < 48 ? `${h}h` : `${Math.floor(h / 24)}d`;
};

const where = (source: string, community: string | null) => {
  const label = SOURCE_LABELS[source] ?? source;
  return community && community !== label ? `${label} · ${community}` : label;
};

/** A daily email belongs to its London day; a job still running after that day sends nothing. */
const dayPassed = (job: Job, now: Date) =>
  typeof job.payload.day === "string" && londonDate(now) > job.payload.day;

export function createDigestHandler(deps: DigestDeps): JobHandler {
  return async (job, { now }) => {
    if (!job.productId) return { status: "done", payload: { result: "no_product" } };
    const mailer = deps.mailer();
    if (!mailer) return { status: "done", payload: { result: "mail_off" } };
    const feedReady = job.payload.email === "feed_ready";
    if (!feedReady && dayPassed(job, now()))
      return { status: "done", payload: { result: "day_passed" } };
    if (feedReady && (await deps.store.firstRunPending(job.productId)))
      return { status: "waiting", runAfter: new Date(now().getTime() + WAIT_MS) };

    const to = await deps.store.recipient(job.productId);
    if (!to?.email || !to.entitled || (!feedReady && !to.daily))
      return { status: "done", payload: { result: "skipped" } };
    const site = deps.siteUrl();
    // Links and List-Unsubscribe must be absolute: no email without the site URL.
    if (!/^https:\/\/[^/]+$/.test(site))
      return { status: "done", payload: { result: "no_site_url" } };

    let message;
    if (feedReady) {
      const counts = await deps.store.categoryCounts(job.productId);
      message = renderFeedReady({
        counts: counts.map((c) => ({ category: CATEGORY_LABELS[c.category], count: c.count })),
        appUrl: `${site}/app/reply`,
      });
    } else {
      const posts = await deps.store.newPosts(
        job.productId,
        new Date(now().getTime() - DAY_MS),
        TOP,
      );
      if (posts.length === 0) return { status: "done", payload: { result: "no_posts" } };
      const url = unsubscribeUrl(site, unsubscribeToken(deps.secret(), to.userId, "daily"));
      message = {
        ...renderDailyPosts({
          posts: posts.map((p) => ({
            where: where(p.source, p.community),
            age: ago(p.postedAt, now()),
            category: CATEGORY_LABELS[p.category],
            reason: p.reason,
            cardUrl: `${site}/app/reply?view=all#post-${p.id}`,
          })),
          appUrl: `${site}/app/reply`,
          unsubscribeUrl: url,
        }),
        headers: listUnsubscribeHeaders(url),
      };
    }

    // Record the first attempt, then send with the job's key; retry only while the key holds.
    const firstAttempt = await deps.store.claimSend(job.id, now());
    if (now().getTime() - firstAttempt.getTime() > KEY_HOLDS_MS)
      return { status: "done", payload: { result: "not_resent" } };
    const send = () =>
      sendWithin(
        () => mailer.send({ to: to.email!, ...message, idempotencyKey: `digest:${job.id}` }),
        SEND_TIMEOUT_MS,
      );
    try {
      await send();
    } catch (error) {
      if (alreadySent(error)) return { status: "done", payload: { result: "sent" } };
      // One more try at once: on Hobby the next run is a day away, past the London day.
      try {
        await send();
      } catch (again) {
        if (alreadySent(again)) return { status: "done", payload: { result: "sent" } };
        throw again;
      }
    }
    return { status: "done", payload: { result: "sent" } };
  };
}
