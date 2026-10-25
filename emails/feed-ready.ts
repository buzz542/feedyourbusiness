import type { RenderedEmail } from "./trial-reminder";

/** Counts per category, our own labels: never a post excerpt (docs/PLAN.md 2.3.14, 11). */
export interface FeedReadyInput {
  counts: { label: string; count: number }[];
  appUrl: string;
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Sent once, when the first run after checkout finishes (docs/PLAN.md 7.3, 11). */
export function renderFeedReady(input: FeedReadyInput): RenderedEmail {
  const total = input.counts.reduce((sum, c) => sum + c.count, 0);
  const subject = "Your AskedFor feed is ready";
  const lead =
    total > 0
      ? `Your first run is done. ${total} ${total === 1 ? "post is" : "posts are"} waiting in your Reply tab.`
      : "Your first run is done. Nothing matched yet; new posts arrive every morning.";
  const lines = input.counts.filter((c) => c.count > 0).map((c) => `${c.label}: ${c.count}`);
  const footer = "Say you built it when you reply. This is a service email about your account.";
  const text = [lead, "", ...lines, ...(lines.length ? [""] : []), input.appUrl, "", footer].join(
    "\n",
  );
  const html = [
    `<p>${escapeHtml(lead)}</p>`,
    lines.length ? `<ul>${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>` : "",
    `<p><a href="${escapeHtml(input.appUrl)}">Open AskedFor</a></p>`,
    `<p>${escapeHtml(footer)}</p>`,
  ]
    .filter(Boolean)
    .join("\n");
  return { subject, text, html };
}
