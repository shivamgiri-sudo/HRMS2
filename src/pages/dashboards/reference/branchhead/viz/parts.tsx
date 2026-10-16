import type { ReactNode } from "react";
import type { Tone } from "./scale";

/* Small shared pieces: empty state, legend, status icons, tooltip body. */

export const DEFAULT_HEIGHT = 160;

export function EmptyState({ height = DEFAULT_HEIGHT, text = "No data" }: { height?: number; text?: string }) {
  return <div className="bh-viz bh-empty" style={{ minHeight: height }}>{text}</div>;
}

export interface LegendItem {
  key: string;
  label: string;
  color: string;
  kind?: "box" | "line" | "dashed";
}

/** Legend mirrors the mark: box for bars/areas, line key for lines. Text stays on ink tokens. */
export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="bh-legend">
      {items.map((it) => (
        <li key={it.key}>
          {it.kind === "line" || it.kind === "dashed"
            ? <i className={it.kind === "dashed" ? "bh-linekey bh-linekey-dashed" : "bh-linekey"} style={{ borderTopColor: it.color }} aria-hidden="true" />
            : <i className="bh-swatch" style={{ background: it.color }} aria-hidden="true" />}
          <span>{it.label}</span>
        </li>
      ))}
    </ul>
  );
}

/** Tooltip body: value leads (strong), label follows; optional line key in the series colour. */
export function TipBody({ value, label, color, extra }: { value: string; label: string; color?: string; extra?: ReactNode }) {
  return (
    <div>
      <div className="bh-tip-row">
        {color ? <i className="bh-linekey" style={{ borderTopColor: color }} aria-hidden="true" /> : null}
        <strong>{value}</strong>
        <span className="bh-tip-sub">{label}</span>
      </div>
      {extra}
    </div>
  );
}

const ICON_PATHS: Record<Tone | "up" | "down" | "flat" | "over", string> = {
  good: "M3.5 8.5 6.5 11.5 12.5 5",
  warning: "M8 2.5 14 13H2zM8 6.5v3M8 11.2v.3",
  serious: "M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM8 5v3.5M8 10.8v.3",
  critical: "M5.5 2h5L14 5.5v5L10.5 14h-5L2 10.5v-5zM6 6l4 4M10 6l-4 4",
  neutral: "M3 8h10",
  up: "M8 13V3M4 7l4-4 4 4",
  down: "M8 3v10M4 9l4 4 4-4",
  flat: "M3 8h10M10 5l3 3-3 3",
  over: "M8 2.5 14 13H2zM8 6.5v3M8 11.2v.3",
};

/** Inline 16-unit stroke icon (no icon font, no dependency). Always paired with text by the caller. */
export function Glyph({ name, size = 14 }: { name: keyof typeof ICON_PATHS; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}
