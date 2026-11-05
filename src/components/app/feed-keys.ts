/**
 * Reply tab keyboard shortcuts (docs/PLAN.md 4.4): j and k move between cards, o opens the post,
 * s saves, r marks replied, h hides, ? shows the keys. Pure, so the mapping is unit tested.
 */

export type FeedKeyAction = "next" | "previous" | "open" | "save" | "replied" | "hide" | "help";

export const FEED_KEYS: ReadonlyArray<[string, FeedKeyAction, string]> = [
  ["j", "next", "Next post"],
  ["k", "previous", "Previous post"],
  ["o", "open", "Open the post in a new tab"],
  ["s", "save", "Save"],
  ["r", "replied", "Mark replied"],
  ["h", "hide", "Hide"],
  ["?", "help", "Show or hide these keys"],
];

const BY_KEY = new Map(FEED_KEYS.map(([key, action]) => [key, action]));

export interface KeyLike {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  /** The element the key was pressed in. */
  target: { tagName?: string; isContentEditable?: boolean } | null;
}

/** Null for keys we leave alone: typing in a field, or with a modifier (browser shortcuts). */
export function feedKeyAction(event: KeyLike): FeedKeyAction | null {
  if (event.altKey || event.ctrlKey || event.metaKey) return null;
  const tag = event.target?.tagName?.toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || event.target?.isContentEditable)
    return null;
  return BY_KEY.get(event.key) ?? null;
}

/** The card to move to: -1 means none chosen yet; it never runs past either end. */
export function moveIndex(current: number, action: "next" | "previous", count: number): number {
  if (count === 0) return -1;
  if (current < 0) return action === "next" ? 0 : count - 1;
  return Math.min(count - 1, Math.max(0, current + (action === "next" ? 1 : -1)));
}
