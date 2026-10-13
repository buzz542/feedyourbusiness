import { getWebhookDeps } from "@/server/billing/deps";
import { createWebhookHandler } from "@/server/billing/handlers";
import { guard } from "@/server/http/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return guard(() => createWebhookHandler(getWebhookDeps())(request));
}
