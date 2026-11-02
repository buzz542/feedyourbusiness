import type { RenderedEmail } from "./trial-reminder";

/**
 * "New posts worth replying to" (docs/PLAN.md 4.4, 11): the top posts by match with source,
 * community, age, category and our own one-line reason, each linking to its card in the app. Never
 * an excerpt (2.3.14), no images, no tracking. US English, no em dashes.
 */

export interface DigestPost {
  /** "Reddit · r/SaaS", "Hacker News". */
  where: string;
  age: string;
  category: string;
  reason: string;
  cardUrl: string;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function renderDailyPosts(input: {
  posts: readonly DigestPost[];
  appUrl: string;
  unsubscribeUrl: string;
}): RenderedEmail {
  const subject = "New posts worth replying to";
  const lines = input.posts.map(
    (p) => `- ${p.where}, ${p.age} ago, ${p.category}: ${p.reason}\n  ${p.cardUrl}`,
  );
  const text = [
    "Here are today's posts worth replying to. Open each one, reply in your own words, and say you built it.",
    "",
    ...lines,
    "",
    "Say you built it.",
    "",
    `All posts: ${input.appUrl}`,
    `Stop these emails: ${input.unsubscribeUrl}`,
  ].join("\n");
  const items = input.posts
    .map(
      (p) =>
        `<li style="margin-bottom:12px"><strong>${escapeHtml(p.where)}</strong>, ${escapeHtml(p.age)} ago, ${escapeHtml(p.category)}<br>${escapeHtml(p.reason)}<br><a href="${escapeHtml(p.cardUrl)}">Open in AskedFor</a></li>`,
    )
    .join("");
  const html = `<div style="font-family:system-ui,sans-serif;line-height:1.5;max-width:36rem"><p>Here are today's posts worth replying to. Open each one, reply in your own words, and say you built it.</p><ul style="padding-left:18px">${items}</ul><p><strong>Say you built it.</strong></p><p><a href="${escapeHtml(input.appUrl)}">All posts</a></p><p style="font-size:12px;color:#555"><a href="${escapeHtml(input.unsubscribeUrl)}">Stop these emails</a></p></div>`;
  return { subject, text, html };
}

/** "Your feed is ready" at the end of the first run (docs/PLAN.md 11): counts and a link only. */
export function renderFeedReady(input: {
  counts: readonly { category: string; count: number }[];
  appUrl: string;
}): RenderedEmail {
  const total = input.counts.reduce((n, c) => n + c.count, 0);
  const subject = "Your AskedFor feed is ready";
  const list = input.counts.filter((c) => c.count > 0);
  const text = [
    total > 0
      ? `Your first collection found ${total} posts worth a look.`
      : "Your first collection has finished. Nothing matched yet; new posts arrive every morning.",
    ...list.map((c) => `- ${c.category}: ${c.count}`),
    "",
    "Say you built it.",
    "",
    `Open your feed: ${input.appUrl}`,
  ].join("\n");
  const html = `<div style="font-family:system-ui,sans-serif;line-height:1.5;max-width:36rem"><p>${
    total > 0
      ? `Your first collection found ${total} posts worth a look.`
      : "Your first collection has finished. Nothing matched yet; new posts arrive every morning."
  }</p><ul>${list.map((c) => `<li>${escapeHtml(c.category)}: ${c.count}</li>`).join("")}</ul><p><strong>Say you built it.</strong></p><p><a href="${escapeHtml(input.appUrl)}">Open your feed</a></p></div>`;
  return { subject, text, html };
}
