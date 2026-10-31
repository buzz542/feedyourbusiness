/**
 * Where `phrase` first occurs in `text`, as code-point offsets: the way Postgres counts the
 * 280-character excerpt and the way <Highlight> slices it, so an emoji before the range never
 * shifts or splits it. Exact match only (docs/PLAN.md 8.2): no match, no highlight.
 */
export function findHighlight(text: string, phrase: string): { start: number; end: number } | null {
  if (!phrase) return null;
  const index = text.indexOf(phrase);
  if (index < 0) return null;
  const start = Array.from(text.slice(0, index)).length;
  return { start, end: start + Array.from(phrase).length };
}

/** The excerpt's length in code points, the bound for a highlight's end. */
export const charLength = (text: string) => Array.from(text).length;
