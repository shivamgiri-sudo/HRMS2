import { BoxSelect, CalendarDays, Grid3x3 } from "lucide-react";
import { axisTick, formatCategory, formatValue } from "../format";
import { boxStats, dims, measures, toFrame, toMatrix } from "../shape";
import type { Cell, Theme, VizProps } from "../types";
import type { VizDef } from "./def";

const FOCUS = "cursor-pointer rounded focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_CALENDAR_DAYS = 800;

/** A hex colour at an opacity. Anything that is not #rgb / #rrggbb is returned unchanged. */
export function rgba(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex ?? "");
  if (!m) return hex;
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  return `rgba(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)}, ${alpha.toFixed(3)})`;
}
/** Cell opacity 0.08..1 for a value between min and max. */
const heat = (v: number, min: number, max: number) => (max === min ? 0.6 : 0.08 + 0.92 * Math.max(0, Math.min(1, (v - min) / (max - min))));

function Message({ theme, text = "No data" }: { theme: Theme; text?: string }) {
  return <div className="flex h-full w-full items-center justify-center p-3 text-center text-sm" style={{ color: theme.muted }}>{text}</div>;
}

function Heatmap({ result, style, theme, colors, onSelect }: VizProps) {
  const ds = dims(result), m = measures(result)[0];
  const mx = toMatrix(result);
  if (!m || !mx.rows.length) return <Message theme={theme} />;
  const rawByLabel = new Map<string, Cell>();
  if (ds[0]) for (const row of result.rows) rawByLabel.set(formatCategory(row[ds[0].key], ds[0]), row[ds[0].key]);
  const head = { background: theme.card, color: theme.muted };
  return (
    <div className="h-full w-full overflow-auto p-2">
      <div role="table" aria-label={`${m.label} by ${ds[0]?.label ?? "row"} and ${ds[1]?.label ?? "column"}`} className="grid gap-px text-xs" style={{ gridTemplateColumns: `minmax(72px, max-content) repeat(${mx.cols.length}, minmax(44px, 1fr))` }}>
        <div role="row" className="contents">
          <div role="columnheader" className="sticky left-0 top-0 z-20" style={head} />
          {mx.cols.map((c) => (
            <div key={c} role="columnheader" className="sticky top-0 z-10 truncate px-1 py-1 text-center font-medium" style={head} title={c}>{c}</div>
          ))}
        </div>
        {mx.rows.map((r, ri) => (
          <div key={r} role="row" className="contents">
            <div role="rowheader" className="sticky left-0 z-10 flex items-center px-1 font-medium" style={{ background: theme.card, color: theme.text }}>
              {onSelect && ds[0] ? (
                <button type="button" className={`${FOCUS} max-w-[10rem] truncate text-left hover:underline`} style={{ color: theme.text, outlineColor: theme.accent }} onClick={() => onSelect(ds[0].key, rawByLabel.get(r) ?? null)} title={`Filter by ${r}`}>{r}</button>
              ) : (
                <span className="max-w-[10rem] truncate" title={r}>{r}</span>
              )}
            </div>
            {mx.cols.map((c, ci) => {
              const v = mx.cells[ri][ci];
              const a = v === null ? 0 : heat(v, mx.min, mx.max);
              const text = formatValue(v, m.format, style);
              return (
                <div key={c} role="cell" className="flex min-h-[28px] items-center justify-center rounded-sm px-1 tabular-nums" title={`${r} / ${c}: ${text}`}
                  style={{ background: v === null ? theme.grid : rgba(colors[0], a), color: a > 0.55 ? "#FFFFFF" : theme.text }}>
                  {style.dataLabels !== false && v !== null ? text : ""}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function CalendarHeatmap({ result, style, theme, colors }: VizProps) {
  const d = dims(result)[0], m = measures(result)[0];
  if (!d || !m || !result.rows.length) return <Message theme={theme} />;
  const values = new Map<string, number>();
  let first: Date | null = null, last: Date | null = null;
  for (const row of result.rows) {
    const p = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(row[d.key] ?? ""));
    if (!p) continue;
    const date = new Date(Number(p[1]), Number(p[2]) - 1, Number(p[3]));
    if (Number.isNaN(date.getTime())) continue;
    if (!first || date < first) first = date;
    if (!last || date > last) last = date;
    const v = row[m.key];
    const n = typeof v === "number" ? v : v === null || v === "" ? NaN : Number(v);
    if (Number.isFinite(n)) values.set(dayKey(date), (values.get(dayKey(date)) ?? 0) + n);
  }
  if (!first || !last) return <Message theme={theme} text="Needs a date field grouped by day." />;
  const spanDays = Math.round((last.getTime() - first.getTime()) / 86400000) + 1;
  if (spanDays > MAX_CALENDAR_DAYS) first = new Date(last.getFullYear(), last.getMonth(), last.getDate() - (MAX_CALENDAR_DAYS - 1));
  // Start on the Monday of the first week; step with the local-date constructor so DST changes never skip a day.
  const lead = (first.getDay() + 6) % 7;
  const total = Math.min(spanDays, MAX_CALENDAR_DAYS) + lead;
  const weeks = Math.ceil(total / 7);
  const nums = [...values.values()];
  const min = nums.length ? Math.min(...nums) : 0, max = nums.length ? Math.max(...nums) : 0;
  const S = 12, G = 2, LEFT = 28, TOP = 14;
  const cells: JSX.Element[] = [], labels: JSX.Element[] = [];
  let prevMonth = -1;
  for (let i = lead; i < total; i++) {
    const date = new Date(first.getFullYear(), first.getMonth(), first.getDate() - lead + i);
    const w = Math.floor(i / 7), dow = i % 7, k = dayKey(date), v = values.get(k);
    if (date.getMonth() !== prevMonth) {
      prevMonth = date.getMonth();
      labels.push(<text key={`m${k}`} x={LEFT + w * (S + G)} y={10} fontSize={9} fill={theme.muted}>{MONTHS[prevMonth]}</text>);
    }
    cells.push(
      <rect key={k} x={LEFT + w * (S + G)} y={TOP + dow * (S + G)} width={S} height={S} rx={2} fill={v === undefined ? theme.grid : rgba(colors[0], heat(v, min, max))}>
        <title>{`${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}: ${formatValue(v ?? null, m.format, style)}`}</title>
      </rect>,
    );
  }
  const W = LEFT + weeks * (S + G) + 18, H = TOP + 7 * (S + G);
  return (
    <div className="flex h-full w-full items-center overflow-auto p-2">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${m.label} per day, ${dayKey(first)} to ${dayKey(last)}`} style={{ width: Math.round(W * 1.7), maxWidth: "100%", minWidth: Math.min(W, 260), height: "auto", margin: "0 auto" }}>
        {labels}
        {DAYS.map((name, i) => (i % 2 === 0 ? <text key={name} x={0} y={TOP + i * (S + G) + S - 2} fontSize={9} fill={theme.muted}>{name}</text> : null))}
        {cells}
      </svg>
    </div>
  );
}

function BoxPlot({ result, style, theme, colors }: VizProps) {
  const ms = measures(result);
  const stats = ms.length ? boxStats(toFrame(result)) : [];
  if (!stats.length) return <Message theme={theme} />;
  const format = ms[0].format;
  let lo = Math.min(...stats.map((s) => s.min)), hi = Math.max(...stats.map((s) => s.max));
  if (lo === hi) { lo -= 1; hi += 1; }
  const L = 52, T = 10, B = 30, PH = 190, STEP = 80;
  const W = Math.max(320, L + stats.length * STEP + 10), H = T + PH + B;
  const y = (v: number) => T + PH - ((v - lo) / (hi - lo)) * PH;
  const ticks = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4);
  const slot = (W - L - 10) / stats.length;
  const fmt = (v: number) => formatValue(v, format, style);
  return (
    <div className="h-full w-full overflow-auto p-2">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Box plot of ${stats.map((s) => s.label).join(", ")}`} style={{ width: "100%", height: "100%", minWidth: Math.min(W, stats.length * 56 + L) }}>
        {ticks.map((t, i) => (
          <g key={i}>
            {(style.grid !== false || i === 0) && <line x1={L} x2={W - 6} y1={y(t)} y2={y(t)} stroke={theme.grid} strokeWidth={1} />}
            <text x={L - 6} y={y(t) + 3} textAnchor="end" fontSize={10} fill={theme.muted}>{axisTick(t, format)}</text>
          </g>
        ))}
        {stats.map((s, i) => {
          const cx = L + slot * (i + 0.5), bw = Math.min(40, slot * 0.5), c = colors[i % colors.length];
          const label = s.label.length > 14 ? `${s.label.slice(0, 13)}…` : s.label;
          return (
            <g key={`${s.label}-${i}`}>
              <title>{`${s.label}: min ${fmt(s.min)}, Q1 ${fmt(s.q1)}, median ${fmt(s.median)}, Q3 ${fmt(s.q3)}, max ${fmt(s.max)} (n=${s.n})`}</title>
              <line x1={cx} x2={cx} y1={y(s.max)} y2={y(s.min)} stroke={c} strokeWidth={1.5} />
              <line x1={cx - bw / 4} x2={cx + bw / 4} y1={y(s.max)} y2={y(s.max)} stroke={c} strokeWidth={1.5} />
              <line x1={cx - bw / 4} x2={cx + bw / 4} y1={y(s.min)} y2={y(s.min)} stroke={c} strokeWidth={1.5} />
              <rect x={cx - bw / 2} y={y(s.q3)} width={bw} height={Math.max(1, y(s.q1) - y(s.q3))} fill={theme.card} />
              <rect x={cx - bw / 2} y={y(s.q3)} width={bw} height={Math.max(1, y(s.q1) - y(s.q3))} fill={c} fillOpacity={0.25} stroke={c} strokeWidth={1.5} />
              <line x1={cx - bw / 2} x2={cx + bw / 2} y1={y(s.median)} y2={y(s.median)} stroke={c} strokeWidth={2.5} />
              <text x={cx} y={T + PH + 16} textAnchor="middle" fontSize={10} fill={theme.text}>{label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export const MATRIX_VIZ: VizDef[] = [
  {
    type: "heatmap", label: "Heatmap", category: "Distribution", icon: Grid3x3, description: "Use to spot high and low values across two dimensions at once.",
    needs: { dims: [2, 2], measures: [1, 1] }, defaultSize: { w: 6, h: 8 },
    styleOptions: ["palette", "dataLabels", "numberFormat"], Component: Heatmap,
  },
  {
    type: "calendar_heatmap", label: "Calendar heatmap", category: "Distribution", icon: CalendarDays, description: "Use to see how a daily value varies across weeks and months.",
    needs: { dims: [1, 1], measures: [1, 1] }, defaultSize: { w: 8, h: 5 },
    styleOptions: ["palette", "numberFormat"], Component: CalendarHeatmap,
  },
  {
    type: "box_plot", label: "Box plot", category: "Distribution", icon: BoxSelect, description: "Use to compare the spread, median and range of values between series.",
    needs: { dims: [1, 2], measures: [1, 4] }, defaultSize: { w: 6, h: 7 },
    styleOptions: ["palette", "numberFormat", "grid"], Component: BoxPlot,
  },
];
