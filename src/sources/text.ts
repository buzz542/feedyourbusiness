import { decodeEntities } from "@/lib/html-entities";

/** Plain text from a source's HTML (Hacker News comments, story text): tags out, entities decoded. */
export function htmlToText(html: string): string {
  const spaced = html.replace(/<\/?(p|br|div|li|ul|ol|pre|blockquote|h[1-6]|tr|td)\b[^>]*>/gi, " ");
  // Inline tags (<i>, <a>, <code>) go without a space, so "word<i>s</i>" stays one word.
  return decodeEntities(spaced.replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

export const MAX_EXCERPT = 280;

/** At most 280 characters (docs/PLAN.md 2.3.1), cut with an ellipsis, never inside a surrogate pair. */
export function toExcerpt(text: string, max = MAX_EXCERPT): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  let cut = clean.slice(0, max - 1);
  if (/[\ud800-\udbff]$/.test(cut)) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}
