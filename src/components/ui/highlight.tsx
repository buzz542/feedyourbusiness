/**
 * The highlighter mark (docs/PLAN.md 9.4): wraps exactly `text[start, end)` in `<mark>`. Offsets come
 * from the classifier's exact-match step; anything out of range or inverted renders plain text.
 */
export function Highlight({
  text,
  start,
  end,
}: {
  text: string;
  start?: number | null;
  end?: number | null;
}) {
  if (
    start == null ||
    end == null ||
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end > text.length ||
    end <= start
  ) {
    return <>{text}</>;
  }
  return (
    <>
      {text.slice(0, start)}
      <mark className="rounded-[1px] px-0.5">{text.slice(start, end)}</mark>
      {text.slice(end)}
    </>
  );
}
