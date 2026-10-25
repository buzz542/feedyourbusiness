import type { RenderedEmail } from "./trial-reminder";

/**
 * The Monday digest (docs/PLAN.md 4.6, 11): top themes, rival changes and what to build next, in
 * our own words, with links into the app. Never a post excerpt, never a name or handle.
 */
export interface WeeklyDigestInput {
  weekLabel: string;
  themes: { title: string; count: number; trend: string }[];
  rivals: { name: string; complaints: number; trend: string }[];
  next: { title: string; summary: string }[];
  buildUrl: string;
  rivalsUrl: string;
  unsubscribeUrl: string;
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const WEEKLY_SUBJECT = "Your AskedFor week: what people asked for";

export function renderWeeklyDigest(input: WeeklyDigestInput): RenderedEmail {
  const footer = "You get this because the Monday digest is on in Settings.";
  const reminder = "Say you built it, if you reply to any of the posts behind these.";
  const themeLines = input.themes.map((t) => `${t.title}: ${t.count} posts, ${t.trend}`);
  const rivalLines = input.rivals.map((r) => `${r.name}: ${r.complaints} complaints, ${r.trend}`);
  const nextLines = input.next.map((n) => `${n.title}: ${n.summary}`);
  const text = [
    `Your week of ${input.weekLabel} in AskedFor.`,
    "",
    ...(themeLines.length ? ["Top themes", ...themeLines, ""] : []),
    ...(rivalLines.length ? ["Rival changes", ...rivalLines, ""] : []),
    ...(nextLines.length ? ["What to build next", ...nextLines, ""] : []),
    `Build tab: ${input.buildUrl}`,
    `Rivals tab: ${input.rivalsUrl}`,
    "",
    reminder,
    "",
    footer,
    `Unsubscribe: ${input.unsubscribeUrl}`,
  ].join("\n");
  const list = (title: string, items: string[]) =>
    items.length
      ? `<h2>${escapeHtml(title)}</h2><ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`
      : "";
  const html = [
    `<p>Your week of ${escapeHtml(input.weekLabel)} in AskedFor.</p>`,
    list("Top themes", themeLines),
    list("Rival changes", rivalLines),
    list("What to build next", nextLines),
    `<p><a href="${escapeHtml(input.buildUrl)}">Open the Build tab</a> · <a href="${escapeHtml(input.rivalsUrl)}">Open the Rivals tab</a></p>`,
    `<p><strong>${escapeHtml(reminder)}</strong></p>`,
    `<p>${escapeHtml(footer)} <a href="${escapeHtml(input.unsubscribeUrl)}">Unsubscribe</a></p>`,
  ]
    .filter(Boolean)
    .join("\n");
  return { subject: WEEKLY_SUBJECT, text, html };
}
