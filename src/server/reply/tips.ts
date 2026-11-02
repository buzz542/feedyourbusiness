import type { FeedCategory } from "@/server/store/feed";

/**
 * Reply tips (docs/PLAN.md D8, 4.4): fixed copy per category, written by us. No model ever writes
 * reply text, and these never suggest wording for a particular post.
 */
export const REPLY_TIPS: Readonly<Record<FeedCategory, string>> = {
  looking_for_tool:
    "Answer what they asked first. Mention what you built only if it fits what they need, and say it is yours.",
  pain_point:
    "Share what has worked for you on this problem. Offer your product as one option, not the only one.",
  mentions_you: "Thank them, answer any question directly, and say you are on the team behind it.",
  mentions_competitor:
    "Be fair about the other tool. Say what yours does differently, and that you built it.",
  wish: "Say whether what you built does this today. If it does not, ask what would make it useful.",
};

export const DISCLOSURE = "Say you built it.";

export const CATEGORY_LABELS: Readonly<Record<FeedCategory, string>> = {
  looking_for_tool: "Looking for a tool",
  pain_point: "Pain point",
  mentions_you: "Mentions you",
  mentions_competitor: "Mentions a rival",
  wish: "Wish",
};

export const SOURCE_LABELS: Readonly<Record<string, string>> = {
  reddit: "Reddit",
  hackernews: "Hacker News",
  bluesky: "Bluesky",
  x: "X",
};
