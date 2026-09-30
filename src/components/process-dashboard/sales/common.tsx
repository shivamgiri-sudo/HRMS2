/** Shared building blocks of the Sales and Outbound tabs and setup panels (new files only; the APR dashboard is untouched). */
import { useEffect, useState, type ReactNode } from "react";
import { ArrowDown, ArrowDownRight, ArrowUp, ArrowUpDown, ArrowUpRight, ChevronLeft, ChevronRight, Minus, Pause, Play, Radio, RefreshCw, Search, X } from "lucide-react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DASH, formatAge, formatDelta, formatValue } from "../format";
import { PRESETS, detectPreset, presetRange } from "../urlState";
import { Empty, FOCUS, SERIES_COLORS, btn, reduceMotion } from "../ui";
import { type ColumnInfo, type Problem } from "./extApi";
import { input, lbl } from "./ext.style";
import type { useExtLive } from "./ext.hooks";
import { columnFits, type ExtUrl, type FieldDef } from "./ext.model";

const field = `min-h-[36px] rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 ${FOCUS}`;

export function LiveHeader({ title, badgeLabel, live, freshness, fetching, truncated }: {
  title: string; badgeLabel: string; live: ReturnType<typeof useExtLive>; freshness?: { latestDate: string | null; rows: number }; fetching: boolean; truncated?: boolean;
}) {
  const { poll, checkedAt, now, refreshAll } = live;
  const badge = poll.failures > 0 ? { t: `Reconnecting (retry ${Math.round(poll.nextDelayMs / 1000)}s)`, c: "bg-amber-50 text-amber-900 ring-amber-300" }
    : poll.paused ? { t: "Paused", c: "bg-slate-100 text-slate-800 ring-slate-300" } : poll.hidden ? { t: "Idle (tab hidden)", c: "bg-slate-100 text-slate-800 ring-slate-300" } : { t: "LIVE", c: "bg-emerald-50 text-emerald-800 ring-emerald-300" };
  return (
    <header className="rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-blue-900 p-4 text-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex flex-wrap items-center gap-2 text-lg font-bold">{title}<span className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-semibold">{badgeLabel}</span></h2>
        <div className="flex flex-wrap items-center gap-2">
          <span role="status" aria-live="polite" className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ring-1 ${badge.c}`}><Radio className="h-3.5 w-3.5" aria-hidden="true" />{badge.t}</span>
          <button type="button" onClick={poll.paused ? poll.resume : poll.pause} aria-pressed={poll.paused} className={`${btn} text-slate-900`}>
            {poll.paused ? <Play className="h-3.5 w-3.5" aria-hidden="true" /> : <Pause className="h-3.5 w-3.5" aria-hidden="true" />}{poll.paused ? "Resume" : "Pause"}<span className="sr-only"> auto-refresh</span></button>
          <button type="button" onClick={() => void refreshAll()} className={`${btn} text-slate-900`}><RefreshCw className={`h-3.5 w-3.5 ${fetching ? "motion-safe:animate-spin" : ""}`} aria-hidden="true" />Refresh</button>
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-200">
        {freshness?.latestDate ? `Latest day ${freshness.latestDate}` : "No data yet"}{typeof freshness?.rows === "number" ? ` · ${freshness.rows.toLocaleString("en-IN")} source rows` : ""}{checkedAt ? ` · checked ${formatAge(now - checkedAt)}` : ""}
      </p>
      {truncated && <p role="alert" className="mt-2 inline-block rounded-lg bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-950">The range holds more rows than the dashboard loads (200,000). Figures cover the earliest rows only: narrow the date range.</p>}
    </header>
  );
}

export function FilterBar({ state, onChange, range, tls, lobs, lobLabel, products, searchLabel = "Search agent code or TL" }: {
  state: ExtUrl; onChange: (p: Partial<ExtUrl>) => void; range?: { from: string; to: string }; tls: string[]; lobs: string[]; lobLabel: string; products?: string[]; searchLabel?: string;
}) {
  const from = state.from || range?.from || "", to = state.to || range?.to || "";
  const preset = from && to ? detectPreset(from, to) : null;
  const [q, setQ] = useState(state.q);
  useEffect(() => setQ(state.q), [state.q]);
  useEffect(() => { if (q === state.q) return undefined; const t = setTimeout(() => onChange({ q }), 350); return () => clearTimeout(t); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const opts = (vals: string[], cur: string) => Array.from(new Set([...vals, ...(cur ? [cur] : [])]));
  const any = state.tl || state.lob || state.product || state.q;
  return (
    <div role="search" aria-label="Filters" className="flex flex-wrap items-end gap-2 rounded-2xl border border-slate-200 bg-white p-3">
      <div role="group" aria-label="Date presets" className="flex flex-wrap gap-1">
        {PRESETS.map((p) => <button key={p.key} type="button" aria-pressed={preset === p.key} onClick={() => onChange(presetRange(p.key))}
          className={`min-h-[36px] cursor-pointer rounded-lg px-2.5 text-xs font-semibold ${FOCUS} ${preset === p.key ? "bg-blue-700 text-white" : "bg-slate-100 text-slate-800 hover:bg-slate-200"}`}>{p.label}</button>)}
      </div>
      <label className="text-[11px] font-medium text-slate-700">From<input type="date" value={from} max={to || undefined} onChange={(e) => e.target.value && onChange({ from: e.target.value, to: state.to || to })} className={`${field} ml-1`} /></label>
      <label className="text-[11px] font-medium text-slate-700">To<input type="date" value={to} min={from || undefined} onChange={(e) => e.target.value && onChange({ to: e.target.value, from: state.from || from })} className={`${field} ml-1`} /></label>
      <label className="text-[11px] font-medium text-slate-700">Team leader<select value={state.tl} onChange={(e) => onChange({ tl: e.target.value })} className={`${field} ml-1 cursor-pointer`}><option value="">All</option>{opts(tls, state.tl).map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
      <label className="text-[11px] font-medium text-slate-700">{lobLabel}<select value={state.lob} onChange={(e) => onChange({ lob: e.target.value })} className={`${field} ml-1 cursor-pointer`}><option value="">All</option>{opts(lobs, state.lob).map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
      {products && <label className="text-[11px] font-medium text-slate-700">Product<select value={state.product} onChange={(e) => onChange({ product: e.target.value })} className={`${field} ml-1 cursor-pointer`}><option value="">All</option>{opts(products, state.product).map((n) => <option key={n} value={n}>{n}</option>)}</select></label>}
      <label className="relative min-w-[160px] flex-1 text-[11px] font-medium text-slate-700"><span className="sr-only">{searchLabel}</span>
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" aria-hidden="true" />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchLabel} className={`${field} w-full pl-8`} /></label>
      {any && <button type="button" onClick={() => { setQ(""); onChange({ tl: "", lob: "", product: "", q: "" }); }} className={`inline-flex min-h-[36px] cursor-pointer items-center gap-1 rounded-lg px-2 text-xs font-semibold text-blue-800 hover:bg-blue-50 ${FOCUS}`}><X className="h-3.5 w-3.5" aria-hidden="true" />Clear filters</button>}
    </div>
  );
}

export interface TileData { key: string; label: string; unit: string; direction: "higher" | "lower"; value: number | null; deltaPct: number | null; available: boolean; note?: string }
const TONE = { good: "text-emerald-800", bad: "text-red-800", neutral: "text-slate-700" } as const;
export function Tiles({ tiles, label = "Key metrics" }: { tiles: TileData[]; label?: string }) {
  const shown = tiles.filter((t) => t.available);
  if (!shown.length) return null;
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4" aria-label={label}>
      {shown.map((t) => {
        const d = formatDelta(t.deltaPct, t.direction);
        const Arrow = d.arrow === "up" ? ArrowUpRight : d.arrow === "down" ? ArrowDownRight : Minus;
        return (
          <li key={t.key} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm" aria-label={`${t.label}: ${formatValue(t.value, t.unit)}. ${d.srText}.`}>
            <span className="text-[11px] font-medium leading-tight text-slate-700">{t.label}</span>
            <span className="mt-1 block text-xl font-bold leading-none tabular-nums text-slate-900">{formatValue(t.value, t.unit)}</span>
            <span className={`mt-1.5 flex items-center gap-1 text-[11px] font-semibold ${TONE[d.tone]}`}><Arrow className="h-3.5 w-3.5" aria-hidden="true" />{d.text}</span>
            {t.note && <span className="mt-0.5 block text-[10px] text-slate-600">{t.note}</span>}
          </li>
        );
      })}
    </ul>
  );
}

const shortDay = (d: string) => { const t = new Date(`${d}T00:00:00`); return Number.isNaN(t.getTime()) ? d : t.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }); };
export interface Series { key: string; label: string; unit: string; type: "bar" | "line"; axis: "l" | "r" }
export function TrendChart({ data, series, onDay, name }: { data: Array<Record<string, unknown> & { date: string }>; series: Series[]; onDay?: (d: string) => void; name: string }) {
  if (!data.length) return <Empty>No daily trend for this range.</Empty>;
  const rightUnit = series.find((s) => s.axis === "r")?.unit;
  const first = series[0];
  return (
    <>
      <div role="img" aria-label={`${name}: daily ${series.map((s) => s.label).join(", ")} from ${data[0].date} to ${data[data.length - 1].date}. The same values are in the table below the chart.`} className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} style={{ cursor: onDay ? "pointer" : undefined }}
            onClick={(e) => { const l = (e as { activeLabel?: string } | undefined)?.activeLabel; if (l && onDay) onDay(String(l)); }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="date" tickFormatter={shortDay} tick={{ fontSize: 11 }} />
            <YAxis yAxisId="l" tick={{ fontSize: 11 }} tickFormatter={(v) => formatValue(v as number, first.unit)} width={60} />
            {rightUnit && <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11 }} tickFormatter={(v) => formatValue(v as number, rightUnit)} width={56} />}
            <Tooltip labelFormatter={(d) => shortDay(String(d))} formatter={(v, n) => [formatValue(typeof v === "number" ? v : null, series.find((s) => s.label === n)?.unit), n]} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {series.map((s, i) => s.type === "bar"
              ? <Bar key={s.key} yAxisId={s.axis} dataKey={s.key} name={s.label} fill={SERIES_COLORS[i % SERIES_COLORS.length]} fillOpacity={0.85} isAnimationActive={!reduceMotion()} />
              : <Line key={s.key} yAxisId={s.axis} type="monotone" dataKey={s.key} name={s.label} stroke={SERIES_COLORS[i % SERIES_COLORS.length]} strokeWidth={2} strokeDasharray={i % 2 ? "5 3" : undefined} dot={false} connectNulls isAnimationActive={!reduceMotion()} />)}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-3 text-xs text-slate-800">
        <summary className={`cursor-pointer rounded font-semibold ${FOCUS}`}>View as table</summary>
        <div className="mt-2"><DataTable caption={`${name} values by day`} maxHeight="max-h-72" rows={data} cols={[{ key: "date", label: "Date", align: "left" }, ...series.map((s) => ({ key: s.key, label: s.label, unit: s.unit }))]}
          onRow={onDay ? (r) => onDay(String(r.date)) : undefined} rowLabel={(r) => `Open ${r.date}`} /></div>
      </details>
    </>
  );
}

export interface BarItem { label: string; value: number; pct: number | null; sub?: string; tone?: "good" | "bad" | "neutral" }
const BAR_TONE = { good: "bg-emerald-500", bad: "bg-red-500", neutral: "bg-blue-600" } as const;
/** Horizontal bars (funnel / disposition mix). The label, count and share are printed text, so the bars are decorative. */
export function BarList({ items, name, valueLabel = "orders" }: { items: BarItem[]; name: string; valueLabel?: string }) {
  if (!items.length) return <Empty>Nothing to show for this range.</Empty>;
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <ul aria-label={name} className="space-y-2">
      {items.map((i) => (
        <li key={i.label}>
          <div className="flex items-baseline justify-between gap-2 text-xs"><span className="min-w-0 truncate font-semibold text-slate-800" title={i.label}>{i.label}</span>
            <span className="shrink-0 tabular-nums text-slate-800">{i.value.toLocaleString("en-IN")} {valueLabel}{i.pct !== null ? ` · ${i.pct}%` : ""}{i.sub ? ` · ${i.sub}` : ""}</span></div>
          <div aria-hidden="true" className="mt-0.5 h-2 rounded-full bg-slate-100"><div className={`h-2 rounded-full ${BAR_TONE[i.tone ?? "neutral"]}`} style={{ width: `${Math.max(2, (i.value / max) * 100)}%` }} /></div>
        </li>))}
    </ul>
  );
}

export interface DataCol { key: string; label: string; unit?: string; align?: "left" | "right"; sortable?: boolean; render?: (r: Record<string, unknown>) => ReactNode }
/** Accessible table; first cell is a button when onRow is given. Sortable columns expose aria-sort and are controlled from outside. */
export function DataTable({ cols, rows, caption, onRow, rowLabel, maxHeight, sort, dir, onSort }: {
  cols: DataCol[]; rows: Array<Record<string, unknown>>; caption: string; onRow?: (r: Record<string, unknown>) => void; rowLabel?: (r: Record<string, unknown>) => string; maxHeight?: string;
  sort?: string; dir?: "asc" | "desc"; onSort?: (key: string) => void;
}) {
  return (
    <div className={`overflow-auto rounded-xl border border-slate-200 bg-white ${maxHeight ?? ""}`}>
      <table className="w-full text-xs">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 bg-slate-50 text-slate-700"><tr>
          {cols.map((c) => {
            const on = sort === c.key; const Icon = !on ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
            return <th key={c.key} scope="col" aria-sort={on ? (dir === "asc" ? "ascending" : "descending") : c.sortable ? "none" : undefined} className={`whitespace-nowrap px-3 py-2 font-semibold ${c.align === "left" ? "text-left" : "text-right"}`}>
              {c.sortable && onSort ? <button type="button" onClick={() => onSort(c.key)} className={`inline-flex cursor-pointer items-center gap-1 rounded font-semibold ${FOCUS}`}>{c.label}<Icon className="h-3 w-3" aria-hidden="true" /></button> : c.label}</th>;
          })}
        </tr></thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-slate-50">
              {cols.map((c, ci) => {
                const raw = r[c.key];
                const content = c.render ? c.render(r) : typeof raw === "number" ? formatValue(raw, c.unit) : raw == null || raw === "" ? DASH : String(raw);
                return <td key={c.key} className={`whitespace-nowrap px-3 py-1.5 tabular-nums text-slate-800 ${c.align === "left" ? "text-left" : "text-right"}`}>
                  {ci === 0 && onRow ? <button type="button" onClick={() => onRow(r)} aria-label={rowLabel?.(r)} className={`cursor-pointer rounded font-semibold text-blue-800 underline-offset-2 hover:underline ${FOCUS}`}>{content}</button> : content}</td>;
              })}
            </tr>))}
        </tbody>
      </table>
    </div>
  );
}

export function Pager({ page, total, size, onPage }: { page: number; total: number; size: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (total <= size) return null;
  return (
    <nav aria-label="Pagination" className="mt-2 flex items-center justify-end gap-2 text-xs text-slate-700">
      <span aria-live="polite">Page {page} of {pages} ({total.toLocaleString("en-IN")} rows)</span>
      <button type="button" className={btn} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" /></button>
      <button type="button" className={btn} disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /></button>
    </nav>
  );
}

export function ProblemList({ problems }: { problems: Problem[] }) {
  if (!problems.length) return <p className="text-xs font-semibold text-emerald-800">No problems found.</p>;
  return (
    <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950"><p className="font-bold">Problems found ({problems.length})</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">{problems.map((p, i) => <li key={i}>{p.severity === "error" ? "Error" : "Warning"}: {p.message}</li>)}</ul></div>
  );
}

/** One select per field listing only the columns that fit its type. */
export function MappingEditor({ idPrefix, fields, columns, value, onChange }: { idPrefix: string; fields: FieldDef[]; columns: ColumnInfo[]; value: Record<string, string>; onChange: (m: Record<string, string>) => void }) {
  return (
    <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
      {fields.map((f) => {
        const v = value[f.key] ?? ""; const missing = f.required && !v;
        const opts = columns.filter((c) => columnFits(f.kind, c) || c.name === v);
        return (
          <div key={f.key}>
            <label className={lbl} htmlFor={`${idPrefix}-${f.key}`}>{f.label}{f.required && <span className="text-red-700" aria-hidden="true"> *</span>}{f.required && <span className="sr-only"> (required)</span>}</label>
            <select id={`${idPrefix}-${f.key}`} value={v} onChange={(e) => onChange({ ...value, [f.key]: e.target.value })} aria-invalid={missing} className={`${input} cursor-pointer ${missing ? "border-red-400" : ""}`}>
              <option value="">{f.required ? "Select a column" : "Not mapped"}</option>
              {opts.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.dataType})</option>)}</select>
          </div>);
      })}
    </div>
  );
}
