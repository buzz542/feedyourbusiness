import { describe, expect, it } from "vitest";
import { renderDailyPosts } from "../../../emails/daily-posts";
import type { Mailer } from "@/server/billing/trial-reminders";
import { FakeJobStore } from "@/server/pipeline/fakes";
import { startFirstRun } from "@/server/pipeline/first-run";
import type { JobHandler } from "@/server/pipeline/ports";
import { runJobs } from "@/server/pipeline/runner";
import type { CollectSource } from "@/sources/types";
import { createDigestHandler, type DigestPostRow, type DigestStore } from "./digest";
import { digestRunAfter, londonDate, nextLondonEight } from "./schedule";
import {
  createUnsubscribeHandler,
  unsubscribeToken,
  verifyUnsubscribeToken,
  type EmailList,
} from "./unsubscribe";

/** M5: daily posts email, one-click unsubscribe, the first run and its feed-ready email. */

const SECRET = "s".repeat(16) + "k".repeat(16) + "-test-only";
const USER = "00000000-0000-4000-8000-0000000000a1";
const PRODUCT = "product-1";
const NOW = new Date("2026-11-02T06:00:00Z");
const EXCERPT = "Is there a tool that chases unpaid invoices for freelancers?";

/** Like Resend: a repeated idempotency key within a day sends nothing new. */
class Outbox implements Mailer {
  sent: Parameters<Mailer["send"]>[0][] = [];
  keys = new Set<string>();
  bodies = new Map<string, string>();
  failAfterSend = false;
  failBeforeSend = 0;
  async send(message: Parameters<Mailer["send"]>[0]) {
    if (this.failBeforeSend > 0) {
      this.failBeforeSend--;
      throw new Error("provider unavailable");
    }
    const key = message.idempotencyKey;
    // Resend answers 409 when a key is reused with a different body.
    if (key && this.bodies.has(key) && this.bodies.get(key) !== message.text)
      throw Object.assign(new Error("409"), { code: "invalid_idempotent_request" });
    if (!key || !this.keys.has(key)) this.sent.push(message);
    if (key) {
      this.keys.add(key);
      this.bodies.set(key, message.text);
    }
    if (this.failAfterSend) {
      this.failAfterSend = false;
      throw new Error("connection reset after the send");
    }
  }
}

/** The send records, as the jobs table holds them: the first attempt's time per job. */
function sendLedger() {
  const first = new Map<string, Date>();
  return {
    first,
    claimSend: async (jobId: string, now: Date) => {
      if (!first.has(jobId)) first.set(jobId, now);
      return first.get(jobId)!;
    },
  };
}

function store(over: Partial<DigestStore> = {}, posts: DigestPostRow[] = []): DigestStore {
  return {
    ...sendLedger(),
    recipient: async () => ({
      userId: USER,
      email: "maker@example.test",
      daily: true,
      entitled: true,
    }),
    newPosts: async () => posts,
    categoryCounts: async () => [{ category: "looking_for_tool", count: 3 }],
    firstRunPending: async () => false,
    ...over,
  };
}

const post: DigestPostRow = {
  id: "00000000-0000-4000-8000-000000000101",
  source: "reddit",
  community: "r/freelance",
  postedAt: "2026-11-02T03:00:00Z",
  category: "looking_for_tool",
  reason: "Asks for a tool that chases invoices.",
};

async function runDigest(s: DigestStore, outbox = new Outbox(), payload = {}) {
  const jobs = new FakeJobStore();
  await jobs.enqueue([
    {
      kind: "digest_daily",
      productId: PRODUCT,
      source: null,
      dedupeKey: "d:1",
      runAfter: NOW,
      payload,
    },
  ]);
  const handler = createDigestHandler({
    store: s,
    mailer: () => outbox,
    siteUrl: () => "https://askedfor.app",
    secret: () => SECRET,
  });
  // An hour apart, so a retry after a failure is due.
  for (let i = 0; i < 3; i++)
    await runJobs({
      store: jobs,
      handlers: { digest_daily: handler },
      clock: () => new Date(NOW.getTime() + i * 3_600_000),
    });
  return { jobs, outbox };
}

describe("unsubscribe tokens", () => {
  it("verify for the user and list they were made for, and expire with the secret", () => {
    const token = unsubscribeToken(SECRET, USER, "daily");
    expect(verifyUnsubscribeToken(SECRET, token)).toEqual({ userId: USER, list: "daily" });
    expect(verifyUnsubscribeToken(`${SECRET}-rotated`, token)).toBeNull();
    expect(verifyUnsubscribeToken(SECRET, token.replace(".daily.", ".weekly."))).toBeNull();
    expect(verifyUnsubscribeToken(SECRET, `${token}x`)).toBeNull();
    expect(verifyUnsubscribeToken(SECRET, null)).toBeNull();
    expect(() => unsubscribeToken("short", USER, "daily")).toThrow(/32/);
  });

  it("turns the email off on POST and changes nothing on GET", async () => {
    const off: [string, EmailList][] = [];
    const handler = createUnsubscribeHandler({
      secret: () => SECRET,
      turnOff: async (userId, list) => {
        off.push([userId, list]);
      },
    });
    const url = `https://askedfor.app/api/unsubscribe?t=${encodeURIComponent(unsubscribeToken(SECRET, USER, "daily"))}`;
    const get = await handler.GET(new Request(url));
    expect(get.status).toBe(200);
    expect(await get.text()).toContain('method="post"');
    expect(off).toEqual([]);
    const post = await handler.POST(
      new Request(url, { method: "POST", body: "List-Unsubscribe=One-Click" }),
    );
    expect(post.status).toBe(200);
    expect(off).toEqual([[USER, "daily"]]);
    const forged = await handler.POST(new Request(`${url}AAAA`, { method: "POST" }));
    expect(forged.status).toBe(400);
    expect(off).toHaveLength(1);
  });
});

describe("daily posts email", () => {
  it("sends the top posts with links, never an excerpt, with one-click unsubscribe", async () => {
    const { outbox, jobs } = await runDigest(store({}, [post]));
    expect(outbox.sent).toHaveLength(1);
    const mail = outbox.sent[0]!;
    expect(mail.subject).toBe("New posts worth replying to");
    for (const body of [mail.text, mail.html]) {
      expect(body).toContain("Say you built it.");
      expect(body).toContain("Reddit · r/freelance");
      expect(body).toContain("Asks for a tool that chases invoices.");
      expect(body).toContain(`/app/reply?view=all#post-${post.id}`);
      expect(body).not.toContain(EXCERPT);
      expect(body).not.toContain("—");
    }
    expect(mail.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(mail.headers?.["List-Unsubscribe"]).toMatch(
      /^<https:\/\/askedfor\.app\/api\/unsubscribe\?t=/,
    );
    expect(jobs.jobs[0]).toMatchObject({ status: "done", payload: { result: "sent" } });
  });

  it("sends nothing when there are no new posts, the email is off or the account is not entitled", async () => {
    expect((await runDigest(store({}, []))).outbox.sent).toHaveLength(0);
    const off = store(
      {
        recipient: async () => ({
          userId: USER,
          email: "m@example.test",
          daily: false,
          entitled: true,
        }),
      },
      [post],
    );
    expect((await runDigest(off)).outbox.sent).toHaveLength(0);
    const lapsed = store(
      {
        recipient: async () => ({
          userId: USER,
          email: "m@example.test",
          daily: true,
          entitled: false,
        }),
      },
      [post],
    );
    expect((await runDigest(lapsed)).outbox.sent).toHaveLength(0);
  });

  it("never sends twice, even when the send fails after it went out", async () => {
    const outbox = new Outbox();
    outbox.failAfterSend = true;
    const { jobs } = await runDigest(store({}, [post]), outbox);
    // The retry carries the same idempotency key, so the provider sends nothing new.
    expect(outbox.sent).toHaveLength(1);
    expect(outbox.sent[0]!.idempotencyKey).toBe(`digest:${jobs.jobs[0]!.id}`);
    expect(jobs.jobs[0]).toMatchObject({ status: "done", payload: { result: "sent" } });
  });

  it("is not lost when the provider fails once: it is tried again at once", async () => {
    const outbox = new Outbox();
    outbox.failBeforeSend = 1;
    const { jobs } = await runDigest(store({}, [post]), outbox);
    expect(outbox.sent).toHaveLength(1);
    expect(jobs.jobs[0]).toMatchObject({ status: "done", payload: { result: "sent" } });
  });

  const job = {
    id: "job-x",
    kind: "digest_daily" as const,
    productId: PRODUCT,
    source: null,
    status: "running" as const,
    payload: { email: "daily", day: "2026-11-02" },
    attempts: 1,
    runAfter: NOW,
  };
  const at = (ms: number) => ({ now: () => new Date(ms), deadline: Number.MAX_SAFE_INTEGER });
  const handlerFor = (s: DigestStore, outbox: Outbox) =>
    createDigestHandler({
      store: s,
      mailer: () => outbox,
      siteUrl: () => "https://askedfor.app",
      secret: () => SECRET,
    });

  it("a crash after the record but before the provider got it is sent on the retry, once", async () => {
    const s = store({}, [post]);
    const outbox = new Outbox();
    const handler = handlerFor(s, outbox);
    // The first attempt recorded itself, then the function died before Resend answered.
    await s.claimSend(job.id, NOW);
    expect(await handler({ ...job, attempts: 2 }, at(NOW.getTime() + 600_000))).toMatchObject({
      payload: { result: "sent" },
    });
    // Another run of the same job: the same key, so the provider sends nothing new.
    expect(await handler({ ...job, attempts: 5 }, at(NOW.getTime() + 600_000))).toMatchObject({
      payload: { result: "sent" },
    });
    expect(outbox.sent).toHaveLength(1);
  });

  it("a re-rendered retry the provider refuses as a reused key counts as sent", async () => {
    const s = store({}, [post]);
    const outbox = new Outbox();
    const handler = handlerFor(s, outbox);
    await handler(job, at(NOW.getTime()));
    // Two hours later the ages differ, so the body differs: Resend answers 409.
    expect(await handler(job, at(NOW.getTime() + 2 * 3_600_000))).toMatchObject({
      payload: { result: "sent" },
    });
    expect(outbox.sent).toHaveLength(1);
  });

  it("gives up rather than risk a second copy once the key no longer holds", async () => {
    const s = store({}, [post]);
    const outbox = new Outbox();
    await s.claimSend("job-feed", NOW);
    const feed = { ...job, id: "job-feed", payload: { email: "feed_ready" } };
    expect(await handlerFor(s, outbox)(feed, at(NOW.getTime() + 24 * 3_600_000))).toMatchObject({
      payload: { result: "not_resent" },
    });
    expect(outbox.sent).toHaveLength(0);
  });

  it.each([
    ["2026-07-01", "2026-07-01T23:30:00Z", "day_passed"],
    ["2026-11-01", "2026-11-01T23:30:00Z", "sent"],
  ])("a daily email for %s at %s: %s (London time)", async (day, now, result) => {
    const handler = handlerFor(store({}, [post]), new Outbox());
    expect(
      await handler({ ...job, payload: { email: "daily", day } }, at(Date.parse(now))),
    ).toMatchObject({ payload: { result } });
  });

  it("ends unsent once its London day has passed", async () => {
    const { outbox, jobs } = await runDigest(store({}, [post]), new Outbox(), {
      email: "daily",
      day: "2026-11-01",
    });
    expect(outbox.sent).toHaveLength(0);
    expect(jobs.jobs[0]).toMatchObject({ status: "done", payload: { result: "day_passed" } });
  });

  it("renders no excerpt field at all", () => {
    const rendered = renderDailyPosts({
      posts: [],
      appUrl: "https://askedfor.app/app/reply",
      unsubscribeUrl: "https://askedfor.app/u",
    });
    expect(rendered.text).toContain("Say you built it.");
  });
});

describe("08:00 UK across the daylight saving change", () => {
  it.each([
    ["2026-03-28T05:00:00Z", "2026-03-28T08:00:00.000Z"],
    ["2026-03-29T05:00:00Z", "2026-03-29T07:00:00.000Z"],
    ["2026-10-24T05:00:00Z", "2026-10-24T07:00:00.000Z"],
    ["2026-10-25T05:00:00Z", "2026-10-25T08:00:00.000Z"],
    ["2026-10-25T09:00:00Z", "2026-10-26T08:00:00.000Z"],
  ])("from %s the next 08:00 London is %s", (now, want) => {
    expect(nextLondonEight(new Date(now)).toISOString()).toBe(want);
  });

  it("is due at the daily run on Hobby and at 08:00 UK once the tick exists", () => {
    expect(digestRunAfter(NOW, false)).toEqual(NOW);
    expect(digestRunAfter(NOW, true).toISOString()).toBe("2026-11-02T08:00:00.000Z");
    expect(londonDate(new Date("2026-11-02T23:30:00Z"))).toBe("2026-11-02");
  });
});

describe("first run", () => {
  const source = (id: string, pendingRuns: number): CollectSource =>
    ({ id, pendingRuns }) as unknown as CollectSource;

  it("is enqueued once, shows progress as sources finish, and emails once when all are done", async () => {
    const jobs = new FakeJobStore();
    const sources = [source("hackernews", 0), source("reddit", 1)];
    expect(await startFirstRun({ store: jobs, sources, productId: PRODUCT, now: NOW })).toBe(3);
    expect(await startFirstRun({ store: jobs, sources, productId: PRODUCT, now: NOW })).toBe(0);

    // A fake collect handler: Hacker News finishes at once, Reddit (a vendor run) on a later run.
    const seen = new Map<string, number>();
    const collect: JobHandler = async (job, { now }) => {
      const n = (seen.get(job.source!) ?? 0) + 1;
      seen.set(job.source!, n);
      return job.source === "reddit" && n === 1
        ? { status: "waiting", runAfter: new Date(now().getTime() + 2 * 60_000) }
        : { status: "done", payload: { result: "ok" } };
    };
    const outbox = new Outbox();
    const digest = createDigestHandler({
      store: store({
        firstRunPending: async () =>
          jobs.jobs.some((j) => j.kind === "first_run" && !["done", "failed"].includes(j.status)),
      }),
      mailer: () => outbox,
      siteUrl: () => "https://askedfor.app",
      secret: () => SECRET,
    });
    const progress = () =>
      jobs.jobs.filter((j) => j.kind === "first_run").map((j) => [j.source, j.status]);
    let clock = NOW;
    const run = () =>
      runJobs({
        store: jobs,
        handlers: { first_run: collect, digest_daily: digest },
        clock: () => clock,
      });

    await run();
    expect(progress()).toEqual([
      ["hackernews", "done"],
      ["reddit", "waiting"],
    ]);
    expect(outbox.sent).toHaveLength(0);
    for (let i = 0; i < 6; i++) {
      clock = new Date(clock.getTime() + 3 * 60_000);
      await run();
    }
    expect(progress()).toEqual([
      ["hackernews", "done"],
      ["reddit", "done"],
    ]);
    expect(outbox.sent).toHaveLength(1);
    expect(outbox.sent[0]!.subject).toBe("Your AskedFor feed is ready");
    expect(outbox.sent[0]!.text).toContain("Looking for a tool: 3");
    expect(outbox.sent[0]!.text).toContain("Say you built it.");
  });
});
