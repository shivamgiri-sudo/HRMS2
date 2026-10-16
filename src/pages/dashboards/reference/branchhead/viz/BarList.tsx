import { EmptyState, Glyph, TipBody } from "./parts";
import { isNum, r1, safeFormat, scale, summarize, toneColor, TONE_LABEL, type TableSpec, type Tone } from "./scale";
import { useChartTooltip } from "./useChartTooltip";

export interface BarItem {
  id: string;
  label: string;
  value: number;
  marker?: number | null;
  tone?: Tone;
  note?: string;
}

export interface BarListProps {
  items: BarItem[];
  max?: number;
  format: (n: number) => string;
  onSelect?: (id: string) => void;
  markerLabel?: string;
  /** Names the data for assistive tech and the table caption, e.g. "Headcount versus mandate by process". */
  label?: string;
}

/** Bar widths and marker positions as % of max (explicit, else the largest value or marker). */
export function barListLayout(items: BarItem[], max?: number) {
  const observed = Math.max(0, ...items.flatMap((it) => [it.value, it.marker ?? 0].filter(isNum)));
  const top = isNum(max) && max > 0 ? max : observed;
  return {
    max: top,
    rows: items.map((it) => {
      const v = isNum(it.value) ? it.value : 0;
      const m = isNum(it.marker) ? it.marker : null;
      return {
        id: it.id,
        value: v,
        marker: m,
        widthPct: r1(scale.clamp(scale.pct(v, top), 0, 100)),
        markerPct: m == null ? null : r1(scale.clamp(scale.pct(m, top), 0, 100)),
        over: m != null && v > m,
      };
    }),
  };
}

function noteFor(it: BarItem, over: boolean, markerLabel: string): string | undefined {
  return over ? (it.note ?? `Over ${markerLabel}`) : it.note;
}

/** Table twin built from the same props the chart renders. */
export function barListTable(p: BarListProps, caption = p.label ?? "Values"): TableSpec {
  const markerLabel = p.markerLabel ?? "Target";
  const l = barListLayout(p.items, p.max);
  const hasMarker = l.rows.some((r) => r.marker != null);
  return {
    caption,
    columns: ["Item", "Value", ...(hasMarker ? [markerLabel] : []), "Note"],
    rows: p.items.map((it, i) => [
      it.label,
      safeFormat(p.format, l.rows[i].value),
      ...(hasMarker ? [l.rows[i].marker == null ? null : p.format(l.rows[i].marker as number)] : []),
      noteFor(it, l.rows[i].over, markerLabel) ?? (it.tone && it.tone !== "neutral" ? TONE_LABEL[it.tone] : null),
    ]),
  };
}

/**
 * Ranked horizontal bars with an optional per-row marker (e.g. mandate). One series, so one colour
 * (slot 1) unless a row carries a status tone; over-marker rows always say so in text with an icon.
 */
export function BarList(p: BarListProps) {
  const { items, max, format, onSelect, markerLabel = "Target", label = "Values" } = p;
  const layout = barListLayout(items, max);
  const n = items.length;
  const { focusProps, markProps, surfaceProps, tooltip, active } = useChartTooltip(items.map((it, i) => ({
    x: Math.max(layout.rows[i].widthPct, layout.rows[i].markerPct ?? 0) * 0.68 + 32,
    y: ((i + 0.2) / Math.max(1, n)) * 100,
    content: <TipBody value={safeFormat(format, it.value)} label={it.label}
      extra={isNum(it.marker) ? <div className="bh-tip-sub">{markerLabel}: {format(it.marker)}</div> : null} />,
  })));
  if (!n) return <EmptyState height={96} />;
  const hasMarker = layout.rows.some((r) => r.markerPct != null);
  const aria = summarize(label, items.map((it, i) => {
    const m = layout.rows[i].marker;
    return `${it.label} ${safeFormat(format, it.value)}${m != null ? ` of ${format(m)} ${markerLabel}` : ""}`;
  }));
  return (
    <div role="group" aria-label={aria} {...(onSelect ? {} : surfaceProps)}
      className={`bh-viz bh-chart${active != null ? " bh-dim" : ""}${onSelect ? "" : " bh-focus"}`}>
      <ul className="bh-rows">
        {items.map((it, i) => {
          const row = layout.rows[i];
          const note = noteFor(it, row.over, markerLabel);
          const status = it.tone && it.tone !== "neutral" ? it.tone : null;
          const inner = (
            <>
              <span className="bh-row-label" title={it.label}>{it.label}</span>
              <span className="bh-bar-line">
                <span className="bh-track" aria-hidden="true">
                  <span className={i === active ? "bh-bar bh-mark bh-on" : "bh-bar bh-mark"}
                    style={{ left: 0, width: `${row.widthPct}%`, background: toneColor(it.tone) }} />
                  {row.markerPct != null ? <span className="bh-marker" style={{ left: `${row.markerPct}%` }} /> : null}
                </span>
                <span className="bh-row-value">{safeFormat(format, it.value)}</span>
              </span>
              {note || status ? (
                <span className="bh-row-note">
                  {row.over ? <Glyph name="over" size={12} /> : status ? <Glyph name={status} size={12} /> : null}
                  {status && !note ? TONE_LABEL[status] : note}
                </span>
              ) : null}
              {row.marker != null ? <span className="bh-sr">, {markerLabel} {format(row.marker)}</span> : null}
            </>
          );
          return (
            <li key={it.id}>
              {onSelect ? (
                <button type="button" className="bh-row-btn" onClick={() => onSelect(it.id)} {...focusProps(i)}>{inner}</button>
              ) : (
                <div className="bh-row" {...markProps(i)}>{inner}</div>
              )}
            </li>
          );
        })}
      </ul>
      {hasMarker ? (
        <ul className="bh-legend">
          <li><i className="bh-swatch" style={{ background: "var(--bh-s1)" }} aria-hidden="true" /><span>Actual</span></li>
          <li><i className="bh-marker" style={{ position: "static", display: "inline-block", height: 12 }} aria-hidden="true" /><span>{markerLabel}</span></li>
        </ul>
      ) : null}
      {tooltip}
    </div>
  );
}
