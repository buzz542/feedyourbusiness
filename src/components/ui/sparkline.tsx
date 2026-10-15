/**
 * A tiny inline SVG trend line (docs/PLAN.md 9.4). The label carries the meaning for screen
 * readers; the line is decoration for sighted readers next to the numbers it summarizes.
 */
export function Sparkline({
  values,
  label,
  width = 80,
  height = 20,
}: {
  values: readonly number[];
  label: string;
  width?: number;
  height?: number;
}) {
  const finite = values.map((v) => (Number.isFinite(v) ? v : 0));
  const max = Math.max(0, ...finite);
  const min = Math.min(0, ...finite);
  const span = max - min || 1;
  const pad = 2;
  const step = finite.length > 1 ? (width - pad * 2) / (finite.length - 1) : 0;
  const points = finite
    .map((v, i) => {
      const x = finite.length > 1 ? pad + i * step : width / 2;
      const y = height - pad - ((v - min) / span) * (height - pad * 2);
      return `${round(x)},${round(y)}`;
    })
    .join(" ");

  return (
    <svg
      role="img"
      aria-label={label}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="inline-block align-middle text-accent"
    >
      {finite.length > 0 ? (
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ) : null}
    </svg>
  );
}

const round = (n: number) => Math.round(n * 100) / 100;
