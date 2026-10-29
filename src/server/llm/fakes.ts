import type {
  LlmClient,
  LlmReply,
  LlmRequest,
  LlmTask,
  UsageRow,
  UsageSince,
  UsageStore,
} from "./ports";

/** A model that answers from a script, recording every request. */
export class FakeLlmClient implements LlmClient {
  readonly requests: LlmRequest[] = [];
  constructor(private readonly replies: LlmReply[]) {}

  async complete(request: LlmRequest): Promise<LlmReply> {
    this.requests.push(request);
    const reply = this.replies.shift();
    if (!reply) throw new Error("FakeLlmClient: no reply left");
    return reply;
  }
}

/** llm_usage in memory. */
export class FakeUsageStore implements UsageStore {
  readonly rows: UsageRow[] = [];
  private readonly seeded: {
    productId: string | null;
    costUsd: number;
    at: Date;
    task?: LlmTask;
  }[] = [];

  seed(row: { productId: string | null; costUsd: number; at: Date; task?: LlmTask }): void {
    this.seeded.push(row);
  }

  async record(row: UsageRow): Promise<void> {
    this.rows.push(row);
  }

  async usageSince(productId: string | null, since: Date, task?: LlmTask): Promise<UsageSince> {
    const rows = [...this.seeded, ...this.rows].filter(
      (r) =>
        (productId === null || r.productId === productId) &&
        r.at >= since &&
        (task === undefined || r.task === task),
    );
    return { calls: rows.length, costUsd: rows.reduce((sum, r) => sum + r.costUsd, 0) };
  }
}
