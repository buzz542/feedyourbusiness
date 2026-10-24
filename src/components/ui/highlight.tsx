/**
 * The highlighter (docs/PLAN.md 9.4): wraps exactly text[start, end) in <mark>, styled by the
 * --highlight token in globals.css. Offsets are UTF-16 code units, as String.prototype.indexOf
 * returns them. (M4: the planned highlight_end bound of 280 counts code units, while the excerpt cap
 * counts code points, so an excerpt with emoji can need an end above 280. Size the check for that.)
 * This component trusts nothing: an invalid range, or one that would split a surrogate pair,
 * renders the plain text instead of a partial or wrong mark.
 */

const isHigh = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLow = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/** True when offset `i` falls between the two halves of a surrogate pair. */
const splitsPair = (text: string, i: number) =>
  i > 0 && i < text.length && isHigh(text.charCodeAt(i - 1)) && isLow(text.charCodeAt(i));

export function validRange(
  text: string,
  start: number | null | undefined,
  end: number | null | undefined,
): boolean {
  return (
    typeof start === "number" &&
    typeof end === "number" &&
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    start >= 0 &&
    end <= text.length &&
    start < end &&
    !splitsPair(text, start) &&
    !splitsPair(text, end)
  );
}

export function Highlight({
  text,
  start,
  end,
}: {
  text: string;
  start: number | null | undefined;
  end: number | null | undefined;
}) {
  if (!validRange(text, start, end)) return <>{text}</>;
  const [from, to] = [start as number, end as number];
  return (
    <>
      {text.slice(0, from)}
      <mark>{text.slice(from, to)}</mark>
      {text.slice(to)}
    </>
  );
}
