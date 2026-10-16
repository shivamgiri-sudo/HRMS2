import { Glyph } from "./parts";
import { Sparkline } from "./Sparkline";
import { TONE_LABEL, toneColor, type Tone } from "./scale";

export interface StatDelta {
  text: string;
  direction: "up" | "down" | "flat";
  /** true = this direction is good, false = bad, null = no judgement. */
  good: boolean | null;
}

export interface StatTileProps {
  label: string;
  value: string;
  delta?: StatDelta;
  spark?: Array<number | null>;
  tone?: Tone;
  hint?: string;
  onClick?: () => void;
}

function deltaClass(good: boolean | null): string {
  if (good === true) return "bh-delta bh-delta-good";
  if (good === false) return "bh-delta bh-delta-bad";
  return "bh-delta bh-delta-neutral";
}

/** Stat tile contract: label, value, optional delta (icon + words), optional sparkline, optional status. */
export function StatTile({ label, value, delta, spark, tone, hint, onClick }: StatTileProps) {
  const status = tone && tone !== "neutral" ? tone : null;
  const body = (
    <>
      {status ? <span className="bh-tile-accent" style={{ background: toneColor(status) }} aria-hidden="true" /> : null}
      <span className="bh-tile-label">
        {status ? <span style={{ color: toneColor(status), display: "inline-flex" }}><Glyph name={status} /></span> : null}
        <span>{label}</span>
        {status ? <span className="bh-sr">, status {TONE_LABEL[status]}</span> : null}
      </span>
      <span className="bh-tile-value">{value}</span>
      <span className="bh-tile-foot">
        {delta ? (
          <span className={deltaClass(delta.good)}>
            <Glyph name={delta.direction} size={13} />
            <span className="bh-sr">{delta.direction} </span>
            <span>{delta.text}</span>
          </span>
        ) : <span />}
        {spark ? <Sparkline points={spark} tone={tone} label={`${label} trend`} width={72} height={22} /> : null}
      </span>
      {hint ? <span className="bh-tile-hint">{hint}</span> : null}
    </>
  );
  if (onClick) {
    return (
      <button type="button" className="bh-viz bh-tile" style={{ minHeight: 44 }} onClick={onClick}>
        {body}
      </button>
    );
  }
  return <div className="bh-viz bh-tile">{body}</div>;
}
