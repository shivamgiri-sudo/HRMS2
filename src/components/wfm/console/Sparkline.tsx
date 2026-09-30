import * as React from "react";
import { cn } from "@/lib/utils";

export interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  /** Tailwind stroke/fill colour class root, e.g. "text-blue-600". */
  className?: string;
  /** Fill area under line. */
  area?: boolean;
  ariaLabel?: string;
}

/** Dependency-free SVG sparkline — cheap enough for dozens of tiles per page. */
export function Sparkline({ values, width = 84, height = 28, className, area = true, ariaLabel }: SparklineProps) {
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length < 2) return <span className="inline-block" style={{ width, height }} aria-hidden />;
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const span = max - min || 1;
  const pad = 2;
  const step = (width - pad * 2) / (clean.length - 1);
  const pts = clean.map((v, i) => [pad + i * step, pad + (height - pad * 2) * (1 - (v - min) / span)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const fill = `${line} L${pts[pts.length - 1][0].toFixed(1)},${height} L${pts[0][0].toFixed(1)},${height} Z`;
  const last = pts[pts.length - 1];
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("text-blue-600", className)}
      role="img"
      aria-label={ariaLabel ?? "trend"}
    >
      {area && <path d={fill} fill="currentColor" opacity={0.12} />}
      <path d={line} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r={2.25} fill="currentColor" />
    </svg>
  );
}

export default Sparkline;
