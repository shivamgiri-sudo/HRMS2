import { formatCount } from "../format";
import { EmptyState, Legend, TipBody } from "./parts";
import { isNum, r1, scale, seriesColor } from "./scale";
import { useChartTooltip } from "./useChartTooltip";

export const STACK_GAP_PX = 2;
const MAX_SERIES = 4;
const OTHER = "__other";

/** Slot colour, with folded "Other" in the de-emphasis gray. */
function stackColor(key: string, slot: number): string {
  return key === OTHER ? "var(--bh-other)" : seriesColor(slot);
}

export interface StackRow { id: string; label: string; segments: Array<{ key: string; value: number }> }
export interface StackSeries { key: string; label: string }

/**
 * Part-to-whole rows. More than 4 series fold the tail (from the 4th) into "Other" so no hue is
 * generated past the validated slots. Rows share one scale: width = row total / largest total.
 */
export function stackLayout(rows: StackRow[], series: StackSeries[]) {
  const folded = series.length > MAX_SERIES
    ? [...series.slice(0, MAX_SERIES - 1), { key: OTHER, label: "Other" }]
    : series;
  const slotOf = new Map(folded.map((s, i) => [s.key, i]));
  const keyFor = (k: string) => (slotOf.has(k) ? k : OTHER);
  const prepared = rows.map((row) => {
    const byKey = new Map<string, number>();
    for (const seg of row.segments) {
      const v = isNum(seg.value) && seg.value > 0 ? seg.value : 0;
      const k = keyFor(seg.key);
      if (!slotOf.has(k)) continue;
      byKey.set(k, (byKey.get(k) ?? 0) + v);
    }
    const total = scale.sum([...byKey.values()]);
    return { row, byKey, total };
  });
  const maxTotal = Math.max(0, ...prepared.map((p) => p.total));
  return {
    series: folded,
    maxTotal,
    rows: prepared.map(({ row, byKey, total }) => ({
      id: row.id,
      label: row.label,
      total,
      widthPct: r1(scale.pct(total, maxTotal)),
      segments: folded
        .map((s, slot) => ({ key: s.key, label: s.label, slot, value: byKey.get(s.key) ?? 0 }))
        .filter((s) => s.value > 0)
        .map((s) => ({ ...s, sharePct: scale.pct(s.value, total) })),
    })),
  };
}

export function StackedBar({ rows, series, format = formatCount, onSelect }: {
  rows: StackRow[]; series: StackSeries[]; format?: (n: number) => string; onSelect?: (id: string) => void;
}) {
  const layout = stackLayout(rows, series);
  const n = layout.rows.length;
  const { focusProps, markProps, surfaceProps, tooltip, active } = useChartTooltip(layout.rows.map((r, i) => ({
    x: 32 + r.widthPct * 0.5,
    y: ((i + 0.2) / Math.max(1, n)) * 100,
    content: (
      <div>
        <div className="bh-tip-row"><strong>{format(r.total)}</strong><span className="bh-tip-sub">{r.label}</span></div>
        {r.segments.map((s) => <TipBody key={s.key} value={format(s.value)} label={s.label} color={stackColor(s.key, s.slot)} />)}
      </div>
    ),
  })));
  if (!n || layout.maxTotal <= 0) return <EmptyState height={96} />;
  return (
    <div className={active != null ? "bh-viz bh-chart bh-dim" : "bh-viz bh-chart"}>
      <ul {...(onSelect ? {} : surfaceProps)} className={onSelect ? "bh-rows" : "bh-rows bh-focus"}>
        {layout.rows.map((r, i) => {
          const summary = r.segments.map((s) => `${s.label} ${format(s.value)}`).join(", ");
          const inner = (
            <>
              <span className="bh-row-label">{r.label}</span>
              <span className="bh-bar-line">
                <span className="bh-track" style={{ height: 12 }} aria-hidden="true">
                  <span className={i === active ? "bh-stack bh-mark bh-on" : "bh-stack bh-mark"}
                    style={{ width: `${r.widthPct}%`, gap: `${STACK_GAP_PX}px` }}>
                    {r.segments.map((s) => (
                      <span key={s.key} style={{ flex: `${s.value} 1 0`, background: stackColor(s.key, s.slot) }} />
                    ))}
                  </span>
                </span>
                <span className="bh-row-value">{format(r.total)}</span>
              </span>
              <span className="bh-sr">{summary ? `: ${summary}` : ""}</span>
            </>
          );
          return (
            <li key={r.id}>
              {onSelect ? (
                <button type="button" className="bh-row-btn" onClick={() => onSelect(r.id)} {...focusProps(i)}>{inner}</button>
              ) : (
                <div className="bh-row" {...markProps(i)}>{inner}</div>
              )}
            </li>
          );
        })}
      </ul>
      {layout.series.length >= 2 ? (
        <Legend items={layout.series.map((s, i) => ({ key: s.key, label: s.label, color: stackColor(s.key, i) }))} />
      ) : null}
      {tooltip}
    </div>
  );
}
