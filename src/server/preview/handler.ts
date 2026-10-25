import { clientIp, ipHash } from "@/server/privacy/ip-hash";
import { type PreviewDeps, runPreview } from "./preview";

/** POST /api/preview: { url } in, the preview or a reason out (docs/PLAN.md 8.5). */

const STATUS = {
  invalid_url: 400,
  platform_url: 400,
  rate_limited: 429,
  busy: 503,
  site_unreachable: 422,
  unavailable: 503,
} as const;

export const PREVIEW_MESSAGES = {
  invalid_url: "Enter your product's web address, like yourproduct.com.",
  platform_url: "Enter your own product's site, not a social media or forum link.",
  rate_limited: "You have used today's free previews. Start a trial to see your full feed.",
  busy: "Previews are busy today. Try again tomorrow, or start a trial.",
  site_unreachable: "We could not read that page. Check the address and try again.",
  unavailable: "The preview is not available right now.",
} as const;

export function createPreviewHandler(args: {
  deps: () => PreviewDeps | null;
  secret: string | undefined;
  clock?: () => Date;
}) {
  return async (request: Request): Promise<Response> => {
    const now = args.clock?.() ?? new Date();
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: PREVIEW_MESSAGES.invalid_url }, { status: 400 });
    }
    const url = (body as { url?: unknown } | null)?.url;
    const deps = args.deps();
    if (!deps || !args.secret || args.secret.length < 32)
      return Response.json({ error: PREVIEW_MESSAGES.unavailable }, { status: 503 });
    const out = await runPreview(
      deps,
      url,
      ipHash(args.secret, clientIp(request.headers), now),
      now,
    );
    if (out.ok) return Response.json(out.result, { headers: { "cache-control": "no-store" } });
    return Response.json({ error: PREVIEW_MESSAGES[out.reason] }, { status: STATUS[out.reason] });
  };
}
