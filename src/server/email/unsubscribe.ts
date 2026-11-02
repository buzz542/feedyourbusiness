import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * One-click unsubscribe tokens (docs/PLAN.md 11): `HMAC(APP_HMAC_SECRET, user id, list)`. A token
 * never expires on its own; rotating the secret expires every token at once. Nothing is stored.
 */

export type EmailList = "daily" | "weekly";
const LISTS: readonly EmailList[] = ["daily", "weekly"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class UnsubscribeSecretError extends Error {
  override name = "UnsubscribeSecretError";
}

function key(secret: string | undefined): string {
  if (!secret || secret.length < 32 || /replace|example|changeme/i.test(secret))
    throw new UnsubscribeSecretError("APP_HMAC_SECRET must be 32 or more random characters");
  return secret;
}

const sign = (secret: string, userId: string, list: EmailList) =>
  createHmac("sha256", key(secret)).update(`unsubscribe:${userId}:${list}`).digest("base64url");

export function unsubscribeToken(secret: string | undefined, userId: string, list: EmailList) {
  return `${userId}.${list}.${sign(key(secret), userId, list)}`;
}

export function verifyUnsubscribeToken(
  secret: string | undefined,
  token: string | null,
): { userId: string; list: EmailList } | null {
  const [userId, list, mac, extra] = (token ?? "").split(".");
  if (extra !== undefined || !userId || !mac || !UUID.test(userId)) return null;
  if (!LISTS.includes(list as EmailList)) return null;
  const want = Buffer.from(sign(key(secret), userId, list as EmailList));
  const got = Buffer.from(mac);
  return want.length === got.length && timingSafeEqual(want, got)
    ? { userId, list: list as EmailList }
    : null;
}

export const unsubscribeUrl = (siteUrl: string, token: string) =>
  `${siteUrl}/api/unsubscribe?t=${encodeURIComponent(token)}`;

/** RFC 8058 headers for the daily and weekly emails. */
export const listUnsubscribeHeaders = (url: string): Record<string, string> => ({
  "List-Unsubscribe": `<${url}>`,
  "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
});

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const NAMES: Record<EmailList, string> = {
  daily: "the daily posts email",
  weekly: "the Monday digest",
};

/**
 * GET shows a confirm page and changes nothing (link scanners follow GETs); POST applies, which is
 * what a mail client's one-click button sends (RFC 8058) and what the confirm form sends.
 */
export function createUnsubscribeHandler(deps: {
  secret: () => string | undefined;
  turnOff(userId: string, list: EmailList): Promise<void>;
}) {
  const page = (status: number, title: string, body: string) =>
    new Response(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;line-height:1.5"><h1 style="font-size:1.25rem">${title}</h1>${body}</body></html>`,
      {
        status,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      },
    );
  const bad = () =>
    page(400, "This link does not work", "<p>Change your emails in Settings instead.</p>");

  return {
    async GET(request: Request): Promise<Response> {
      const token = new URL(request.url).searchParams.get("t");
      const parsed = verifyUnsubscribeToken(deps.secret(), token);
      if (!parsed || !token) return bad();
      return page(
        200,
        `Turn off ${NAMES[parsed.list]}?`,
        `<form method="post" action="/api/unsubscribe?t=${escapeHtml(encodeURIComponent(token))}"><button type="submit">Turn it off</button></form>`,
      );
    },
    async POST(request: Request): Promise<Response> {
      const parsed = verifyUnsubscribeToken(
        deps.secret(),
        new URL(request.url).searchParams.get("t"),
      );
      if (!parsed) return bad();
      await deps.turnOff(parsed.userId, parsed.list);
      return page(
        200,
        "Done",
        `<p>You will not get ${NAMES[parsed.list]} again. You can turn it back on in Settings.</p>`,
      );
    },
  };
}
