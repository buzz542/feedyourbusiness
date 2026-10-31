import type {
  BeginCall,
  BeginResult,
  LlmClient,
  LlmReply,
  LlmRequest,
  LlmTask,
  UsageRow,
  UsageSince,
  UsageStore,
} from "./ports";

type Script = LlmReply | Error | ((request: LlmRequest) => Promise<LlmReply> | LlmReply);

/** A model that answers from a script (a reply, an error to throw, or a function), recording every request. */
export class FakeLlmClient implements LlmClient {
  readonly requests: LlmRequest[] = [];
  constructor(private readonly replies: Script[]) {}

  async complete(request: LlmRequest): Promise<LlmReply> {
    this.requests.push(request);
    const next = this.replies.shift();
    if (!next) throw new Error("FakeLlmClient: no reply left");
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next(request) : next;
  }
}

const startOfUtcDay = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const startOfUtcMonth = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

/** llm_usage and its reservations in memory. `begin` does all its work synchronously, so it is atomic. */
export class FakeUsageStore implements UsageStore {
  readonly rows: UsageRow[] = [];
  readonly reservations = new Map<
    string,
    { productId: string | null; task: LlmTask; reserveUsd: number; expiresAt: Date }
  >();
  private readonly seeded: {
    productId: string | null;
    costUsd: number;
    at: Date;
    task?: LlmTask;
  }[] = [];
  private nextId = 0;

  seed(row: { productId: string | null; costUsd: number; at: Date; task?: LlmTask }): void {
    this.seeded.push(row);
  }

  private all() {
    return [...this.seeded, ...this.rows];
  }

  async begin(call: BeginCall): Promise<BeginResult> {
    const open = [...this.reservations.values()].filter((r) => r.expiresAt > call.at);
    const day = startOfUtcDay(call.at);
    const month = startOfUtcMonth(call.at);
    if (call.productId !== null && call.taskDailyCalls !== null) {
      const calls =
        this.all().filter(
          (r) => r.productId === call.productId && r.task === call.task && r.at >= day,
        ).length +
        open.filter((r) => r.productId === call.productId && r.task === call.task).length;
      if (calls >= call.taskDailyCalls) return { kind: "refused", limit: "task_daily" };
    }
    const sum = (xs: { costUsd?: number; reserveUsd?: number }[]) =>
      xs.reduce((t, x) => t + (x.costUsd ?? x.reserveUsd ?? 0), 0);
    if (call.productId !== null) {
      const used =
        sum(this.all().filter((r) => r.productId === call.productId && r.at >= month)) +
        sum(open.filter((r) => r.productId === call.productId));
      if (used >= call.productMonthlyUsd) return { kind: "refused", limit: "product_monthly" };
    }
    const today = sum(this.all().filter((r) => r.at >= day)) + sum(open);
    if (today >= call.dailyUsd) return { kind: "refused", limit: "global_daily" };
    const id = `reservation-${++this.nextId}`;
    this.reservations.set(id, {
      productId: call.productId,
      task: call.task,
      reserveUsd: call.reserveUsd,
      expiresAt: new Date(call.at.getTime() + call.leaseSeconds * 1000),
    });
    return { kind: "ok", reservationId: id };
  }

  async finish(reservationId: string, row: UsageRow): Promise<void> {
    this.reservations.delete(reservationId);
    this.rows.push(row);
  }

  async usageSince(productId: string | null, since: Date, task?: LlmTask): Promise<UsageSince> {
    const rows = this.all().filter(
      (r) =>
        (productId === null || r.productId === productId) &&
        r.at >= since &&
        (task === undefined || r.task === task),
    );
    return { calls: rows.length, costUsd: rows.reduce((sum, r) => sum + r.costUsd, 0) };
  }
}
