import { EmptyState, Legend, TipBody } from "./parts";
import { isNum, r1, safeFormat, summarize, type TableSpec } from "./scale";
import { useChartTooltip } from "./useChartTooltip";

export interface DivergingItem { id: string; label: string; value: number }
export interface DivergingBarsProps {
  items: DivergingItem[];
  format: (n: number) => string;
  onSelect?: (id: string) => void;
  positiveLabel: string;
  negativeLabel: string;
  /** Names the data for assistive tech and the table caption. */
  label?: string;
}

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

function signWordFor(p: Pick<DivergingBarsProps, "positiveLabel" | "negativeLabel">, s: "pos" | "neg" | "zero"): string {
  return s === "pos" ? p.positiveLabel : s === "neg" ? p.negativeLabel : "Zero";
}

/** Table twin built from the same props: value and which side of zero it falls. */
export function divergingBarsTable(p: DivergingBarsProps, caption = p.label ?? "Values"): TableSpec {
  const l = divergingLayout(p.items);
  return {
    caption,
    columns: ["Item", "Value", "Side"],
    rows: p.items.map((it, i) => [it.label, safeFormat(p.format, it.value), signWordFor(p, l.rows[i].sign)]),
  };
}

/** Profit / loss style bars: diverging blue <-> red poles, sign also carried by the legend and text. */
export function DivergingBars(p: DivergingBarsProps) {
  const { items, format, onSelect, positiveLabel, negativeLabel, label = "Values" } = p;
  const layout = divergingLayout(items);
  const n = items.length;
  const signWord = (s: "pos" | "neg" | "zero") => signWordFor(p, s);
  const { focusProps, markProps, surfaceProps, tooltip, active } = useChartTooltip(items.map((it, i) => ({
    x: 32 + (layout.rows[i].leftPct + layout.rows[i].widthPct / 2) * 0.5,
    y: ((i + 0.2) / Math.max(1, n)) * 100,
    content: <TipBody value={safeFormat(format, it.value)} label={`${it.label} (${signWord(layout.rows[i].sign)})`} color={COLOR[layout.rows[i].sign]} />,
  })));
  if (!n) return <EmptyState height={96} />;
  const aria = summarize(label, items.map((it, i) => `${it.label} ${safeFormat(format, it.value)} ${signWord(layout.rows[i].sign)}`));
  return (
    <div role="group" aria-label={aria} {...(onSelect ? {} : surfaceProps)}
      className={`bh-viz bh-chart${active != null ? " bh-dim" : ""}${onSelect ? "" : " bh-focus"}`}>
      <ul className="bh-rows">
        {items.map((it, i) => {
          const row = layout.rows[i];
          const inner = (
            <>
              <span className="bh-row-label" title={it.label}>{it.label}</span>
              <span className="bh-bar-line">
                <span className="bh-track" aria-hidden="true">
                  <span className="bh-zero" style={{ left: `${layout.zeroPct}%` }} />
                  {row.widthPct > 0 ? (
                    <span className={`${row.sign === "neg" ? "bh-bar bh-bar-neg" : "bh-bar"} bh-mark${i === active ? " bh-on" : ""}`}
                      style={{ left: `${row.leftPct}%`, width: `${row.widthPct}%`, background: COLOR[row.sign] }} />
                  ) : null}
                </span>
                <span className="bh-row-value">{safeFormat(format, it.value)}</span>
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
