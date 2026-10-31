import type { CollectStore, PostLabel, StoredPost, TermStat } from "./collect-step";
import type { BudgetStore, Job, JobOutcome, JobStore, NewJob, ReserveResult } from "./ports";

/**
 * In-memory stand-ins for the jobs table and the job budget functions, with the same semantics as
 * the SQL (supabase/migrations/*collection.sql, *job_budget.sql): leases, merged payloads, one
 * reservation and one settlement per job. Tests only.
 */
export class FakeJobStore implements JobStore {
  jobs: (Job & { lockedUntil: Date | null; dedupeKey: string | null })[] = [];
  claims = 0;
  private next = 1;

  async enqueue(jobs: NewJob[]): Promise<number> {
    let inserted = 0;
    for (const job of jobs) {
      if (this.jobs.some((j) => j.dedupeKey === job.dedupeKey)) continue;
      this.jobs.push({
        id: `job-${this.next++}`,
        kind: job.kind,
        productId: job.productId,
        source: job.source,
        status: "queued",
        payload: { ...(job.payload ?? {}) },
        attempts: 0,
        runAfter: job.runAfter ?? new Date(0),
        lockedUntil: null,
        dedupeKey: job.dedupeKey,
      });
      inserted++;
    }
    return inserted;
  }

  async claim(now: Date, limit: number, leaseSeconds: number): Promise<Job[]> {
    this.claims++;
    const due = this.jobs
      .filter(
        (j) =>
          j.runAfter <= now &&
          (j.status === "queued" ||
            j.status === "waiting" ||
            (j.status === "running" && j.lockedUntil !== null && j.lockedUntil < now)) &&
          (j.lockedUntil === null || j.lockedUntil < now),
      )
      .sort((a, b) => a.runAfter.getTime() - b.runAfter.getTime())
      .slice(0, limit);
    for (const j of due) {
      j.status = "running";
      j.attempts++;
      j.lockedUntil = new Date(now.getTime() + leaseSeconds * 1000);
    }
    // A snapshot, as the database returns: later writes to the row do not change it.
    return due.map((j) => structuredClone({ ...j }));
  }

  async finish(id: string, outcome: JobOutcome): Promise<void> {
    const j = this.jobs.find((x) => x.id === id)!;
    // As finish_job: only a running job can be finished.
    if (j.status !== "running") return;
    j.status = outcome.status;
    j.payload = { ...j.payload, ...(outcome.payload ?? {}) };
    if (outcome.runAfter) j.runAfter = outcome.runAfter;
    j.lockedUntil = null;
    if (outcome.errorClass) j.payload.lastError = outcome.errorClass;
  }

  byKind(kind: string) {
    return this.jobs.filter((j) => j.kind === kind);
  }
}

export class FakeBudget implements BudgetStore {
  /** product:source:day -> reads */
  ledger = new Map<string, number>();
  costs = new Map<string, number>();
  reserveCalls = 0;

  constructor(private readonly jobs: FakeJobStore) {}

  async reserve(input: Parameters<BudgetStore["reserve"]>[0]): Promise<ReserveResult> {
    this.reserveCalls++;
    const job = this.jobs.jobs.find((j) => j.id === input.jobId)!;
    if ("reserved" in job.payload) return "already";
    const key = `${input.productId}:${input.source}:${input.day}`;
    const used = this.ledger.get(key) ?? 0;
    if (used + input.units > input.limit) return "refused";
    // The vendor's monthly cap, across every product (reserve_job_budget does the same in SQL).
    if (input.monthlyCap != null) {
      const monthStart = `${input.day.slice(0, 7)}-01`;
      // As vendor_usage: a source and its re-checks share the monthly cap.
      const base = input.source.replace(/_recheck$/, "");
      let month = 0;
      for (const [k, reads] of this.ledger) {
        const [, src, day] = k.split(":");
        if (
          (src === base || src === `${base}_recheck`) &&
          day! >= monthStart &&
          day!.slice(0, 7) === input.day.slice(0, 7)
        )
          month += reads;
      }
      if (month + input.units > input.monthlyCap) return "monthly_cap";
    }
    this.ledger.set(key, used + input.units);
    job.payload = { ...job.payload, reserved: input.units, day: input.day, budgetKey: key };
    return "reserved";
  }

  async settle(jobId: string, actual: number, costUsd: number): Promise<boolean> {
    const job = this.jobs.jobs.find((j) => j.id === jobId)!;
    if (!("reserved" in job.payload) || job.payload.settled) return false;
    const key = String(job.payload.budgetKey);
    const reserved = Number(job.payload.reserved);
    // As settle_budget: unused units go back, an overrun is added.
    this.ledger.set(key, Math.max(0, (this.ledger.get(key) ?? 0) - reserved + actual));
    this.costs.set(key, (this.costs.get(key) ?? 0) + costUsd);
    job.payload = { ...job.payload, settled: true };
    return true;
  }
}

export class FakeCollectStore implements CollectStore {
  /** id -> stored post */
  posts = new Map<string, StoredPost & { id: string }>();
  links: Array<{ productId: string; postId: string } & PostLabel> = [];
  /** "source|hash" pairs on the suppression list (the pre-check reads these). */
  suppression = new Set<string>();
  /** Hashes ingest refuses although the pre-check missed them (a suppression added mid-run). */
  suppressedAtIngest = new Set<string>();
  termStats: Array<{ jobId: string; day: string; source: string; stats: TermStat[] }> = [];
  private nextId = 1;

  async suppressed(source: string, hashes: readonly string[]): Promise<Set<string>> {
    return new Set(hashes.filter((h) => this.suppression.has(`${source}|${h}`)));
  }

  async linked(productId: string, source: string, externalIds: readonly string[]) {
    const ids = new Set(externalIds);
    const out = new Set<string>();
    for (const link of this.links) {
      const post = this.posts.get(link.postId);
      if (link.productId === productId && post?.source === source && ids.has(post.externalId))
        out.add(post.externalId);
    }
    return out;
  }

  async ingest(post: StoredPost): Promise<string | null> {
    if (
      this.suppressedAtIngest.has(post.authorHash) ||
      this.suppression.has(`${post.source}|${post.authorHash}`)
    )
      return null;
    for (const [id, stored] of this.posts)
      if (stored.source === post.source && stored.externalId === post.externalId) return id;
    const id = `post-${this.nextId++}`;
    this.posts.set(id, { ...post, id });
    return id;
  }

  async link(productId: string, postId: string, label: PostLabel): Promise<void> {
    if (this.links.some((l) => l.productId === productId && l.postId === postId)) return;
    this.links.push({ productId, postId, ...label });
  }

  async recordTermStats(jobId: string, day: string, source: string, stats: TermStat[]) {
    if (this.termStats.some((t) => t.jobId === jobId)) return;
    this.termStats.push({ jobId, day, source, stats });
  }
}
