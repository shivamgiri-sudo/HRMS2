import { ArrowDownRight, ArrowUpRight, Gauge as GaugeIcon, Hash, ListOrdered, Minus, Percent, Target } from "lucide-react";
import { delta, formatValue } from "../format";
import { thresholdColor } from "../palettes";
import { dims, measures, toFrame, topN } from "../shape";
import type { Cell, ResultColumn, Theme, VizProps, VizStyle } from "../types";
import type { VizDef } from "./def";

const GOOD = "#059669", BAD = "#DC2626";
const FOCUS = "cursor-pointer rounded focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1";
const toNum = (v: Cell | undefined): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

function Empty({ theme, text = "No data" }: { theme: Theme; text?: string }) {
  return <div className="flex h-full w-full items-center justify-center p-3 text-center text-sm" style={{ color: theme.muted }}>{text}</div>;
}

/** The headline number of a widget: the query total, else the only row's value. */
function headline(result: VizProps["result"], m: ResultColumn): number | null {
  return toNum(result.totals?.[m.key]) ?? (result.rows.length === 1 ? toNum(result.rows[0][m.key]) : null);
}

function Kpi({ result, style, theme, colors }: VizProps) {
  const m = measures(result)[0], d = dims(result)[0];
  if (!m) return <Empty theme={theme} />;
  const value = headline(result, m);
  const scale = style.fontScale && style.fontScale > 0 ? style.fontScale : 1;
  const dl = result.compare ? delta(value, result.compare.totals?.[m.key], style.higherIsBetter ?? true) : null;
  const dlColor = !dl || dl.flat ? theme.muted : dl.good ? GOOD : BAD;
  const DeltaIcon = !dl || dl.flat ? Minus : dl.up ? ArrowUpRight : ArrowDownRight;
  const target = typeof style.target === "number" && Number.isFinite(style.target) ? style.target : null;
  const pct = target && value !== null ? Math.max(0, Math.min(100, (value / target) * 100)) : 0;
  const spark = d && style.sparkline !== false ? result.rows.map((r) => toNum(r[m.key])).filter((v): v is number => v !== null) : [];
  const lo = Math.min(...spark), hi = Math.max(...spark);
  const points = spark.map((v, i) => `${((i / Math.max(spark.length - 1, 1)) * 100).toFixed(2)},${(22 - ((v - lo) / (hi - lo || 1)) * 20).toFixed(2)}`).join(" ");
  const centered = style.align === "center";
  return (
    <div className={`flex h-full w-full flex-col justify-center gap-1 overflow-auto p-3 ${centered ? "items-center text-center" : "items-start"}`}>
      <div className="font-semibold leading-tight tabular-nums" style={{ color: thresholdColor(style, value) ?? theme.text, fontSize: `${2.25 * scale}rem` }}>
        {formatValue(value, m.format, style)}
      </div>
      {dl && (
        <div className="flex items-center gap-1 text-sm font-medium" style={{ color: dlColor }}>
          <DeltaIcon className="h-4 w-4" aria-hidden="true" />
          <span>{dl.text}</span>
          <span className="font-normal" style={{ color: theme.muted }}>vs previous period</span>
        </div>
      )}
      {target !== null && (
        <div className="w-full">
          <div className="text-xs" style={{ color: theme.muted }}>Target {formatValue(target, m.format, style)}</div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full" style={{ background: theme.grid }} role="progressbar" aria-label="Progress to target" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: thresholdColor(style, value) ?? colors[0] }} />
          </div>
        </div>
      )}
      {spark.length > 1 && (
        <svg className="mt-1 h-8 w-full" viewBox="0 0 100 24" preserveAspectRatio="none" role="img" aria-label={`${m.label} trend, ${spark.length} points`}>
          <polyline points={points} fill="none" stroke={colors[0]} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      )}
    </div>
  );
}

function Gauge({ result, style, theme, colors }: VizProps) {
  const m = measures(result)[0];
  if (!m) return <Empty theme={theme} />;
  const value = headline(result, m);
  const target = typeof style.target === "number" && Number.isFinite(style.target) ? style.target : null;
  const min = style.min ?? 0;
  let max = style.max ?? (target ? target * 1.25 : 100);
  if (!(max > min)) max = min + 1;
  const frac = (v: number) => Math.max(0, Math.min(1, (v - min) / (max - min)));
  const pt = (f: number, r: number) => { const a = Math.PI * (1 - f); return `${(100 + r * Math.cos(a)).toFixed(2)} ${(100 - r * Math.sin(a)).toFixed(2)}`; };
  const f = value === null ? 0 : frac(value);
  const color = thresholdColor(style, value) ?? colors[0];
  const scale = style.fontScale && style.fontScale > 0 ? style.fontScale : 1;
  const text = formatValue(value, m.format, style);
  return (
    <div className="flex h-full w-full items-center justify-center overflow-hidden p-2">
      <svg className="h-full w-full" viewBox="0 0 200 124" role="img" aria-label={`${m.label}: ${text}, range ${formatValue(min, m.format, style)} to ${formatValue(max, m.format, style)}`}>
        <path d={`M ${pt(0, 80)} A 80 80 0 0 1 ${pt(1, 80)}`} fill="none" stroke={theme.grid} strokeWidth={16} strokeLinecap="round" />
        {f > 0 && <path d={`M ${pt(0, 80)} A 80 80 0 0 1 ${pt(f, 80)}`} fill="none" stroke={color} strokeWidth={16} strokeLinecap="round" />}
        {target !== null && (
          <path d={`M ${pt(frac(target), 68)} L ${pt(frac(target), 92)}`} stroke={theme.text} strokeWidth={2.5}>
            <title>{`Target ${formatValue(target, m.format, style)}`}</title>
          </path>
        )}
        <text x={100} y={94} textAnchor="middle" fontSize={24 * scale} fontWeight={600} fill={theme.text}>{text}</text>
        <text x={20} y={120} textAnchor="middle" fontSize={10} fill={theme.muted}>{formatValue(min, m.format, style)}</text>
        <text x={180} y={120} textAnchor="middle" fontSize={10} fill={theme.muted}>{formatValue(max, m.format, style)}</text>
      </svg>
    </div>
  );
}

interface Item { label: string; value: number | null }
/** One item per category (top N), or a single item for the total when there is no dimension. */
function barItems(result: VizProps["result"], style: VizStyle, m: ResultColumn): Item[] {
  if (!dims(result).length) return [{ label: m.label, value: toNum(result.totals?.[m.key]) ?? toNum(result.rows[0]?.[m.key]) }];
  const f = topN(toFrame(result), style.topN);
  return f.categories.map((label, i) => ({ label, value: f.series[0]?.values[i] ?? null }));
}

function Bullet({ result, style, theme, colors }: VizProps) {
  const m = measures(result)[0];
  const items = m ? barItems(result, style, m) : [];
  if (!m || !items.length) return <Empty theme={theme} />;
  const target = typeof style.target === "number" && Number.isFinite(style.target) ? style.target : null;
  const min = style.min ?? 0;
  let max = style.max ?? Math.max(0, ...items.map((i) => i.value ?? 0), target ?? 0) * 1.1;
  if (!(max > min)) max = min + 1;
  const pos = (v: number) => Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100));
  return (
    <div className="flex h-full w-full flex-col gap-2 overflow-auto p-3 [justify-content:safe_center]">
      {items.map((it, i) => (
        <div key={`${it.label}-${i}`} className="flex items-center gap-2 text-sm">
          <div className="w-1/4 min-w-0 shrink-0 truncate" style={{ color: theme.text }} title={it.label}>{it.label}</div>
          <div className="relative h-3 min-w-0 flex-1 rounded-sm" style={{ background: theme.grid }}>
            <div className="h-full rounded-sm" style={{ width: `${it.value === null ? 0 : pos(it.value)}%`, background: thresholdColor(style, it.value) ?? colors[0] }} />
            {target !== null && (
              <div className="absolute -bottom-1 -top-1 w-0.5" style={{ left: `${pos(target)}%`, background: theme.text }} title={`Target ${formatValue(target, m.format, style)}`} />
            )}
          </div>
          <div className="w-20 shrink-0 text-right tabular-nums" style={{ color: theme.text }}>{formatValue(it.value, m.format, style)}</div>
        </div>
      ))}
      {target !== null && <div className="text-xs" style={{ color: theme.muted }}>Target {formatValue(target, m.format, style)}</div>}
    </div>
  );
}

function Progress({ result, style, theme, colors }: VizProps) {
  const m = measures(result)[0];
  const items = m ? barItems(result, style, m) : [];
  if (!m || !items.length) return <Empty theme={theme} />;
  const target = typeof style.target === "number" && Number.isFinite(style.target) && style.target > 0 ? style.target : null;
  const denom = target ?? Math.max(0, ...items.map((i) => i.value ?? 0));
  return (
    <div className="flex h-full w-full flex-col gap-3 overflow-auto p-3 [justify-content:safe_center]">
      {items.map((it, i) => {
        const pct = it.value === null || !denom ? null : (it.value / denom) * 100;
        return (
          <div key={`${it.label}-${i}`} className="text-sm">
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate" style={{ color: theme.text }} title={it.label}>{it.label}</span>
              <span className="shrink-0 tabular-nums" style={{ color: theme.text }}>{formatValue(it.value, m.format, style)}</span>
            </div>
            <div className="mt-1 h-2 w-full overflow-hidden rounded-full" style={{ background: theme.grid }} role="progressbar" aria-label={it.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.max(0, Math.min(100, pct ?? 0)))}>
              <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, pct ?? 0))}%`, background: thresholdColor(style, it.value) ?? colors[0] }} />
            </div>
            <div className="mt-0.5 text-xs" style={{ color: theme.muted }}>
              {pct === null ? "—" : `${Math.round(pct)}% of ${target !== null ? "target" : "largest value"}`}
              {target !== null && ` (${formatValue(target, m.format, style)})`}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Leaderboard({ result, style, theme, colors, onSelect }: VizProps) {
  const d = dims(result)[0], ms = measures(result);
  if (!d || !ms.length || !result.rows.length) return <Empty theme={theme} />;
  const first = ms[0];
  const n = style.topN && style.topN > 0 ? style.topN : 10;
  const rows = [...result.rows].sort((a, b) => (toNum(b[first.key]) ?? -Infinity) - (toNum(a[first.key]) ?? -Infinity)).slice(0, n);
  const top = Math.max(0, ...rows.map((r) => Math.abs(toNum(r[first.key]) ?? 0)));
  const frame = toFrame({ ...result, rows });
  return (
    <ol className="m-0 flex h-full w-full list-none flex-col gap-1.5 overflow-auto p-3" aria-label={`${d.label} ranked by ${first.label}`}>
      {rows.map((row, i) => {
        const v = toNum(row[first.key]);
        const label = frame.categories[i];
        return (
          <li key={`${label}-${i}`} className="flex items-center gap-2 text-sm">
            <span className="w-6 shrink-0 text-right tabular-nums" style={{ color: theme.muted }}>{i + 1}</span>
            <div className="min-w-0 flex-1">
              {onSelect ? (
                <button type="button" className={`${FOCUS} block max-w-full truncate text-left hover:underline`} style={{ color: theme.text, outlineColor: theme.accent }} onClick={() => onSelect(d.key, row[d.key])} title={`Filter by ${label}`}>{label}</button>
              ) : (
                <div className="truncate" style={{ color: theme.text }} title={label}>{label}</div>
              )}
              <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full" style={{ background: theme.grid }}>
                <div className="h-full rounded-full" style={{ width: `${top && v !== null ? (Math.abs(v) / top) * 100 : 0}%`, background: thresholdColor(style, v) ?? colors[0] }} />
              </div>
            </div>
            {ms.map((m, mi) => (
              <span key={m.key} className="shrink-0 text-right tabular-nums" style={{ color: mi === 0 ? theme.text : theme.muted, fontWeight: mi === 0 ? 600 : 400 }} title={m.label}>
                {formatValue(row[m.key], m.format, style)}
              </span>
            ))}
          </li>
        );
      })}
    </ol>
  );
}

export const TILE_VIZ: VizDef[] = [
  {
    type: "kpi", label: "KPI tile", category: "Tiles", icon: Hash, description: "Use for one headline number, with its change against the previous period and an optional target.",
    needs: { dims: [0, 1], measures: [1, 1] }, defaultSize: { w: 3, h: 4 },
    styleOptions: ["numberFormat", "thresholds", "target", "higherIsBetter", "sparkline", "palette"], Component: Kpi,
  },
  {
    type: "gauge", label: "Gauge", category: "Tiles", icon: GaugeIcon, description: "Use to show where a single number sits within a fixed range.",
    needs: { dims: [0, 0], measures: [1, 1] }, defaultSize: { w: 3, h: 5 },
    styleOptions: ["numberFormat", "thresholds", "target", "range", "palette"], Component: Gauge,
  },
  {
    type: "bullet", label: "Bullet", category: "Tiles", icon: Target, description: "Use to compare a value, or one value per category, against a target marker.",
    needs: { dims: [0, 1], measures: [1, 1] }, defaultSize: { w: 4, h: 4 },
    styleOptions: ["numberFormat", "thresholds", "target", "range", "palette", "topN"], Component: Bullet,
  },
  {
    type: "progress", label: "Progress", category: "Tiles", icon: Percent, description: "Use to show how far a value has got towards its target as a percentage.",
    needs: { dims: [0, 1], measures: [1, 1] }, defaultSize: { w: 4, h: 4 },
    styleOptions: ["numberFormat", "target", "palette", "topN", "thresholds"], Component: Progress,
  },
  {
    type: "leaderboard", label: "Leaderboard", category: "Tiles", icon: ListOrdered, description: "Use to rank the top categories by a measure.",
    needs: { dims: [1, 1], measures: [1, 3] }, defaultSize: { w: 4, h: 8 }, defaults: { topN: 10 },
    styleOptions: ["numberFormat", "topN", "palette", "thresholds"], Component: Leaderboard,
  },
];
