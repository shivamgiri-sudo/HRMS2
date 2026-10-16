import { EmptyState, Glyph, TipBody } from "./parts";
import { isNum, r1, scale, toneColor, TONE_LABEL, type Tone } from "./scale";
import { useChartTooltip } from "./useChartTooltip";

export interface BarItem {
  id: string;
  label: string;
  value: number;
  marker?: number | null;
  tone?: Tone;
  note?: string;
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
        widthPct: r1(scale.clamp(scale.pct(v, top), 0, 100)),
        markerPct: m == null ? null : r1(scale.clamp(scale.pct(m, top), 0, 100)),
        over: m != null && v > m,
      };
    }),
  };
}

/**
 * Ranked horizontal bars with an optional per-row marker (e.g. mandate). One series, so one colour
 * (slot 1) unless a row carries a status tone; over-marker rows always say so in text with an icon.
 */
export function BarList({ items, max, format, onSelect, markerLabel = "Target" }: {
  items: BarItem[]; max?: number; format: (n: number) => string; onSelect?: (id: string) => void; markerLabel?: string;
}) {
  const layout = barListLayout(items, max);
  const n = items.length;
  const { focusProps, markProps, surfaceProps, tooltip, active } = useChartTooltip(items.map((it, i) => ({
    x: Math.max(layout.rows[i].widthPct, layout.rows[i].markerPct ?? 0) * 0.68 + 32,
    y: ((i + 0.2) / Math.max(1, n)) * 100,
    content: <TipBody value={format(it.value)} label={it.label}
      extra={isNum(it.marker) ? <div className="bh-tip-sub">{markerLabel}: {format(it.marker)}</div> : null} />,
  })));
  if (!n) return <EmptyState height={96} />;
  const hasMarker = layout.rows.some((r) => r.markerPct != null);
  return (
    <div className={active != null ? "bh-viz bh-chart bh-dim" : "bh-viz bh-chart"}>
      <ul {...(onSelect ? {} : surfaceProps)} className={onSelect ? "bh-rows" : "bh-rows bh-focus"}>
        {items.map((it, i) => {
          const row = layout.rows[i];
          const note = row.over ? (it.note ?? `Over ${markerLabel}`) : it.note;
          const status = it.tone && it.tone !== "neutral" ? it.tone : null;
          const markerText = isNum(it.marker) ? `, ${markerLabel} ${format(it.marker)}` : "";
          const inner = (
            <>
              <span className="bh-row-label">{it.label}</span>
              <span className="bh-bar-line">
                <span className="bh-track" aria-hidden="true">
                  <span className={i === active ? "bh-bar bh-mark bh-on" : "bh-bar bh-mark"}
                    style={{ left: 0, width: `${row.widthPct}%`, background: toneColor(it.tone) }} />
                  {row.markerPct != null ? <span className="bh-marker" style={{ left: `${row.markerPct}%` }} /> : null}
                </span>
                <span className="bh-row-value">{format(it.value)}</span>
              </span>
              {note || status ? (
                <span className="bh-row-note">
                  {row.over ? <Glyph name="over" size={12} /> : status ? <Glyph name={status} size={12} /> : null}
                  {status && !note ? TONE_LABEL[status] : note}
                </span>
              ) : null}
              <span className="bh-sr">{markerText}</span>
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
