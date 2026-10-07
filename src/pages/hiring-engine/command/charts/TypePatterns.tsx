/**
 * Texture, marker and legend per drive type. Recharts renders only plain SVG children, so the pattern <defs> come from a function
 * call (typePatternDefs), not a component. Ids carry a per-chart prefix so two charts never share an id.
 */
import { useId } from "react";
import { SOURCE_TYPES, TYPE_LABEL } from "../driveCommandModel";
import type { SourceType } from "../driveCommandTypes";
import { TYPE_PATTERN, TYPE_SHAPE, seriesColor } from "../chartTheme";

/** A prefix safe inside url(#...) references (React ids contain colons). */
export function usePatternPrefix(): string { return `p${useId().replaceAll(":", "")}`; }
export function patternId(prefix: string, t: SourceType): string { return `${prefix}-${TYPE_PATTERN[t].id}`; }
export function patternFill(prefix: string, t: SourceType): string { return `url(#${patternId(prefix, t)})`; }

/** Series colour with light lines at the type's angle (45, 135 or 0 degrees). */
export function typePatternDefs(prefix: string, dark: boolean, types: readonly SourceType[] = SOURCE_TYPES) {
  return (
    <defs>
      {types.map((t) => (
        <pattern key={t} id={patternId(prefix, t)} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform={`rotate(${TYPE_PATTERN[t].angle})`}>
          <rect width="6" height="6" fill={seriesColor(t, dark)} />
          <line x1="0" y1="3" x2="6" y2="3" stroke={dark ? "#0f172a" : "#ffffff"} strokeOpacity="0.55" strokeWidth="1.5" />
        </pattern>
      ))}
    </defs>
  );
}

/** The type's marker shape as an inline SVG glyph (legend, row headers, tile titles). */
export function ShapeGlyph({ type, dark, size = 12 }: { type: SourceType; dark: boolean; size?: number }) {
  const c = seriesColor(type, dark);
  const shape = TYPE_SHAPE[type];
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true" focusable="false" className="shrink-0">
      {shape === "circle" && <circle cx="6" cy="6" r="5" fill={c} />}
      {shape === "triangle" && <polygon points="6,1 11,11 1,11" fill={c} />}
      {shape === "square" && <rect x="1" y="1" width="10" height="10" fill={c} />}
    </svg>
  );
}

/** Always-visible legend: texture swatch, marker shape and the type name; types without data say so in words. */
export function SeriesLegend({ dark, present, extra }: { dark: boolean; present?: readonly SourceType[]; extra?: Array<{ label: string; dashed: boolean }> }) {
  const prefix = usePatternPrefix();
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-700 dark:text-slate-200" aria-label="Legend">
      {SOURCE_TYPES.map((t) => (
        <li key={t} className="flex items-center gap-1.5">
          <svg width="18" height="12" aria-hidden="true" focusable="false" className="shrink-0">
            {typePatternDefs(prefix, dark, [t])}
            <rect x="0" y="0" width="18" height="12" rx="2" fill={patternFill(prefix, t)} />
          </svg>
          <ShapeGlyph type={t} dark={dark} size={10} />
          <span>{TYPE_LABEL[t]}{present && !present.includes(t) ? " (no data)" : ""}</span>
        </li>
      ))}
      {(extra ?? []).map((e) => (
        <li key={e.label} className="flex items-center gap-1.5">
          <svg width="18" height="12" aria-hidden="true" focusable="false" className="shrink-0">
            <line x1="0" y1="6" x2="18" y2="6" stroke={dark ? "#cbd5e1" : "#475569"} strokeWidth="2" strokeDasharray={e.dashed ? "4 3" : undefined} />
          </svg>
          <span>{e.label}</span>
        </li>
      ))}
    </ul>
  );
}
