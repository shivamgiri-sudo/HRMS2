import React, { useMemo } from "react";

export interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  strokeColor?: string;
  strokeWidth?: number;
  className?: string;
}

/**
 * Minimal inline SVG sparkline — renders a polyline with a subtle gradient fill.
 * If data has fewer than 2 points, renders nothing.
 */
export function Sparkline({
  data,
  width = 50,
  height = 20,
  strokeColor = "currentColor",
  strokeWidth = 1.5,
  className = "",
}: SparklineProps) {
  const { polyline, areaPath } = useMemo(() => {
    if (!data || data.length < 2) return { polyline: "", areaPath: "" };

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1; // avoid division by zero for flat lines
    const padding = 1; // px padding top/bottom

    const points = data.map((val, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = padding + (1 - (val - min) / range) * (height - padding * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    const polyline = points.join(" ");
    // Close path for gradient fill: line to bottom-right, then bottom-left
    const areaPath = `M${points[0]} ${points.slice(1).map(p => `L${p}`).join(" ")} L${width},${height} L0,${height} Z`;

    return { polyline, areaPath };
  }, [data, width, height]);

  if (!data || data.length < 2) return null;

  // Generate a unique ID for the gradient so multiple sparklines on the same page don't conflict
  const gradientId = useMemo(
    () => `sparkline-grad-${Math.random().toString(36).slice(2, 8)}`,
    []
  );

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={`inline-block shrink-0 ${className}`}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={strokeColor} stopOpacity={0.2} />
          <stop offset="100%" stopColor={strokeColor} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradientId})`} />
      <polyline
        points={polyline}
        fill="none"
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
