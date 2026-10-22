/**
 * A tiny inline SVG trend line (docs/PLAN.md 9.4). The label states the numbers so the line is never
 * the only carrier of information.
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
  const clean = values.map((v) => (Number.isFinite(v) ? v : 0));
  if (clean.length === 0) return null;
  const max = Math.max(...clean);
  const min = Math.min(...clean);
  const span = max - min || 1;
  const pad = 1.5;
  const step = clean.length > 1 ? (width - pad * 2) / (clean.length - 1) : 0;
  const points = clean
    .map((v, i) => {
      const x = clean.length > 1 ? pad + i * step : width / 2;
      const y = max === min ? height / 2 : pad + (1 - (v - min) / span) * (height - pad * 2);
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
      className="inline-block text-accent"
    >
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

const round = (n: number) => Math.round(n * 10) / 10;
