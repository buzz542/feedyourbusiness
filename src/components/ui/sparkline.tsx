/**
 * A tiny inline SVG trend line (docs/PLAN.md 9.4), oldest value on the left. Decorative shape
 * plus an accessible label, so the trend is never carried by the line alone. A value that is not
 * a finite number keeps its slot on the time axis but draws no point.
 */

const round = (n: number) => Math.round(n * 10) / 10;
const PAD = 2;

export function sparklinePoints(
  values: readonly number[],
  width: number,
  height: number,
): Array<[number, number]> {
  const finite = values.filter((x) => Number.isFinite(x));
  if (finite.length === 0) return [];
  const min = Math.min(...finite);
  const span = Math.max(...finite) - min;
  const step = values.length > 1 ? (width - 2 * PAD) / (values.length - 1) : 0;
  const points: Array<[number, number]> = [];
  values.forEach((value, i) => {
    if (!Number.isFinite(value)) return;
    const x = values.length > 1 ? PAD + i * step : width / 2;
    const y = span === 0 ? height / 2 : PAD + (1 - (value - min) / span) * (height - 2 * PAD);
    points.push([round(x), round(y)]);
  });
  return points;
}

export function Sparkline({
  values,
  label,
  width = 96,
  height = 24,
  className,
}: {
  values: readonly number[];
  label: string;
  width?: number;
  height?: number;
  className?: string;
}) {
  const points = sparklinePoints(values, width, height);
  const only = points.length === 1 ? points[0] : undefined;
  return (
    <svg
      role="img"
      aria-label={label}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      focusable="false"
      className={className}
    >
      {points.length > 1 ? (
        <polyline
          points={points.map(([x, y]) => `${x},${y}`).join(" ")}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ) : null}
      {/* One point draws no line, so show it as a dot. */}
      {only ? <circle cx={only[0]} cy={only[1]} r={1.5} fill="currentColor" /> : null}
    </svg>
  );
}
