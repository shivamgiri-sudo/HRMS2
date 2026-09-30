interface Props {
  values: Array<number | null>;
  color?: string;
  height?: number;
  className?: string;
}

/** Inline SVG sparkline — no chart library, no layout shift. Gaps (null) break the line. */
export function OpsSparkline({ values, color = "currentColor", height = 28, className }: Props) {
  const pts = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null);
  if (pts.length < 2) return <div style={{ height }} aria-hidden className={className} />;
  const w = 100;
  const min = Math.min(...pts.map((p) => p.v));
  const max = Math.max(...pts.map((p) => p.v));
  const span = max - min || 1;
  const x = (i: number) => (i / Math.max(values.length - 1, 1)) * w;
  const y = (v: number) => height - 3 - ((v - min) / span) * (height - 6);
  const d = pts.map((p, k) => `${k === 0 ? "M" : "L"}${x(p.i).toFixed(2)},${y(p.v).toFixed(2)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" width="100%" height={height} className={className} role="img" aria-label={`Trend: ${pts[0].v} to ${last.v}`}>
      <path d={`${d} L${x(last.i)},${height} L${x(pts[0].i)},${height} Z`} fill={color} opacity={0.1} />
      <path d={d} fill="none" stroke={color} strokeWidth={1.6} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last.i)} cy={y(last.v)} r={2.2} fill={color} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
