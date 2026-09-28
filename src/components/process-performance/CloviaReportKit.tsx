import { useEffect, useMemo, useState, type ComponentType } from "react";
import {
  ComposedChart, BarChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart as RPie, Pie, Cell,
} from "recharts";
import {
  Mail, MailOpen, MailCheck, Gauge, Inbox, Hourglass, RotateCcw, Trash2, Users, ShieldCheck, ClipboardCheck, ClipboardList, MessageSquare,
  UserRound, Repeat, Timer, Clock3, MessageSquareOff, Smartphone, MessageCircleQuestion, BadgeCheck, PhoneOutgoing, PhoneCall, Hash, PhoneOff,
  PieChart, MessageSquareHeart, Smile, Frown, Languages, PhoneForwarded, PhoneMissed, PhoneIncoming, OctagonAlert, TrendingDown, CheckCircle2,
  ArrowUpRight, AlertTriangle, Star, Search, ArrowUpDown, Lightbulb, Info, ChevronLeft, LayoutGrid,
} from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { KpiCard, SectionCard, type KpiTone, type ExportTable } from "./DashboardKit";

/**
 * Generic renderer for the Clovia LOB report specs (backend/.../clovia-lob.shared.ts).
 * The server decides WHAT is on a slide (KPIs, charts, tables, insights, notes);
 * this file only draws it: KPI cards, combo / horizontal-bar / donut / heat-map
 * charts, searchable sortable tables whose rows open a right-hand slide-over
 * (fed by GET .../detail, never by the list payload) and a record view (GET
 * /clovia-record) for single rows.
 */

export type Fmt = "int" | "pct" | "sec" | "hrs" | "dec1" | "dec2" | "text";
export interface Kpi { key: string; label: string; value: number | string | null; fmt: Fmt; tone: KpiTone; icon: string; sub?: string; tab?: string }
export interface ChartSeries { key: string; label: string; color: string; type?: "bar" | "line" | "area"; axis?: "left" | "right"; stackId?: string; fmt?: Fmt }
export interface ChartSpec {
  key: string; title: string; subtitle?: string; tab: string; kind: "combo" | "hbar" | "donut" | "heatmap";
  xKey?: string; xFmt?: "date" | "text" | "hour"; series?: ChartSeries[]; data?: Array<Record<string, number | string | null>>;
  heat?: { xLabels: string[]; yLabels: string[]; xKeys: string[]; yKeys: string[]; cells: Array<{ x: number; y: number; v: number }>; unit: string };
  footnote?: string; drill?: { kind: string; keyField?: string }; span?: 1 | 2;
}
export interface Column { key: string; label: string; fmt?: Fmt; align?: "left" | "right"; hint?: string }
export interface TableSpec {
  key: string; title: string; subtitle?: string; tab: string; columns: Column[]; rows: Array<Record<string, unknown>>;
  drillKind: string; keyField: string; searchable?: boolean; footnote?: string; totals?: Record<string, unknown>;
  defaultSort?: { key: string; dir: "asc" | "desc" };
}
export interface Insight { tone: "info" | "good" | "warn" | "bad"; text: string; tab?: string }
export interface CoverageRow { source: string; table: string; rows: number; minDate: string | null; maxDate: string | null; days: number; note?: string }
export interface LobPayload {
  lob: string; label: string; from: string; to: string; filters: Record<string, string>; options: Record<string, string[]>;
  tabs: Array<{ key: string; label: string }>; coverage: CoverageRow[]; kpis: Kpi[]; charts: ChartSpec[]; tables: TableSpec[]; insights: Insight[];
  metrics: Record<string, number | null>; notes: string[]; definitions: Array<{ term: string; meaning: string }>; empty: boolean; latestDate: string | null;
}
export interface DetailSection {
  title: string; type: "kv" | "table" | "chart" | "text" | "kpis";
  kv?: Array<{ label: string; value: string | number | null; fmt?: Fmt }>;
  table?: { columns: Column[]; rows: Array<Record<string, unknown>>; recordType?: string; keyField?: string };
  chart?: ChartSpec; text?: string; kpis?: Kpi[]; empty?: string;
}
export interface DetailPayload { title: string; subtitle?: string; badge?: { label: string; tone: "green" | "amber" | "red" | "slate" | "blue" }; sections: DetailSection[] }
export interface PeriodColumn { key: string; label: string; kind: "week" | "day"; from: string; to: string }
export interface PeriodRow { key: string; label: string; fmt: Fmt; value: number | string | null; cols: Record<string, number | string | null> }
export interface PeriodBreakdown { from: string; to: string; columns: PeriodColumn[]; tables: Array<{ title: string; rowsLabel: string; rows: PeriodRow[] }>; dailyColumnsOmitted: boolean }

/* ───────────────────────────── formatting ───────────────────────────── */

export const fmtSecs = (s: number) => {
  if (!Number.isFinite(s)) return "—";
  const t = Math.round(s);
  return t >= 60 ? `${Math.floor(t / 60)}m ${String(t % 60).padStart(2, "0")}s` : `${t}s`;
};
export function fmtVal(v: unknown, fmt?: Fmt): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "string" && fmt !== "text" && Number.isNaN(Number(v))) return v;
  const n = Number(v);
  switch (fmt) {
    case "int": return Math.round(n).toLocaleString("en-IN");
    case "pct": return `${Math.round(n * 10) / 10}%`;
    case "sec": return fmtSecs(n);
    case "hrs": return `${Math.round(n * 10) / 10}h`;
    case "dec1": return (Math.round(n * 10) / 10).toLocaleString("en-IN");
    case "dec2": return (Math.round(n * 100) / 100).toLocaleString("en-IN");
    default: return String(v);
  }
}
export const fmtDate = (iso: string) => { const [y, m, d] = String(iso).split("-"); return y && m && d ? `${d}/${m}/${y}` : String(iso); };
const shortDay = (iso: string) => { const d = new Date(`${iso}T00:00:00`); return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }); };

const ICONS: Record<string, ComponentType<{ className?: string }>> = {
  Mail, MailOpen, MailCheck, Gauge, Inbox, Hourglass, RotateCcw, Trash2, Users, ShieldCheck, ClipboardCheck, ClipboardList, MessageSquare, UserRound, Repeat, Timer, Clock3,
  MessageSquareOff, Smartphone, MessageCircleQuestion, BadgeCheck, PhoneOutgoing, PhoneCall, Hash, PhoneOff, PieChart, MessageSquareHeart, Smile, Frown, Languages,
  PhoneForwarded, PhoneMissed, PhoneIncoming, OctagonAlert, TrendingDown, CheckCircle2, ArrowUpRight, AlertTriangle, Star,
};
const iconOf = (n: string) => ICONS[n] ?? Gauge;
const PIE_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#0ea5e9", "#f43f5e", "#a78bfa", "#14b8a6", "#ec4899", "#84cc16", "#64748b"];
const TOOLTIP = { contentStyle: { fontSize: 12, borderRadius: 10, border: "1px solid #e2e8f0" } } as const;

/* ───────────────────────────── KPI grid ───────────────────────────── */

export function KpiGrid({ kpis }: { kpis: Kpi[] }) {
  if (kpis.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      {kpis.map((k) => (
        <KpiCard key={k.key} icon={iconOf(k.icon)} label={k.label} value={fmtVal(k.value, k.fmt)} sub={k.sub} tone={k.tone} />
      ))}
    </div>
  );
}

export function InsightList({ insights }: { insights: Insight[] }) {
  if (insights.length === 0) return null;
  const tone = { info: "border-slate-200 bg-slate-50 text-slate-700", good: "border-emerald-200 bg-emerald-50 text-emerald-800", warn: "border-amber-200 bg-amber-50 text-amber-800", bad: "border-red-200 bg-red-50 text-red-800" };
  return (
    <SectionCard icon={Lightbulb} title="Key insights" tone="amber">
      <ul className="space-y-2">
        {insights.map((i, n) => (
          <li key={n} className={`rounded-xl border px-3 py-2 text-xs leading-relaxed ${tone[i.tone]}`}>{i.text}</li>
        ))}
      </ul>
    </SectionCard>
  );
}

/* ───────────────────────────── charts ───────────────────────────── */

export function ChartCard({ spec, onDrill }: { spec: ChartSpec; onDrill?: (kind: string, key: string) => void }) {
  const drill = spec.drill;
  const click = (row: Record<string, unknown> | undefined) => {
    if (!drill || !row) return;
    const kf = drill.keyField ?? spec.xKey ?? "";
    const key = row[kf] ?? row[spec.xKey ?? ""];
    if (key !== undefined && key !== null) onDrill?.(drill.kind, String(key));
  };
  const data = spec.data ?? [];
  const xTick = (v: unknown) => (spec.xFmt === "date" ? shortDay(String(v)) : String(v));
  const hasRight = (spec.series ?? []).some((s) => s.axis === "right");
  let body: JSX.Element;
  if (spec.kind === "heatmap" && spec.heat) {
    const h = spec.heat; const max = Math.max(1, ...h.cells.map((c) => c.v));
    const cell = new Map(h.cells.map((c) => [`${c.x}|${c.y}`, c.v]));
    body = (
      <div className="overflow-x-auto">
        <table className="border-collapse text-[10px]">
          <thead><tr><th className="sticky left-0 bg-white px-2 py-1 text-left font-semibold text-slate-500">Hour</th>{h.xLabels.map((x, i) => <th key={i} className="px-1.5 py-1 text-center font-semibold text-slate-500">{x}</th>)}</tr></thead>
          <tbody>
            {h.yLabels.map((y, yi) => (
              <tr key={yi}>
                <td className="sticky left-0 bg-white px-2 py-1 font-medium text-slate-600">{y}</td>
                {h.xLabels.map((_x, xi) => {
                  const v = cell.get(`${xi}|${yi}`) ?? 0;
                  return (
                    <td
                      key={xi} title={`${fmtDate(h.xKeys[xi])} ${y} — ${v} ${h.unit}`}
                      onClick={() => v > 0 && onDrill?.(drill?.kind ?? "heat", `${h.xKeys[xi]}|${h.yKeys[yi]}`)}
                      className={`px-1.5 py-1 text-center text-slate-700 ${v > 0 ? "cursor-pointer hover:ring-1 hover:ring-indigo-400" : ""}`}
                      style={{ backgroundColor: v > 0 ? `rgba(99,102,241,${0.12 + 0.6 * (v / max)})` : undefined }}
                    >{v > 0 ? v : ""}</td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  } else if (spec.kind === "donut") {
    const s = spec.series?.[0]; const key = s?.key ?? "count";
    body = (
      <ResponsiveContainer width="100%" height={230}>
        <RPie>
          <Pie data={data} dataKey={key} nameKey={spec.xKey ?? "label"} innerRadius={50} outerRadius={85} paddingAngle={2} onClick={(d) => click(d as unknown as Record<string, unknown>)} className={drill ? "cursor-pointer" : ""}>
            {data.map((_d, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
          </Pie>
          <Tooltip {...TOOLTIP} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
        </RPie>
      </ResponsiveContainer>
    );
  } else if (spec.kind === "hbar") {
    const s = spec.series?.[0]; const key = s?.key ?? "count";
    body = (
      <ResponsiveContainer width="100%" height={Math.max(180, data.length * 30 + 30)}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 10 }} />
          <YAxis type="category" dataKey={spec.xKey} width={150} tick={{ fontSize: 10 }} />
          <Tooltip {...TOOLTIP} formatter={(v: unknown) => fmtVal(v, s?.fmt ?? "int")} />
          <Bar dataKey={key} name={s?.label} fill={s?.color ?? "#6366f1"} radius={[0, 4, 4, 0]} onClick={(d) => click(d as unknown as Record<string, unknown>)} className={drill ? "cursor-pointer" : ""} />
        </BarChart>
      </ResponsiveContainer>
    );
  } else {
    body = (
      <ResponsiveContainer width="100%" height={250}>
        <ComposedChart data={data} margin={{ top: 8, right: hasRight ? 8 : 12, left: -12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey={spec.xKey} tickFormatter={xTick} tick={{ fontSize: 10 }} interval="preserveStartEnd" />
          <YAxis yAxisId="l" tick={{ fontSize: 10 }} />
          {hasRight && <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10 }} />}
          <Tooltip {...TOOLTIP} labelFormatter={(v) => (spec.xFmt === "date" ? fmtDate(String(v)) : String(v))} formatter={(v: unknown, name: string) => { const s = spec.series?.find((x) => x.label === name); return fmtVal(v, s?.fmt ?? "int"); }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {(spec.series ?? []).map((s) => s.type === "line"
            ? <Line key={s.key} yAxisId={s.axis === "right" ? "r" : "l"} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2.2} dot={{ r: 2.5 }} />
            : <Bar key={s.key} yAxisId={s.axis === "right" ? "r" : "l"} dataKey={s.key} name={s.label} fill={s.color} stackId={s.stackId} radius={s.stackId ? undefined : [3, 3, 0, 0]} onClick={(d) => click(d as unknown as Record<string, unknown>)} className={drill ? "cursor-pointer" : ""} />)}
        </ComposedChart>
      </ResponsiveContainer>
    );
  }
  return (
    <div className={spec.span === 2 ? "lg:col-span-2" : ""}>
      <SectionCard icon={LayoutGrid} title={spec.title} footnote={spec.footnote ?? (drill ? "Click a bar, segment or cell for the detail behind it." : undefined)}>
        {spec.subtitle && <p className="-mt-1 mb-2 text-[11px] text-slate-400">{spec.subtitle}</p>}
        {data.length === 0 && spec.kind !== "heatmap" ? <p className="py-10 text-center text-xs text-slate-400">No data in this range.</p> : body}
      </SectionCard>
    </div>
  );
}

/* ───────────────────────────── tables ───────────────────────────── */

export function DataTable({ spec, onRow }: { spec: TableSpec; onRow: (kind: string, key: string) => void }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(spec.defaultSort ?? null);
  const rows = useMemo(() => {
    let r = spec.rows;
    const s = q.trim().toLowerCase();
    if (s) r = r.filter((x) => spec.columns.some((c) => String(x[c.key] ?? "").toLowerCase().includes(s)));
    if (sort) {
      const dirn = sort.dir === "asc" ? 1 : -1;
      r = [...r].sort((a, b) => {
        const av = a[sort.key]; const bv = b[sort.key];
        if (av === null || av === undefined) return 1;
        if (bv === null || bv === undefined) return -1;
        return typeof av === "number" && typeof bv === "number" ? (av - bv) * dirn : String(av).localeCompare(String(bv)) * dirn;
      });
    }
    return r;
  }, [spec, q, sort]);
  const cellVal = (c: Column, v: unknown) => (c.fmt ? fmtVal(v, c.fmt) : v === null || v === undefined || v === "" ? "—" : String(v));
  return (
    <SectionCard icon={LayoutGrid} title={`${spec.title}${spec.rows.length > 0 ? ` (${spec.rows.length})` : ""}`} footnote={spec.footnote}>
      {spec.subtitle && <p className="-mt-1 mb-2 text-[11px] text-slate-400">{spec.subtitle}</p>}
      {spec.searchable && (
        <div className="relative mb-3 max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" aria-label={`Search ${spec.title}`} className="h-8 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-xs text-slate-700 focus:border-indigo-400 focus:outline-none" />
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border border-slate-100">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/80 text-[11px] uppercase tracking-wide text-slate-400">
              {spec.columns.map((c) => (
                <th key={c.key} title={c.hint} className={`whitespace-nowrap px-3 py-2.5 font-semibold ${c.align === "left" ? "text-left" : "text-right"}`}>
                  <button type="button" onClick={() => setSort((p) => (p?.key === c.key ? { key: c.key, dir: p.dir === "asc" ? "desc" : "asc" } : { key: c.key, dir: c.align === "left" ? "asc" : "desc" }))} className="inline-flex items-center gap-1 hover:text-slate-600">
                    {c.label}{sort?.key === c.key && <ArrowUpDown className="h-3 w-3" />}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} tabIndex={0} onClick={() => onRow(spec.drillKind, String(r[spec.keyField]))} onKeyDown={(e) => { if (e.key === "Enter") onRow(spec.drillKind, String(r[spec.keyField])); }}
                className={`cursor-pointer border-b border-slate-50 transition-colors last:border-0 hover:bg-indigo-50/50 focus:bg-indigo-50/50 focus:outline-none ${i % 2 === 1 ? "bg-slate-50/60" : "bg-white"}`}>
                {spec.columns.map((c) => <td key={c.key} className={`whitespace-nowrap px-3 py-2 ${c.align === "left" ? "text-left font-medium text-slate-700" : "text-right tabular-nums text-slate-600"}`}>{cellVal(c, r[c.key])}</td>)}
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={spec.columns.length} className="py-8 text-center text-slate-400">None in this range.</td></tr>}
          </tbody>
          {spec.totals && rows.length > 0 && !q && (
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold text-slate-700">
                {spec.columns.map((c) => <td key={c.key} className={`whitespace-nowrap px-3 py-2 ${c.align === "left" ? "text-left" : "text-right tabular-nums"}`}>{spec.totals![c.key] === undefined ? "" : cellVal(c, spec.totals![c.key])}</td>)}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </SectionCard>
  );
}

/* ───────────────────────────── slide-over ───────────────────────────── */

const BADGE = { green: "bg-emerald-100 text-emerald-700", amber: "bg-amber-100 text-amber-700", red: "bg-red-100 text-red-700", slate: "bg-slate-100 text-slate-600", blue: "bg-blue-100 text-blue-700" } as const;
const SECTION_LABEL = "text-xs font-bold uppercase tracking-wide text-slate-400";

function DetailBody({ d, onRecord }: { d: DetailPayload; onRecord: (type: string, id: number) => void }) {
  return (
    <div className="space-y-6 pb-8">
      {d.sections.map((s, i) => (
        <section key={i}>
          <p className={`${SECTION_LABEL} mb-2`}>{s.title}</p>
          {s.type === "kpis" && s.kpis && <KpiGrid kpis={s.kpis} />}
          {s.type === "kv" && s.kv && (
            <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
              {s.kv.map((r, n) => (
                <div key={n} className="flex items-start justify-between gap-3 border-b border-slate-50 py-1.5 text-xs">
                  <dt className="capitalize text-slate-500">{r.label}</dt>
                  <dd className="max-w-[60%] break-words text-right font-medium text-slate-800">{r.value === null || r.value === "" ? "None" : fmtVal(r.value, r.fmt)}</dd>
                </div>
              ))}
            </dl>
          )}
          {s.type === "text" && <p className="whitespace-pre-line rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">{s.text || "None"}</p>}
          {s.type === "chart" && s.chart && (s.chart.data?.length ?? 0) > 0 && <div className="rounded-xl border border-slate-100 p-2"><ChartCard spec={{ ...s.chart, title: s.chart.title }} /></div>}
          {s.type === "chart" && (!s.chart || (s.chart.data?.length ?? 0) === 0) && <p className="text-xs text-slate-400">None</p>}
          {s.type === "table" && s.table && (
            s.table.rows.length === 0 ? <p className="text-xs text-slate-400">{s.empty ?? "None"}</p> : (
              <div className="overflow-x-auto rounded-xl border border-slate-100">
                <table className="w-full border-collapse text-left text-xs">
                  <thead><tr className="border-b border-slate-100 bg-slate-50/80 text-[11px] uppercase tracking-wide text-slate-400">{s.table.columns.map((c) => <th key={c.key} className={`whitespace-nowrap px-3 py-2 font-semibold ${c.align === "left" ? "text-left" : "text-right"}`}>{c.label}</th>)}</tr></thead>
                  <tbody>
                    {s.table.rows.map((r, n) => {
                      const rt = s.table!.recordType; const kf = s.table!.keyField;
                      return (
                        <tr key={n} onClick={() => rt && kf && onRecord(rt, Number(r[kf]))} className={`border-b border-slate-50 last:border-0 ${rt ? "cursor-pointer hover:bg-indigo-50/50" : ""}`}>
                          {s.table!.columns.map((c) => <td key={c.key} className={`whitespace-nowrap px-3 py-1.5 ${c.align === "left" ? "text-left text-slate-700" : "text-right tabular-nums text-slate-600"}`}>{c.fmt ? fmtVal(r[c.key], c.fmt) : r[c.key] === null || r[c.key] === undefined || r[c.key] === "" ? "—" : String(r[c.key])}</td>)}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          )}
        </section>
      ))}
    </div>
  );
}

export interface DrillTarget { kind: string; key: string }

/** Right-hand slide-over: a summary/detail view (GET .../detail) with an optional single-record view on top of it. */
export function DetailDrawer({ lob, target, query, onClose }: { lob: string; target: DrillTarget | null; query: string; onClose: () => void }) {
  const [detail, setDetail] = useState<DetailPayload | null>(null);
  const [record, setRecord] = useState<{ type: string; id: number; data: DetailPayload | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    setLoading(true); setError(""); setDetail(null); setRecord(null);
    hrmsApi.get<{ success: boolean; data: DetailPayload }>(`/api/process-performance/clovia-lob/${lob}/detail?kind=${encodeURIComponent(target.kind)}&key=${encodeURIComponent(target.key)}&${query}`)
      .then((r) => { if (!cancelled) setDetail(r.data); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Unable to load the detail."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [lob, target, query]);
  const openRecord = (type: string, id: number) => {
    setRecord({ type, id, data: null });
    hrmsApi.get<{ success: boolean; data: DetailPayload }>(`/api/process-performance/clovia-record?type=${type}&id=${id}`)
      .then((r) => setRecord({ type, id, data: r.data })).catch(() => setRecord({ type, id, data: { title: "Record not available", sections: [] } }));
  };
  const shown = record ? record.data : detail;
  return (
    <Sheet open={target !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full max-w-2xl overflow-y-auto sm:max-w-2xl">
        <SheetHeader className="mb-4 text-left">
          {record && <button type="button" onClick={() => setRecord(null)} className="mb-1 inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:underline"><ChevronLeft className="h-3.5 w-3.5" />Back to summary</button>}
          <div className="flex flex-wrap items-center gap-2 pr-6">
            <SheetTitle className="text-base font-bold text-slate-800">{loading ? "Loading…" : shown?.title ?? "Detail"}</SheetTitle>
            {shown?.badge && <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${BADGE[shown.badge.tone]}`}>{shown.badge.label}</span>}
          </div>
          <SheetDescription className="text-xs">{shown?.subtitle ?? "Everything behind the number you clicked."}</SheetDescription>
        </SheetHeader>
        {error && <div className="rounded-xl border border-red-100 bg-red-50 p-3 text-xs text-red-700">{error}</div>}
        {loading && <div className="flex justify-center py-16"><div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-100 border-t-indigo-500" /></div>}
        {record && record.data === null && <div className="flex justify-center py-16"><div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-100 border-t-indigo-500" /></div>}
        {shown && <DetailBody d={shown} onRecord={openRecord} />}
      </SheetContent>
    </Sheet>
  );
}

/* ───────────────────────────── notes / coverage ───────────────────────────── */

export function NotesPanel({ notes, definitions, coverage }: { notes: string[]; definitions: Array<{ term: string; meaning: string }>; coverage: CoverageRow[] }) {
  return (
    <div className="space-y-4">
      {notes.length > 0 && (
        <SectionCard icon={Info} title="Data notes and omitted metrics" tone="amber">
          <ul className="list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-slate-600">{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </SectionCard>
      )}
      {definitions.length > 0 && (
        <SectionCard icon={Info} title="Definitions">
          <dl className="space-y-1.5 text-xs">{definitions.map((d) => <div key={d.term} className="flex gap-2"><dt className="w-40 shrink-0 font-semibold text-slate-700">{d.term}</dt><dd className="text-slate-600">{d.meaning}</dd></div>)}</dl>
        </SectionCard>
      )}
      {coverage.length > 0 && (
        <SectionCard icon={Inbox} title="Source coverage (whole table)">
          <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="text-[11px] uppercase text-slate-400"><th className="py-1.5 pr-3">Source</th><th className="py-1.5 pr-3">Table</th><th className="py-1.5 pr-3 text-right">Rows</th><th className="py-1.5 pr-3">Dates</th><th className="py-1.5">Note</th></tr></thead>
            <tbody>{coverage.map((c) => <tr key={c.table} className="border-t border-slate-50"><td className="py-1.5 pr-3 font-medium text-slate-700">{c.source}</td><td className="py-1.5 pr-3 text-slate-500">{c.table}</td><td className="py-1.5 pr-3 text-right tabular-nums">{c.rows.toLocaleString("en-IN")}</td><td className="py-1.5 pr-3 text-slate-600">{c.minDate ? `${fmtDate(c.minDate)} – ${fmtDate(c.maxDate ?? c.minDate)} (${c.days} days)` : "—"}</td><td className="py-1.5 text-slate-400">{c.note}</td></tr>)}</tbody></table></div>
        </SectionCard>
      )}
    </div>
  );
}

/* ───────────────────────────── export helpers ───────────────────────────── */

/** "Metric | Value | W-1 .. | 1-Sep .." tables from the server's per-period endpoint. */
export function periodExportTables(p: PeriodBreakdown | null): ExportTable[] {
  if (!p) return [];
  const head = p.columns.map((c) => c.label);
  return p.tables.map((t) => ({
    title: t.title,
    columns: [t.rowsLabel, "Value", ...head],
    rows: t.rows.map((r) => [r.label, fmtVal(r.value, r.fmt), ...p.columns.map((c) => fmtVal(r.cols[c.key] ?? 0, r.fmt))]),
  }));
}
/** A spec table as an export table (every column, every row). */
export function specTableExport(t: TableSpec): ExportTable {
  return { title: t.title, columns: t.columns.map((c) => c.label), rows: t.rows.map((r) => t.columns.map((c) => (c.fmt ? fmtVal(r[c.key], c.fmt) : r[c.key] === null || r[c.key] === undefined ? "" : String(r[c.key])))) };
}
