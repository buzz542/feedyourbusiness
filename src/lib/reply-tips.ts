import type { FeedCategory } from "./reply-filters";

/**
 * Reply tips are fixed copy, one per category (docs/PLAN.md D8, 2.2.2). No model ever writes reply
 * text: these say how to approach a reply, and the user writes every word.
 */

/** Shown on every reply surface (docs/PLAN.md 2.2.3). */
export const DISCLOSURE = "Say you built it.";

export const CATEGORY_LABELS: Readonly<Record<FeedCategory, string>> = {
  looking_for_tool: "Looking for a tool",
  pain_point: "Pain point",
  mentions_you: "Mentions you",
  mentions_competitor: "Mentions a rival",
  wish: "Wish",
};

export const REPLY_TIPS: Readonly<Record<FeedCategory, string>> = {
  looking_for_tool:
    "Answer the question they asked first. If your tool fits, say what it does in one line, say you built it, and mention one thing it does not do.",
  pain_point:
    "Start with something useful they can try today, with or without your tool. Mention your product only if it solves this exact problem, and say you made it.",
  mentions_you:
    "Thank them, answer any question in the post, and fix or acknowledge any problem they raise. Keep it short and personal.",
  mentions_competitor:
    "Do not knock the other product. Answer what they asked, and if they want a change, say plainly what yours does differently and that you built it.",
  wish: "Ask what they would use it for before pitching anything. If you already have it, say so plainly and say you built it.",
};

export const SOURCE_LABELS: Readonly<Record<string, string>> = {
  reddit: "Reddit",
  hackernews: "Hacker News",
  bluesky: "Bluesky",
  x: "X",
};

/** "3h", "2d": how long ago a post was made. */
export function ageLabel(postedAt: Date, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - postedAt.getTime()) / 60_000));
  if (minutes < 60) return `${Math.max(minutes, 1)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** "Reddit · r/SaaS", "Hacker News", "Bluesky". */
export function whereLabel(source: string, community: string | null): string {
  const name = SOURCE_LABELS[source] ?? source;
  return community && community !== name ? `${name} · ${community}` : name;
}
