import { renderDailyPosts, renderFeedReady } from "../../../emails/daily-posts";
import type { Mailer } from "@/server/billing/trial-reminders";
import type { Job, JobHandler } from "@/server/pipeline/ports";
import { CATEGORY_LABELS, SOURCE_LABELS } from "@/server/reply/tips";
import type { FeedCategory } from "@/server/store/feed";
import { listUnsubscribeHeaders, unsubscribeToken, unsubscribeUrl } from "./unsubscribe";

/**
 * The daily posts email and the first run's "feed ready" email (docs/PLAN.md 7.3, 11), as
 * `digest_daily` jobs. Each is sent at most once: a job first records which attempt may send, so a
 * crash after the send never sends again (claim, then send, as in the trial reminders).
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
}

export interface DigestDeps {
  store: DigestStore;
  /** Null when email is not configured yet (F6): the email is skipped, the job does not fail. */
  mailer: () => Mailer | null;
  siteUrl: () => string;
  secret: () => string | undefined;
}

const TOP = 5;
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

/** The attempt that may send; any later attempt means a crash happened after it began. */
const mayNotSend = (job: Job) =>
  typeof job.payload.sendAttempt === "number" && job.attempts !== job.payload.sendAttempt;

export function createDigestHandler(deps: DigestDeps): JobHandler {
  return async (job, { now }) => {
    if (!job.productId) return { status: "done", payload: { result: "no_product" } };
    const mailer = deps.mailer();
    if (!mailer) return { status: "done", payload: { result: "mail_off" } };
    if (mayNotSend(job)) return { status: "done", payload: { result: "not_resent" } };
    const feedReady = job.payload.email === "feed_ready";
    if (feedReady && (await deps.store.firstRunPending(job.productId)))
      return { status: "waiting", runAfter: new Date(now().getTime() + WAIT_MS) };

    const to = await deps.store.recipient(job.productId);
    if (!to?.email || !to.entitled || (!feedReady && !to.daily))
      return { status: "done", payload: { result: "skipped" } };
    const site = deps.siteUrl();

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

    // Claim, then send: record which attempt sends before sending.
    if (typeof job.payload.sendAttempt !== "number")
      return { status: "waiting", runAfter: now(), payload: { sendAttempt: job.attempts + 1 } };
    await mailer.send({ to: to.email, ...message });
    return { status: "done", payload: { result: "sent" } };
  };
}
