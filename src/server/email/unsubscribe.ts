import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * One-click unsubscribe tokens (docs/PLAN.md 11): HMAC(APP_HMAC_SECRET, user id and list). A token
 * names one user and one list; changing the secret invalidates every token issued with the old one.
 */

export const LISTS = ["daily", "weekly"] as const;
export type EmailList = (typeof LISTS)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function mac(secret: string, userId: string, list: EmailList): string {
  return createHmac("sha256", secret).update(`unsubscribe:${userId}:${list}`).digest("base64url");
}

function usableSecret(secret: string | undefined): secret is string {
  return typeof secret === "string" && secret.length >= 32;
}

export function signUnsubscribe(
  secret: string | undefined,
  userId: string,
  list: EmailList,
): string {
  if (!usableSecret(secret)) throw new Error("APP_HMAC_SECRET must be at least 32 characters");
  return `${userId}.${list}.${mac(secret, userId, list)}`;
}

export function verifyUnsubscribe(
  secret: string | undefined,
  token: string | null | undefined,
): { userId: string; list: EmailList } | null {
  if (!usableSecret(secret) || !token || token.length > 200) return null;
  const [userId, list, sig, extra] = token.split(".");
  if (extra !== undefined || !userId || !sig || !UUID.test(userId)) return null;
  if (!(LISTS as readonly string[]).includes(list ?? "")) return null;
  const expected = Buffer.from(mac(secret, userId, list as EmailList));
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  return { userId, list: list as EmailList };
}

export function unsubscribeUrl(siteUrl: string, token: string): string {
  return `${siteUrl.replace(/\/$/, "")}/api/unsubscribe?t=${encodeURIComponent(token)}`;
}

/** List-Unsubscribe headers for one-click unsubscribe (RFC 8058). */
export function unsubscribeHeaders(url: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${url}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${title} | AskedFor</title></head><body style="font-family: system-ui, sans-serif; max-width: 32rem; margin: 4rem auto; padding: 0 1rem; line-height: 1.5">${body}</body></html>`;

const LIST_NAMES: Readonly<Record<EmailList, string>> = {
  daily: "the daily posts email",
  weekly: "the Monday digest",
};

/**
 * GET shows a confirm page (a link scanner must not unsubscribe anyone); POST applies, which is
 * also what a mail client's one-click button sends.
 */
export function createUnsubscribeHandler(deps: {
  secret: string | undefined;
  apply(userId: string, list: EmailList): Promise<void>;
}) {
  const html = (status: number, title: string, body: string) =>
    new Response(page(title, body), {
      status,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const token = url.searchParams.get("t");
    const target = verifyUnsubscribe(deps.secret, token);
    if (!target)
      return html(
        400,
        "Link not valid",
        "<h1>This unsubscribe link is not valid</h1><p>Turn emails off in Settings instead.</p>",
      );
    if (request.method === "GET") {
      const action = `/api/unsubscribe?t=${encodeURIComponent(token!)}`;
      return html(
        200,
        "Unsubscribe",
        `<h1>Unsubscribe from ${LIST_NAMES[target.list]}?</h1><form method="post" action="${action}"><button type="submit" style="padding: 0.5rem 1rem">Unsubscribe</button></form>`,
      );
    }
    if (request.method !== "POST") return new Response(null, { status: 405 });
    try {
      await deps.apply(target.userId, target.list);
    } catch (error) {
      console.error(`[unsubscribe] failed: ${error instanceof Error ? error.name : "Unknown"}`);
      return html(500, "Try again", "<h1>That did not work</h1><p>Try again in a minute.</p>");
    }
    return html(
      200,
      "Unsubscribed",
      `<h1>You are unsubscribed</h1><p>You will not get ${LIST_NAMES[target.list]} any more. You can turn it back on in Settings.</p>`,
    );
  };
}
