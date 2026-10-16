import { EmptyState, Glyph } from "./parts";
import { isNum, r1, scale, toneColor, type Tone } from "./scale";

/** Share of the limit; the drawn fill clamps at 100 % while `pct` keeps the true value for text. */
export function meterLayout(value: number, limit: number) {
  if (!isNum(limit) || limit <= 0) return { pct: 0, fillPct: 0, over: false };
  const pct = r1(scale.pct(isNum(value) ? value : 0, limit));
  return { pct, fillPct: scale.clamp(pct, 0, 100), over: pct > 100 };
}

/**
 * A single ratio against a limit. The track is the fill hue at low strength (same ramp), so the state
 * reads across the whole bar; going over the limit is said in words with an icon, never colour alone.
 */
export function Meter({ value, limit, label, format, tone }: {
  value: number; limit: number; label: string; format: (n: number) => string; tone?: Tone;
}) {
  if (!isNum(limit) || limit <= 0) return <EmptyState height={48} />;
  const l = meterLayout(value, limit);
  const fill = toneColor(tone);
  return (
    <div className="bh-viz bh-meter">
      <div className="bh-meter-head">
        <span style={{ color: "var(--bh-ink-1)", fontWeight: 500 }}>{label}</span>
        <span className="bh-num">
          {format(value)} of {format(limit)} · {l.pct}%
        </span>
      </div>
      <div className="bh-meter-track" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={Math.round(l.fillPct)} aria-valuetext={`${format(value)} of ${format(limit)}, ${l.pct}%${l.over ? ", over limit" : ""}`}>
        <span style={{ background: tone ? fill : "var(--bh-track)", opacity: tone ? 0.22 : 1 }} aria-hidden="true" />
        <span className="bh-meter-fill" style={{ width: `${l.fillPct}%`, background: fill }} aria-hidden="true" />
      </div>
      {l.over ? (
        <span className="bh-over"><Glyph name="over" size={13} />over limit by {format(value - limit)}</span>
      ) : null}
    </div>
  );
}
