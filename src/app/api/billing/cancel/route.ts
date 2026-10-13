import { getBillingDeps } from "@/server/billing/deps";
import { createCancelHandler } from "@/server/billing/handlers";
import { guard } from "@/server/http/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return guard(() => createCancelHandler(getBillingDeps())(request));
}
