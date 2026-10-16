import { formatCount } from "../format";
import { EmptyState, TipBody } from "./parts";
import { isNum, ordinalStep, r1, scale, summarize, type TableSpec } from "./scale";
import { useChartTooltip } from "./useChartTooltip";

export interface FunnelStage { id: string; label: string; value: number }
export interface FunnelProps {
  stages: FunnelStage[];
  format?: (n: number) => string;
  onSelect?: (id: string) => void;
  /** Names the data for assistive tech and the table caption. */
  label?: string;
}

/**
 * Stage widths as % of the largest stage (not the first, so a zero first stage cannot divide by 0),
 * step conversion vs the previous stage (null when the previous stage is 0), and an ordinal ramp step.
 */
export function funnelLayout(stages: FunnelStage[]) {
  const vals = stages.map((s) => (isNum(s.value) && s.value > 0 ? s.value : 0));
  const max = Math.max(0, ...vals);
  return {
    max,
    values: vals,
    rows: stages.map((s, i) => ({
      id: s.id,
      widthPct: r1(scale.pct(vals[i], max)),
      convPct: i > 0 && vals[i - 1] > 0 ? r1(scale.pct(vals[i], vals[i - 1])) : null,
      step: ordinalStep(i, stages.length),
    })),
  };
}

/** Table twin built from the same props: stage value and step conversion. */
export function funnelTable(p: FunnelProps, caption = p.label ?? "Stages"): TableSpec {
  const format = p.format ?? formatCount;
  const l = funnelLayout(p.stages);
  return {
    caption,
    columns: ["Stage", "Count", "% of previous stage"],
    rows: p.stages.map((s, i) => [s.label, format(l.values[i]), l.rows[i].convPct == null ? null : `${l.rows[i].convPct}%`]),
  };
}

/** Ordered stages wear the one-hue ordinal ramp (darkest first); labels and values sit outside the bars. */
export function Funnel({ stages, format = formatCount, onSelect, label = "Stages" }: FunnelProps) {
  const l = funnelLayout(stages);
  const n = stages.length;
  const { focusProps, markProps, surfaceProps, tooltip, active } = useChartTooltip(stages.map((s, i) => ({
    x: 66,
    y: ((i + 0.2) / Math.max(1, n)) * 100,
    content: <TipBody value={format(l.values[i])} label={s.label}
      extra={l.rows[i].convPct != null ? <div className="bh-tip-sub">{l.rows[i].convPct}% of previous stage</div> : null} />,
  })));
  if (!n || l.max <= 0) return <EmptyState height={96} />;
  const aria = summarize(label, stages.map((s, i) =>
    `${s.label} ${format(l.values[i])}${l.rows[i].convPct != null ? ` (${l.rows[i].convPct}% of previous)` : ""}`));
  return (
    <div role="group" aria-label={aria} {...(onSelect ? {} : surfaceProps)}
      className={`bh-viz bh-chart${active != null ? " bh-dim" : ""}${onSelect ? "" : " bh-focus"}`}>
      <ol className="bh-rows">
        {stages.map((s, i) => {
          const row = l.rows[i];
          const inner = (
            <>
              <span className="bh-row-label" title={s.label}>{s.label}</span>
              <span className="bh-bar-line">
                <span className="bh-track" style={{ height: 22 }} aria-hidden="true">
                  <span className={i === active ? "bh-funnel-bar bh-mark bh-on" : "bh-funnel-bar bh-mark"}
                    style={{ display: "block", width: `${row.widthPct}%`, background: `var(--bh-ord-${row.step})` }} />
                </span>
                <span className="bh-row-value">
                  {format(l.values[i])}
                  {row.convPct != null ? <span className="bh-muted" style={{ fontWeight: 400 }}> · {row.convPct}%</span> : null}
                </span>
              </span>
              {row.convPct != null ? <span className="bh-sr">, {row.convPct}% of previous stage</span> : null}
            </>
          );
          return (
            <li key={s.id}>
              {onSelect ? (
                <button type="button" className="bh-row-btn" onClick={() => onSelect(s.id)} {...focusProps(i)}>{inner}</button>
              ) : (
                <div className="bh-row" {...markProps(i)}>{inner}</div>
              )}
            </li>
          );
        })}
      </ol>
      {tooltip}
    </div>
  );
}
