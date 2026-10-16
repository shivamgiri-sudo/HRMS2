import { EmptyState, Glyph } from "./parts";
import { isNum, r1, safeFormat, scale, toneColor, type TableSpec, type Tone } from "./scale";

export interface MeterProps {
  value: number;
  limit: number;
  label: string;
  format: (n: number) => string;
  tone?: Tone;
}

/** Share of the limit; the drawn fill clamps at 100 % while `pct` keeps the true value for text. */
export function meterLayout(value: number, limit: number) {
  if (!isNum(limit) || limit <= 0) return { pct: 0, fillPct: 0, over: false };
  const pct = r1(scale.pct(isNum(value) ? value : 0, limit));
  return { pct, fillPct: scale.clamp(pct, 0, 100), over: pct > 100 };
}

/** Table twin from the same props: value, limit, share and whether the limit is exceeded. */
export function meterTable(p: MeterProps, caption = p.label): TableSpec {
  const l = meterLayout(p.value, p.limit);
  const hasLimit = isNum(p.limit) && p.limit > 0;
  return {
    caption,
    columns: ["Measure", "Value", "Limit", "Share", "Status"],
    rows: [[p.label, safeFormat(p.format, p.value), safeFormat(p.format, p.limit), hasLimit ? `${l.pct}%` : null,
      hasLimit ? (l.over ? "Over limit" : "Within limit") : null]],
  };
}

/**
 * A single ratio against a limit. The track is the fill hue at low strength (same ramp), so the state
 * reads across the whole bar; going over the limit is said in words with an icon, never colour alone.
 */
export function Meter({ value, limit, label, format, tone }: MeterProps) {
  if (!isNum(limit) || limit <= 0) return <EmptyState height={48} />;
  const l = meterLayout(value, limit);
  const fill = toneColor(tone);
  const shownValue = safeFormat(format, value);
  const shownLimit = format(limit);
  return (
    <div className="bh-viz bh-meter">
      <div className="bh-meter-head">
        <span style={{ color: "var(--bh-ink-1)", fontWeight: 500 }}>{label}</span>
        <span className="bh-num">
          {shownValue} of {shownLimit} · {l.pct}%
        </span>
      </div>
      <div className="bh-meter-track" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={Math.round(l.fillPct)} aria-valuetext={`${shownValue} of ${shownLimit}, ${l.pct}%${l.over ? ", over limit" : ""}`}>
        <span style={{ background: tone ? fill : "var(--bh-track)", opacity: tone ? 0.22 : 1 }} aria-hidden="true" />
        <span className="bh-meter-fill" style={{ width: `${l.fillPct}%`, background: fill }} aria-hidden="true" />
      </div>
      {l.over ? (
        <span className="bh-over"><Glyph name="over" size={13} />over limit by {safeFormat(format, value - limit)}</span>
      ) : null}
    </div>
  );
}
