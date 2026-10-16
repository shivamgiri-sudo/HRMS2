import { useId } from "react";
import { EmptyState, Legend, TipBody } from "./parts";
import { isNum, r1, scale, seriesColor } from "./scale";
import { useChartTooltip } from "./useChartTooltip";

export interface LineSeries {
  key: string;
  label: string;
  points: Array<{ x: string; y: number | null }>;
  dashed?: boolean;
}

const W = 600;
const PAD = { l: 44, r: 16, t: 12, b: 24 };

/**
 * Geometry for up to 4 series on one y-axis (never two). Null points break the line; a series with a
 * single finite point gets a dot and an empty path. Domain always includes 0 and any negatives.
 */
export function lineLayout(series: LineSeries[], width: number, height: number) {
  const labels = series.reduce<string[]>((acc, s) => (s.points.length > acc.length ? s.points.map((p) => p.x) : acc), []);
  const all = series.flatMap((s) => s.points.map((p) => p.y).filter(isNum));
  const rawMin = Math.min(0, ...all);
  const rawMax = Math.max(0, ...all);
  const yMax = rawMax > 0 ? scale.niceMax(rawMax) : 0;
  const yMin = rawMin < 0 ? -scale.niceMax(-rawMin) : 0;
  const top = yMax === yMin ? 1 : yMax;
  const x = scale.linear([0, Math.max(1, labels.length - 1)], [PAD.l, width - PAD.r]);
  const xAt = (i: number) => r1(labels.length === 1 ? (PAD.l + width - PAD.r) / 2 : x(i));
  const y = scale.linear([yMin, top], [height - PAD.b, PAD.t]);
  const base = r1(y(Math.max(yMin, Math.min(0, top))));
  return {
    labels,
    xs: labels.map((_, i) => xAt(i)),
    yMin,
    yMax: top,
    zeroY: base,
    ticks: [yMin, ...(yMin < 0 && top > 0 ? [0] : []), top].map((v) => ({ v, y: r1(y(v)) })),
    series: series.map((s) => {
      const finite = s.points.map((p, i) => ({ i, v: p.y })).filter((p): p is { i: number; v: number } => isNum(p.v));
      const ok = (i: number) => isNum(s.points[i]?.y);
      const dots = finite.map((p) => ({ i: p.i, x: xAt(p.i), y: r1(y(p.v)), v: p.v, isolated: !ok(p.i - 1) && !ok(p.i + 1) }));
      if (finite.length < 2) return { key: s.key, d: "", area: "", dots, dashed: !!s.dashed };
      let d = "";
      let area = "";
      let run: typeof dots = [];
      const flush = () => {
        if (run.length > 1) area += `M${run[0].x},${base}${run.map((p) => `L${p.x},${p.y}`).join("")}L${run[run.length - 1].x},${base}Z`;
        run = [];
      };
      s.points.forEach((p, i) => {
        if (!isNum(p.y)) { flush(); return; }
        const pt = dots.find((dd) => dd.i === i)!;
        d += `${run.length ? "L" : "M"}${pt.x},${pt.y}`;
        run.push(pt);
      });
      flush();
      return { key: s.key, d, area, dots, dashed: !!s.dashed };
    }),
  };
}

/** Trend over time. First series gets a 10% area wash; dashed series read as target / projection. */
export function LineArea({ series, format, height = 180 }: { series: LineSeries[]; format: (n: number) => string; height?: number }) {
  const clipId = useId();
  const shown = series.slice(0, 4);
  const l = lineLayout(shown, W, height);
  const hasData = l.series.some((s) => s.dots.length > 0);
  const { surfaceProps, markProps, tooltip, active } = useChartTooltip(l.labels.map((lab, i) => ({
    x: (l.xs[i] / W) * 100,
    y: 8,
    content: (
      <div>
        <div className="bh-tip-sub">{lab}</div>
        {shown.map((s, si) => {
          const v = s.points[i]?.y;
          return <TipBody key={s.key} value={isNum(v) ? format(v) : "—"} label={s.label} color={seriesColor(si)} />;
        })}
      </div>
    ),
  })));
  if (!hasData) return <EmptyState height={height} />;
  const step = Math.max(1, Math.ceil(l.labels.length / 6));
  const last = shown[0]?.points.length ? l.series[0].dots[l.series[0].dots.length - 1] : undefined;
  const summary = shown.map((s, si) => {
    const dl = l.series[si].dots;
    return dl.length ? `${s.label} from ${format(dl[0].v)} to ${format(dl[dl.length - 1].v)}` : `${s.label} no data`;
  }).join("; ");
  const bandW = l.labels.length > 1 ? (l.xs[1] - l.xs[0]) : W - PAD.l - PAD.r;
  return (
    <div className="bh-viz bh-chart">
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={`${l.labels.length} periods: ${summary}`} {...surfaceProps}
        onPointerLeave={() => surfaceProps.onBlur()}>
        <defs><clipPath id={clipId}><rect x={PAD.l} y={0} width={W - PAD.l - PAD.r} height={height} /></clipPath></defs>
        {l.ticks.map((t) => (
          <g key={t.v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={t.y} y2={t.y} stroke={t.v === 0 ? "var(--bh-axis)" : "var(--bh-grid)"} strokeWidth="1" />
            <text x={PAD.l - 6} y={t.y + 4} textAnchor="end" className="bh-axis-text">{format(t.v)}</text>
          </g>
        ))}
        {l.labels.map((lab, i) => (i % step === 0 || i === l.labels.length - 1) ? (
          <text key={i} x={l.xs[i]} y={height - 6} textAnchor="middle" className="bh-axis-text">{lab}</text>
        ) : null)}
        {active != null ? <line x1={l.xs[active]} x2={l.xs[active]} y1={PAD.t} y2={height - PAD.b} stroke="var(--bh-axis)" strokeWidth="1" /> : null}
        <g clipPath={`url(#${clipId})`}>
          {l.series[0]?.area ? <path d={l.series[0].area} fill="var(--bh-s1)" fillOpacity="0.1" /> : null}
        </g>
        {l.series.map((s, si) => (
          <g key={s.key}>
            {s.d ? <path d={s.d} fill="none" stroke={seriesColor(si)} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"
              strokeDasharray={s.dashed ? "6 4" : undefined} /> : null}
            {s.dots.filter((p) => p.isolated || p.i === active).map((p) => (
              <circle key={p.i} cx={p.x} cy={p.y} r="4" fill={seriesColor(si)} stroke="var(--bh-surface)" strokeWidth="2" />
            ))}
          </g>
        ))}
        {last && shown.length <= 2 ? (
          <text x={Math.min(W - PAD.r, last.x)} y={last.y - 8} textAnchor="end" className="bh-label-text">{format(last.v)}</text>
        ) : null}
        {l.xs.map((x, i) => (
          <rect key={i} x={x - bandW / 2} y={PAD.t} width={Math.max(1, bandW)} height={height - PAD.t - PAD.b} fill="transparent" {...markProps(i)} />
        ))}
      </svg>
      {shown.length >= 2 ? (
        <Legend items={shown.map((s, i) => ({ key: s.key, label: s.label, color: seriesColor(i), kind: s.dashed ? "dashed" : "line" }))} />
      ) : null}
      {tooltip}
    </div>
  );
}
