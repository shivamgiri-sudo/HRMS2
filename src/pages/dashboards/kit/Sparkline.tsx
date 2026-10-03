import { useId } from "react";

/** Dependency-free sparkline: ~1KB, renders instantly, no recharts. */
export function Sparkline({ values, color = "#2563eb", width = 96, height = 32, fill = true, fluid = false }: {
  values: number[]; color?: string; width?: number; height?: number; fill?: boolean;
  /** Stretch to the container width (viewBox keeps the shape); the end-dot is dropped so it never distorts. */
  fluid?: boolean;
}) {
  const id = useId();
  const pts = values.filter((v) => Number.isFinite(v));
  if (pts.length < 2) return null;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const pad = 2;
  const x = (i: number) => pad + (i * (width - pad * 2)) / (pts.length - 1);
  const y = (v: number) => height - pad - ((v - min) / span) * (height - pad * 2);
  const line = pts.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(pts.length - 1).toFixed(1)},${height} L${x(0).toFixed(1)},${height} Z`;
  return (
    <svg width={fluid ? "100%" : width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio={fluid ? "none" : undefined} aria-hidden="true" className="shrink-0 overflow-visible">
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity=".28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill ? <path d={area} fill={`url(#${id})`} /> : null}
      <path d={line} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" vectorEffect={fluid ? "non-scaling-stroke" : undefined} />
      {fluid ? null : <circle cx={x(pts.length - 1)} cy={y(pts[pts.length - 1])} r="2.4" fill={color} />}
    </svg>
  );
}
