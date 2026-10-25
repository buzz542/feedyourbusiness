import { createServerPreviewDeps } from "@/server/preview/deps";
import { createPreviewHandler } from "@/server/preview/handler";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  return createPreviewHandler({
    deps: () => createServerPreviewDeps(),
    secret: process.env.APP_HMAC_SECRET,
  })(request);
}
