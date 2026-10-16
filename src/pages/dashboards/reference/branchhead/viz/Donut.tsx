import { formatCount } from "../format";
import { EmptyState, TipBody } from "./parts";
import { isNum, r1, scale, seriesColor, type TableSpec } from "./scale";
import { useChartTooltip } from "./useChartTooltip";

export interface DonutSlice { key: string; label: string; value: number }
export interface DonutProps {
  slices: DonutSlice[];
  centerLabel: string;
  centerValue: string;
  format?: (n: number) => string;
}

const MAX_DRAWN = 4;
const OTHER = "__other";
const TAU = Math.PI * 2;

/** Positive slices, largest first; past 4, the 4th onward fold into a single "Other". */
export function foldSlices(slices: DonutSlice[], maxDrawn = MAX_DRAWN): DonutSlice[] {
  const pos = slices.filter((s) => isNum(s.value) && s.value > 0).sort((a, b) => b.value - a.value);
  if (pos.length <= maxDrawn) return pos;
  const rest = pos.slice(maxDrawn - 1);
  return [...pos.slice(0, maxDrawn - 1), { key: OTHER, label: "Other", value: scale.sum(rest.map((s) => s.value)) }];
}

/** Angles (radians, clockwise from 12 o'clock) and shares for the folded slices. */
export function donutLayout(slices: DonutSlice[]) {
  const folded = foldSlices(slices);
  const total = scale.sum(folded.map((s) => s.value));
  let a = 0;
  return {
    total,
    slices: folded.map((s, i) => {
      const a0 = a;
      a += total > 0 ? (s.value / total) * TAU : 0;
      return { ...s, pct: r1(scale.pct(s.value, total)), a0, a1: a, slot: i };
    }),
  };
}

/** Annular sector path; caller guarantees a1 - a0 < 2π (a full ring is drawn as a circle). */
export function donutArcPath(cx: number, cy: number, rOuter: number, rInner: number, a0: number, a1: number): string {
  const pt = (r: number, a: number) => `${r1(cx + r * Math.sin(a))},${r1(cy - r * Math.cos(a))}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${pt(rOuter, a0)}A${rOuter},${rOuter} 0 ${large} 1 ${pt(rOuter, a1)}L${pt(rInner, a1)}A${rInner},${rInner} 0 ${large} 0 ${pt(rInner, a0)}Z`;
}

function sliceColor(key: string, slot: number): string {
  return key === OTHER ? "var(--bh-other)" : seriesColor(slot);
}

/** Table twin from the same props: the drawn (folded) slices with value and share. */
export function donutTable(p: DonutProps, caption = p.centerLabel): TableSpec {
  const format = p.format ?? formatCount;
  const l = donutLayout(p.slices);
  return {
    caption,
    columns: ["Category", "Value", "Share"],
    rows: [...l.slices.map((s) => [s.label, format(s.value), `${s.pct}%`]), ["Total", format(l.total), l.total > 0 ? "100%" : null]],
  };
}

/** Part-to-whole at a glance (<= 4 slices). Slices are separated by a surface-coloured gap, never a border. */
export function Donut({ slices, centerLabel, centerValue, format = formatCount }: DonutProps) {
  const l = donutLayout(slices);
  const size = 160;
  const c = size / 2;
  const ro = c - 4;
  const ri = ro - 22;
  const { surfaceProps, markProps, tooltip, active } = useChartTooltip(l.slices.map((s) => {
    const mid = (s.a0 + s.a1) / 2;
    return {
      x: ((c + ro * Math.sin(mid)) / size) * 100,
      y: ((c - ro * Math.cos(mid)) / size) * 100,
      content: <TipBody value={format(s.value)} label={`${s.label} (${s.pct}%)`} color={sliceColor(s.key, s.slot)} />,
    };
  }));
  if (l.total <= 0) return <EmptyState height={size} />;
  const summary = l.slices.map((s) => `${s.label} ${format(s.value)} (${s.pct}%)`).join(", ");
  const gap = l.slices.length > 1 ? 2 / ro : 0;
  return (
    <div className={active != null ? "bh-viz bh-chart bh-dim" : "bh-viz bh-chart"}
      style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16 }}>
      <div style={{ position: "relative", width: size, maxWidth: "100%", flex: "none" }}>
        <svg viewBox={`0 0 ${size} ${size}`} role="group" className="bh-focus"
          aria-label={`${centerLabel} ${centerValue}: ${summary}`} {...surfaceProps}>
          {l.slices.length === 1 ? (
            <circle className="bh-mark" cx={c} cy={c} r={(ro + ri) / 2} fill="none" stroke={sliceColor(l.slices[0].key, 0)}
              strokeWidth={ro - ri} {...markProps(0)} />
          ) : l.slices.map((s, i) => (
            <path key={s.key} className={i === active ? "bh-mark bh-on" : "bh-mark"} fill={sliceColor(s.key, s.slot)}
              d={donutArcPath(c, c, ro, ri, s.a0 + gap / 2, Math.max(s.a0 + gap / 2, s.a1 - gap / 2))} {...markProps(i)} />
          ))}
          <text x={c} y={c - 2} textAnchor="middle" fill="var(--bh-ink-1)" style={{ fontSize: 22, fontWeight: 600 }}>{centerValue}</text>
          <text x={c} y={c + 16} textAnchor="middle" className="bh-axis-text">{centerLabel}</text>
        </svg>
        {tooltip}
      </div>
      <ul className="bh-legend" style={{ flexDirection: "column", margin: 0, flex: "1 1 140px" }}>
        {l.slices.map((s) => (
          <li key={s.key} style={{ justifyContent: "space-between", width: "100%" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
              <i className="bh-swatch" style={{ background: sliceColor(s.key, s.slot) }} aria-hidden="true" />
              <span>{s.label}</span>
            </span>
            <span className="bh-num" style={{ color: "var(--bh-ink-1)" }}>{format(s.value)} <span className="bh-muted">({s.pct}%)</span></span>
          </li>
        ))}
      </ul>
    </div>
  );
}
