import type { FeedView } from "@/lib/feed-views";

/** The views' names, here so the copy gate reads them (src/lib holds the counting rules). */
export const VIEW_LABELS: Readonly<Record<FeedView, string>> = {
  today: "Today",
  all: "All conversations",
  saved: "Saved",
  replied: "Replied",
  hidden: "Hidden",
};
