"use server";

import { headers } from "next/headers";
import { createServerPreviewDeps } from "@/server/preview/deps";
import { PREVIEW_MESSAGES } from "@/server/preview/handler";
import { runPreview } from "@/server/preview/preview";
import type { PreviewResult } from "@/server/preview/schema";
import { clientIp, ipHash } from "@/server/privacy/ip-hash";

export type PreviewState =
  | { status: "idle" }
  | { status: "done"; result: PreviewResult }
  | { status: "error"; message: string };

/** The landing page's instant preview (docs/PLAN.md 8.5): the same checks as POST /api/preview. */
export async function previewAction(
  _previous: PreviewState,
  formData: FormData,
): Promise<PreviewState> {
  const secret = process.env.APP_HMAC_SECRET;
  const deps = createServerPreviewDeps();
  if (!deps || !secret || secret.length < 32)
    return { status: "error", message: PREVIEW_MESSAGES.unavailable };
  const now = new Date();
  const out = await runPreview(
    deps,
    String(formData.get("url") ?? ""),
    ipHash(secret, clientIp(await headers()), now),
    now,
  );
  return out.ok
    ? { status: "done", result: out.result }
    : { status: "error", message: PREVIEW_MESSAGES[out.reason] };
}
