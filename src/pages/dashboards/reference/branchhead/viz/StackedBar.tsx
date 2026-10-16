import { formatCount } from "../format";
import { EmptyState, Legend, TipBody } from "./parts";
import { isNum, r1, scale, seriesColor, summarize, type TableSpec } from "./scale";
import { useChartTooltip } from "./useChartTooltip";

export const STACK_GAP_PX = 2;
const MAX_SERIES = 4;
const OTHER = "__other";

/** Slot colour, with folded "Other" in the de-emphasis gray. */
function stackColor(key: string, slot: number, color?: string): string {
  if (key === OTHER) return "var(--bh-other)";
  return color ?? seriesColor(slot);
}

export interface StackRow { id: string; label: string; segments: Array<{ key: string; value: number }> }
export interface StackSeries {
  key: string;
  label: string;
  /** Fixed colour for an ordered status scale (e.g. risk tiers); defaults to the categorical slot. */
  color?: string;
}
export interface StackedBarProps {
  rows: StackRow[];
  series: StackSeries[];
  format?: (n: number) => string;
  onSelect?: (id: string) => void;
  /** Names the data for assistive tech and the table caption. */
  label?: string;
}

/**
 * Part-to-whole rows. More than 4 series fold the tail (from the 4th) into "Other" so no hue is
 * generated past the validated slots; segments whose key is not in `series` also land in "Other"
 * (never dropped), so row totals always equal the input. Rows share one scale: width = total / max.
 */
export function stackLayout(rows: StackRow[], series: StackSeries[]) {
  const known = new Set(series.map((s) => s.key));
  const hasUnknown = rows.some((r) => r.segments.some((g) => !known.has(g.key) && isNum(g.value) && g.value > 0));
  const folded = series.length > MAX_SERIES
    ? [...series.slice(0, MAX_SERIES - 1), { key: OTHER, label: "Other" }]
    : hasUnknown ? [...series, { key: OTHER, label: "Other" }] : series;
  const slotOf = new Map(folded.map((s, i) => [s.key, i]));
  const keyFor = (k: string) => (slotOf.has(k) ? k : OTHER);
  const prepared = rows.map((row) => {
    const byKey = new Map<string, number>();
    for (const seg of row.segments) {
      const v = isNum(seg.value) && seg.value > 0 ? seg.value : 0;
      const k = keyFor(seg.key);
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
        .map((s, slot) => ({ key: s.key, label: s.label, color: s.color, slot, value: byKey.get(s.key) ?? 0 }))
        .filter((s) => s.value > 0)
        .map((s) => ({ ...s, sharePct: scale.pct(s.value, total) })),
    })),
  };
}

/** Table twin built from the same props: one column per (folded) series plus the row total. */
export function stackedBarTable(p: StackedBarProps, caption = p.label ?? "Breakdown"): TableSpec {
  const format = p.format ?? formatCount;
  const l = stackLayout(p.rows, p.series);
  return {
    caption,
    columns: ["Item", ...l.series.map((s) => s.label), "Total"],
    rows: l.rows.map((r) => [
      r.label,
      ...l.series.map((s) => format(r.segments.find((g) => g.key === s.key)?.value ?? 0)),
      format(r.total),
    ]),
  };
}

export function StackedBar({ rows, series, format = formatCount, onSelect, label = "Breakdown" }: StackedBarProps) {
  const layout = stackLayout(rows, series);
  const n = layout.rows.length;
  const { focusProps, markProps, surfaceProps, tooltip, active } = useChartTooltip(layout.rows.map((r, i) => ({
    x: 32 + r.widthPct * 0.5,
    y: ((i + 0.2) / Math.max(1, n)) * 100,
    content: (
      <div>
        <div className="bh-tip-row"><strong>{format(r.total)}</strong><span className="bh-tip-sub">{r.label}</span></div>
        {r.segments.map((s) => <TipBody key={s.key} value={format(s.value)} label={s.label} color={stackColor(s.key, s.slot, s.color)} />)}
      </div>
    ),
  })));
  if (!n || layout.maxTotal <= 0) return <EmptyState height={96} />;
  const aria = summarize(label, layout.rows.map((r) =>
    `${r.label} ${format(r.total)} (${r.segments.map((s) => `${s.label} ${format(s.value)}`).join(", ")})`));
  return (
    <div role="group" aria-label={aria} {...(onSelect ? {} : surfaceProps)}
      className={`bh-viz bh-chart${active != null ? " bh-dim" : ""}${onSelect ? "" : " bh-focus"}`}>
      <ul className="bh-rows">
        {layout.rows.map((r, i) => {
          const summary = r.segments.map((s) => `${s.label} ${format(s.value)}`).join(", ");
          const inner = (
            <>
              <span className="bh-row-label" title={r.label}>{r.label}</span>
              <span className="bh-bar-line">
                <span className="bh-track" style={{ height: 12 }} aria-hidden="true">
                  <span className={i === active ? "bh-stack bh-mark bh-on" : "bh-stack bh-mark"}
                    style={{ width: `${r.widthPct}%`, gap: `${STACK_GAP_PX}px` }}>
                    {r.segments.map((s) => (
                      <span key={s.key} style={{ flex: `${s.value} 1 0`, background: stackColor(s.key, s.slot, s.color) }} />
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
        <Legend items={layout.series.map((s, i) => ({ key: s.key, label: s.label, color: stackColor(s.key, i, s.color) }))} />
      ) : null}
      {tooltip}
    </div>
  );
}
