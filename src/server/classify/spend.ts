import { startOfUtcDay, startOfUtcMonth, type SpendCap, type SpendCaps } from "@/server/llm/llm";
import type { Clock, UsageStore } from "@/server/llm/ports";

/**
 * The model spend cap a product has reached (docs/PLAN.md 8.1), checked before a collect run
 * reserves budget, so no paid fetch starts whose posts could not be classified. The wrapper still
 * checks every call under its lock; this is the cheap early stop.
 */
export function createSpendCapCheck(deps: {
  usage: Pick<UsageStore, "usageSince">;
  caps: SpendCaps;
  clock: Clock;
}): (productId: string) => Promise<SpendCap | null> {
  return async (productId) => {
    const now = deps.clock.now();
    const product = await deps.usage.usageSince(productId, startOfUtcMonth(now));
    if (product.costUsd >= deps.caps.productMonthlyUsd) return "product_monthly";
    const all = await deps.usage.usageSince(null, startOfUtcDay(now));
    if (all.costUsd >= deps.caps.dailyUsd) return "global_daily";
    return null;
  };
}
