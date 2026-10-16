import { EmptyState, Legend, TipBody } from "./parts";
import { isNum, r1 } from "./scale";
import { useChartTooltip } from "./useChartTooltip";

export interface DivergingItem { id: string; label: string; value: number }

/**
 * Bars around a zero line. Mixed signs: zero centred (50 %), each arm scaled to the largest |value|.
 * All non-negative: zero at the left edge; all non-positive: zero at the right edge (full width each).
 */
export function divergingLayout(items: DivergingItem[]) {
  const vals = items.map((it) => (isNum(it.value) ? it.value : 0));
  const hasPositive = vals.some((v) => v > 0);
  const hasNegative = vals.some((v) => v < 0);
  const maxAbs = Math.max(0, ...vals.map(Math.abs));
  const zeroPct = hasPositive && hasNegative ? 50 : hasNegative ? 100 : 0;
  const arm = hasPositive && hasNegative ? 50 : 100;
  return {
    zeroPct,
    hasPositive,
    hasNegative,
    rows: items.map((it, i) => {
      const v = vals[i];
      const widthPct = maxAbs > 0 ? r1((Math.abs(v) / maxAbs) * arm) : 0;
      const sign: "pos" | "neg" | "zero" = v > 0 ? "pos" : v < 0 ? "neg" : "zero";
      return { id: it.id, sign, widthPct, leftPct: sign === "neg" ? r1(zeroPct - widthPct) : zeroPct };
    }),
  };
}

const COLOR = { pos: "var(--bh-pos)", neg: "var(--bh-neg)", zero: "var(--bh-other)" } as const;

/** Profit / loss style bars: diverging blue <-> red poles, sign also carried by the legend and text. */
export function DivergingBars({ items, format, onSelect, positiveLabel, negativeLabel }: {
  items: DivergingItem[]; format: (n: number) => string; onSelect?: (id: string) => void; positiveLabel: string; negativeLabel: string;
}) {
  const layout = divergingLayout(items);
  const n = items.length;
  const signWord = (s: "pos" | "neg" | "zero") => (s === "pos" ? positiveLabel : s === "neg" ? negativeLabel : "Zero");
  const { focusProps, markProps, surfaceProps, tooltip, active } = useChartTooltip(items.map((it, i) => ({
    x: 32 + (layout.rows[i].leftPct + layout.rows[i].widthPct / 2) * 0.5,
    y: ((i + 0.2) / Math.max(1, n)) * 100,
    content: <TipBody value={format(it.value)} label={`${it.label} (${signWord(layout.rows[i].sign)})`} color={COLOR[layout.rows[i].sign]} />,
  })));
  if (!n) return <EmptyState height={96} />;
  return (
    <div className={active != null ? "bh-viz bh-chart bh-dim" : "bh-viz bh-chart"}>
      <ul {...(onSelect ? {} : surfaceProps)} className={onSelect ? "bh-rows" : "bh-rows bh-focus"}>
        {items.map((it, i) => {
          const row = layout.rows[i];
          const inner = (
            <>
              <span className="bh-row-label">{it.label}</span>
              <span className="bh-bar-line">
                <span className="bh-track" aria-hidden="true">
                  <span className="bh-zero" style={{ left: `${layout.zeroPct}%` }} />
                  {row.widthPct > 0 ? (
                    <span className={`${row.sign === "neg" ? "bh-bar bh-bar-neg" : "bh-bar"} bh-mark${i === active ? " bh-on" : ""}`}
                      style={{ left: `${row.leftPct}%`, width: `${row.widthPct}%`, background: COLOR[row.sign] }} />
                  ) : null}
                </span>
                <span className="bh-row-value">{format(it.value)}</span>
              </span>
              <span className="bh-sr">, {signWord(row.sign)}</span>
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
      <Legend items={[
        { key: "pos", label: positiveLabel, color: COLOR.pos },
        { key: "neg", label: negativeLabel, color: COLOR.neg },
      ]} />
      {tooltip}
    </div>
  );
}
