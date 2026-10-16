import { Glyph, iconStyle } from "./parts";
import { isNum, scale, type Tone } from "./scale";

export type Band = "Good" | "Fair" | "Poor";

const BAND_TONE: Record<Band, Tone> = { Good: "good", Fair: "warning", Poor: "critical" };
const BAND_ICON: Record<Band, "good" | "warning" | "critical"> = { Good: "good", Fair: "warning", Poor: "critical" };
const STROKE = 10;

/** Ring geometry for a 0..100 score; out-of-range and missing values clamp instead of drawing NaN. */
export function scoreRingLayout(value: number, size: number) {
  const v = isNum(value) ? scale.clamp(value, 0, 100) : 0;
  const r = Math.max(1, (size - STROKE) / 2);
  const circumference = 2 * Math.PI * r;
  return { value: v, r, circumference, dash: (v / 100) * circumference };
}

/** Hero score figure: ring in the band's status colour, the number, and the band as icon + text. */
export function ScoreRing({ value, label, band, size = 120 }: { value: number; label: string; band: Band; size?: number }) {
  const l = scoreRingLayout(value, size);
  const shown = Math.round(l.value);
  const c = size / 2;
  return (
    <div className="bh-viz bh-ring">
      <svg className="bh-icon" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" style={iconStyle(size)}
        aria-label={`${label}: ${shown} out of 100, ${band}`}>
        <circle cx={c} cy={c} r={l.r} fill="none" stroke="var(--bh-grid)" strokeWidth={STROKE} />
        {l.dash > 0 ? (
          <circle cx={c} cy={c} r={l.r} fill="none" stroke={`var(--bh-${BAND_TONE[band]})`} strokeWidth={STROKE}
            strokeLinecap="round" strokeDasharray={`${l.dash} ${l.circumference}`} transform={`rotate(-90 ${c} ${c})`} />
        ) : null}
        <text x={c} y={c} textAnchor="middle" dominantBaseline="central" fill="var(--bh-ink-1)"
          style={{ fontSize: Math.round(size * 0.3), fontWeight: 600 }}>{shown}</text>
      </svg>
      <div>
        <p className="bh-tile-label" style={{ margin: 0 }}>{label}</p>
        <p className="bh-ring-band" style={{ margin: "2px 0 0" }}>
          <span style={{ color: `var(--bh-${BAND_TONE[band]})` }}><Glyph name={BAND_ICON[band]} size={16} /></span>
          {band}
        </p>
      </div>
    </div>
  );
}
