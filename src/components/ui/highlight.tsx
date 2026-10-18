/**
 * The highlighter mark over the words in an excerpt that ask for something (docs/PLAN.md 9.4).
 *
 * Offsets count characters (Unicode code points), the same way Postgres counts the 280-character
 * excerpt, so an emoji before the range never shifts or splits it. Offsets that do not describe a
 * non-empty range inside the text render the text plain.
 */
export { findHighlight } from "@/lib/highlight-range";

export function Highlight({
  text,
  start,
  end,
}: {
  text: string;
  start: number | null | undefined;
  end: number | null | undefined;
}) {
  const chars = Array.from(text);
  const usable =
    start != null &&
    end != null &&
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    start >= 0 &&
    end <= chars.length &&
    start < end;
  if (!usable) return <>{text}</>;

  return (
    <>
      {chars.slice(0, start).join("")}
      <mark className="rounded-[1px] bg-highlight px-0.5 text-ink">
        {chars.slice(start, end).join("")}
      </mark>
      {chars.slice(end).join("")}
    </>
  );
}
