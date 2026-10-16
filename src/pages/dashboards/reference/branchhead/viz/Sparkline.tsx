import { isNum, r1, scale, toneColor, type Tone } from "./scale";
import { iconStyle } from "./parts";

const PAD = 2;

/**
 * Sparkline path over evenly spaced points; null / non-finite points break the line (a new "M").
 * Returns null with fewer than 3 finite points, so callers draw nothing rather than a misleading stub.
 */
export function sparklinePath(points: Array<number | null>, width: number, height: number) {
  const finite = points.filter(isNum);
  if (finite.length < 3) return null;
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const x = scale.linear([0, Math.max(1, points.length - 1)], [PAD, width - PAD]);
  const y = min === max ? () => height / 2 : scale.linear([min, max], [height - PAD, PAD]);
  let d = "";
  let pen = false;
  let last = { x: 0, y: 0 };
  points.forEach((p, i) => {
    if (!isNum(p)) { pen = false; return; }
    last = { x: r1(x(i)), y: r1(y(p)) };
    d += `${pen ? "L" : "M"}${last.x},${last.y}`;
    pen = true;
  });
  return { d, last, count: finite.length };
}

/** Trend line in the de-emphasis gray with the current point in the accent (or tone) colour. */
export function Sparkline({ points, tone, width = 96, height = 28, label }: {
  points: Array<number | null>; tone?: Tone; width?: number; height?: number; label: string;
}) {
  const p = sparklinePath(points, width, height);
  if (!p) return null;
  const finite = points.filter(isNum);
  return (
    <svg className="bh-viz bh-icon" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img"
      aria-label={`${label}: ${finite.length} points, from ${r1(finite[0])} to ${r1(finite[finite.length - 1])}`}
      style={{ ...iconStyle(width), height, overflow: "visible" }}>
      <path d={p.d} fill="none" stroke="var(--bh-other)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={p.last.x} cy={p.last.y} r="3" fill={toneColor(tone)} stroke="var(--bh-surface)" strokeWidth="1.5" />
    </svg>
  );
}
