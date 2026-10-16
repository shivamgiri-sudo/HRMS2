import { EmptyState, Legend, TipBody } from "./parts";
import { isNum, r1, scale } from "./scale";
import { useChartTooltip } from "./useChartTooltip";

export interface WaterfallStep { id: string; label: string; value: number; kind: "total" | "delta" }

/**
 * Running totals: a "total" bar spans 0..value and resets the running sum; a "delta" bar spans
 * running..running+value. Domain always includes 0, so negative totals hang below the baseline.
 */
export function waterfallLayout(steps: WaterfallStep[]) {
  let running = 0;
  const bars = steps.map((s) => {
    const v = isNum(s.value) ? s.value : 0;
    if (s.kind === "total") {
      running = v;
      return { id: s.id, from: 0, to: v, kind: "total" as const, running };
    }
    const from = running;
    running += v;
    return { id: s.id, from, to: running, kind: v < 0 ? ("down" as const) : ("up" as const), running };
  });
  const ends = bars.flatMap((b) => [b.from, b.to]);
  return { bars, min: Math.min(0, ...ends), max: Math.max(0, ...ends), final: running };
}

const W = 600;
const PAD = { l: 8, r: 8, t: 20, b: 34 };
const COLOR = { total: "var(--bh-ink-2)", up: "var(--bh-pos)", down: "var(--bh-neg)" } as const;
const KIND_WORD = { total: "Total", up: "Increase", down: "Decrease" } as const;

export function Waterfall({ steps, format, height = 200 }: { steps: WaterfallStep[]; format: (n: number) => string; height?: number }) {
  const l = waterfallLayout(steps);
  const n = steps.length;
  const lo = l.min < 0 ? -scale.niceMax(-l.min) : 0;
  const hi = l.max > 0 ? scale.niceMax(l.max) : 0;
  const y = scale.linear([lo, hi === lo ? 1 : hi], [height - PAD.b, PAD.t]);
  const band = (W - PAD.l - PAD.r) / Math.max(1, n);
  const bw = Math.min(24, band * 0.6);
  const cx = (i: number) => PAD.l + band * i + band / 2;
  const { surfaceProps, markProps, tooltip, active } = useChartTooltip(steps.map((s, i) => ({
    x: (cx(i) / W) * 100,
    y: (Math.min(y(l.bars[i].from), y(l.bars[i].to)) / height) * 100,
    content: <TipBody value={format(s.value)} label={`${s.label} (${KIND_WORD[l.bars[i].kind]})`} color={COLOR[l.bars[i].kind]}
      extra={s.kind === "delta" ? <div className="bh-tip-sub">Running total {format(l.bars[i].running)}</div> : null} />,
  })));
  if (!n) return <EmptyState height={height} />;
  const zeroY = r1(y(0));
  const summary = steps.map((s) => `${s.label} ${format(s.value)}`).join(", ");
  const kinds = new Set(l.bars.map((b) => b.kind));
  return (
    <div className={active != null ? "bh-viz bh-chart bh-dim" : "bh-viz bh-chart"}>
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={`Waterfall: ${summary}`} {...surfaceProps}
        onPointerLeave={() => surfaceProps.onBlur()}>
        <line x1={PAD.l} x2={W - PAD.r} y1={zeroY} y2={zeroY} stroke="var(--bh-axis)" strokeWidth="1" />
        {l.bars.map((b, i) => {
          const top = r1(Math.min(y(b.from), y(b.to)));
          const h = r1(Math.max(1, Math.abs(y(b.from) - y(b.to))));
          const next = l.bars[i + 1];
          const labelBelow = b.to < b.from || (b.kind === "total" && b.to < 0);
          return (
            <g key={b.id} {...markProps(i)}>
              <rect x={cx(i) - band / 2} y={PAD.t} width={band} height={height - PAD.t - PAD.b} fill="transparent" />
              <rect className={i === active ? "bh-mark bh-on" : "bh-mark"} x={r1(cx(i) - bw / 2)} y={top} width={r1(bw)} height={h} rx="3" fill={COLOR[b.kind]} />
              {next && next.kind !== "total" ? (
                <line x1={cx(i) + bw / 2} x2={cx(i + 1) - bw / 2} y1={r1(y(b.to))} y2={r1(y(b.to))} stroke="var(--bh-axis)" strokeWidth="1" />
              ) : null}
              <text x={cx(i)} y={labelBelow ? top + h + 12 : top - 5} textAnchor="middle" className="bh-label-text">{format(steps[i].value)}</text>
              <text x={cx(i)} y={height - 8} textAnchor="middle" className="bh-axis-text">{steps[i].label.length > 14 ? `${steps[i].label.slice(0, 13)}…` : steps[i].label}</text>
            </g>
          );
        })}
      </svg>
      <Legend items={(["total", "up", "down"] as const).filter((k) => kinds.has(k)).map((k) => ({ key: k, label: KIND_WORD[k], color: COLOR[k] }))} />
      {tooltip}
    </div>
  );
}
