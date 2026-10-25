import type { RenderedEmail } from "./trial-reminder";

/**
 * The daily posts email (docs/PLAN.md 4.4, 11): source, community, age, category and our own
 * one-line reason, each linking to the card in the app. Never a post excerpt (2.3.14).
 */
export interface DailyPostItem {
  where: string;
  age: string;
  category: string;
  reason: string;
  cardUrl: string;
}

export interface DailyPostsInput {
  items: DailyPostItem[];
  appUrl: string;
  unsubscribeUrl: string;
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const DAILY_SUBJECT = "New posts worth replying to";

export function renderDailyPosts(input: DailyPostsInput): RenderedEmail {
  const n = input.items.length;
  const lead = `${n} new ${n === 1 ? "post" : "posts"} worth replying to in AskedFor today.`;
  const reminder = "Say you built it.";
  const footer = "You get this because the daily posts email is on in Settings.";
  const text = [
    lead,
    "",
    ...input.items.flatMap((i) => [
      `${i.category} · ${i.where} · ${i.age}`,
      i.reason,
      i.cardUrl,
      "",
    ]),
    reminder,
    "",
    `Open AskedFor: ${input.appUrl}`,
    "",
    footer,
    `Unsubscribe: ${input.unsubscribeUrl}`,
  ].join("\n");
  const html = [
    `<p>${escapeHtml(lead)}</p>`,
    "<ul>",
    ...input.items.map(
      (i) =>
        `<li><p><strong>${escapeHtml(i.category)}</strong> · ${escapeHtml(i.where)} · ${escapeHtml(i.age)}<br>${escapeHtml(i.reason)}<br><a href="${escapeHtml(i.cardUrl)}">Open in AskedFor</a></p></li>`,
    ),
    "</ul>",
    `<p><strong>${escapeHtml(reminder)}</strong></p>`,
    `<p><a href="${escapeHtml(input.appUrl)}">Open AskedFor</a></p>`,
    `<p>${escapeHtml(footer)} <a href="${escapeHtml(input.unsubscribeUrl)}">Unsubscribe</a></p>`,
  ].join("\n");
  return { subject: DAILY_SUBJECT, text, html };
}
