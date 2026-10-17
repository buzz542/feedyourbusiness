/** Ports for the jobs runner (docs/PLAN.md 7.2). Adapters: supabase-jobs.ts. Fakes: fakes.ts. */

export type JobKind =
  | "collect"
  | "deletion_sync"
  | "purge"
  | "synthesize"
  | "digest_daily"
  | "digest_weekly"
  | "first_run";

export type JobStatus = "queued" | "running" | "waiting" | "done" | "failed";

export interface Job {
  id: string;
  kind: JobKind;
  productId: string | null;
  source: string | null;
  status: JobStatus;
  /** What the job has done so far (its budget reservation, a vendor handle, failures). */
  payload: Record<string, unknown>;
  attempts: number;
  runAfter: Date;
}

export interface NewJob {
  kind: JobKind;
  productId: string | null;
  source: string | null;
  /** One job per key: "collect:<product>:<source>:<utc day>". */
  dedupeKey: string;
  runAfter?: Date;
  payload?: Record<string, unknown>;
}

export interface JobOutcome {
  status: "queued" | "waiting" | "done" | "failed";
  /** An error class name only, never a message. */
  errorClass?: string;
  /** Merged into the stored payload, never replacing it. */
  payload?: Record<string, unknown>;
  runAfter?: Date;
}

export interface JobStore {
  claim(now: Date, limit: number, leaseSeconds: number): Promise<Job[]>;
  finish(id: string, outcome: JobOutcome): Promise<void>;
  /** Inserts the jobs whose dedupe key is new; returns how many. */
  enqueue(jobs: NewJob[]): Promise<number>;
}

export type ReserveResult = "reserved" | "already" | "refused" | "monthly_cap";

/** Per-job budget: reserved and settled at most once per job, whatever happens to the run. */
export interface BudgetStore {
  reserve(input: {
    jobId: string;
    productId: string;
    source: string;
    /** UTC day, YYYY-MM-DD. */
    day: string;
    units: number;
    limit: number;
    monthlyCap?: number | null;
    /** YYYY-MM-DD, with monthlyCap. */
    monthStart?: string;
  }): Promise<ReserveResult>;
  settle(jobId: string, actualUnits: number, costUsd: number): Promise<boolean>;
}

export type StepResult =
  | { status: "done"; payload?: Record<string, unknown> }
  | { status: "waiting"; runAfter: Date; payload?: Record<string, unknown> };

export interface JobContext {
  now: () => Date;
  /** Epoch ms after which a step should stop and leave the rest to a later run. */
  deadline: number;
}

export interface JobHandler {
  (job: Job, ctx: JobContext): Promise<StepResult>;
  /** Called once when the job fails for good (a reservation to give back, for instance). */
  onFailed?: (job: Job) => Promise<void>;
}
