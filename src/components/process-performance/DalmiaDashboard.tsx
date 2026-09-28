import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ResponsiveContainer, ComposedChart, BarChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell, LabelList,
} from "recharts";
import {
  PhoneIncoming, PhoneCall, Users, Repeat, Percent, Headphones, PhoneMissed, Timer, ShieldCheck, Tag, Loader2, Info,
  MessageSquare, PhoneOutgoing, BarChart3, Layers, Target, Gauge, ClipboardList, Languages, TrendingUp, ListFilter,
} from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { PeriodSection, type PeriodWeek, type PeriodRow } from "./DashboardKit";
import { TOOLTIP_PROPS, fmtN, fmtDate, fmtShortDay } from "./lpCallShared";

/**
 * Dalmia Cement -- Inbound & Outbound Performance Dashboard (Process Performance V2 -> Dalmia).
 * Backend: GET /api/process-performance/dalmia-dashboard (dalmia-dashboard.service.ts / .calc.ts). Every figure follows the
 * formulas of the business's own "Dalmia MIS Dashboard" workbook; see dalmia-dashboard.calc.ts for each definition.
 */

const API = "/api/process-performance/dalmia-dashboard";

type BucketKey = "MTD" | "W-1" | "W-2" | "W-3" | "W-4" | "W-5";
interface InboundTotals {
  offered: number; answered: number; unique: number; repeat: number; abandoned: number; ansInThreshold: number; abnInThreshold: number;
  talkSec: number; dispoSec: number; tagged: number; repeatPct: number; alPct: number; abnPct: number; slPct: number; achtSec: number; taggingPct: number;
}
interface DayInbound extends InboundTotals { date: string }
interface LanguageRow { campaign: string; language: string; abandon: number; caller: number; total: number; answered: number; threshold: number; alPct: number; abnPct: number }
interface LanguageDay { date: string; campaign: string; total: number; answered: number; abandon: number; caller: number }
interface OutboundTotals { overall: number; unique: number; connected: number; conPct: number; uniquePct: number }
interface OutboundDay { date: string; overall: number; unique: number; connected: number }
type QrcRow = { Query: number; Complain: number; Request: number; total: number };
interface LeadSourceRow { source: string; dataReceived: number; connected: number; qualified: number }
interface LeadsSummary {
  sources: LeadSourceRow[]; total: { dataReceived: number; connected: number; qualified: number };
  byType: Array<{ type: string; count: number }>; status: { open: number; closed: number; converted: number; mt: number };
}
interface LeadDay { date: string; source: string; dataReceived: number; connected: number; qualified: number }
interface BucketInfo { key: BucketKey; label: string; from: string; to: string; days: number }
interface DalmiaData {
  month: string; from: string; to: string; buckets: BucketInfo[];
  inbound: { daily: DayInbound[]; byBucket: Record<BucketKey, InboundTotals> };
  languages: Record<BucketKey, LanguageRow[]>; languagesDaily: LanguageDay[];
  outbound: { byBucket: Record<BucketKey, OutboundTotals>; dispositions: Record<BucketKey, Array<{ name: string; count: number }>>; daily: OutboundDay[] };
  qrc: { daily: Array<{ date: string } & Record<"Query" | "Complain" | "Request", number>>; byBucket: Record<BucketKey, QrcRow> };
  leads: Record<BucketKey, LeadsSummary>; leadsDaily: LeadDay[];
  utilization: Record<BucketKey, number | null>;
  dataStatus: { inboundRows: number; ddRows: number; outboundRows: number; aprRows: number | null; notes: string[] };
}

const NAVY = "#0b1f4b";
const C = { navy: "#1e2a78", blue: "#3b82f6", sky: "#93c5fd", green: "#22c55e", amber: "#f59e0b", red: "#ef4444", violet: "#7c3aed", slate: "#94a3b8" };

const pct1 = (v: number): string => `${(Math.round(v * 1000) / 10).toFixed(1)}%`;
const pct0 = (v: number): string => `${Math.round(v * 100)}%`;
const hms = (sec: number): string => {
  const s = Math.round(sec);
  return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
const monthLabel = (ym: string): string => {
  const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1));
  return `${d.toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" })}'${String(d.getUTCFullYear()).slice(2)}`;
};
const pad2 = (n: number) => String(n).padStart(2, "0");
const localISO = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
function monthBounds(ym: string): { first: string; last: string } {
  const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7));
  return { first: `${ym}-01`, last: `${ym}-${pad2(new Date(y, m, 0).getDate())}` };
}
const recentMonths = (): string[] => {
  const now = new Date();
  return Array.from({ length: 12 }, (_, i) => { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; });
};
const weekOf = (iso: string): BucketKey => {
  const day = Number(iso.slice(8, 10));
  return (day <= 7 ? "W-1" : day <= 14 ? "W-2" : day <= 21 ? "W-3" : day <= 28 ? "W-4" : "W-5") as BucketKey;
};
const inView = (date: string, view: BucketKey) => view === "MTD" || weekOf(date) === view;

/* --------------------------------- shared bits --------------------------------- */

function Panel({ icon: Icon, title, action, children, className = "" }: { icon: typeof Layers; title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      <header className="flex items-center justify-between gap-2 px-3 py-2 text-white" style={{ background: NAVY }}>
        <p className="flex items-center gap-2 text-[13px] font-bold"><Icon className="h-4 w-4 opacity-90" />{title}</p>
        {action}
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}

/** "View Details" pill for a Panel header -- opens the same week-wise / date-wise drawer the KPI tiles use. */
function DetailsBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button" onClick={onClick}
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/30 bg-white/10 px-2.5 py-0.5 text-[10px] font-semibold text-white transition-colors hover:bg-white/25"
    >
      <ListFilter className="h-3 w-3" />View Details
    </button>
  );
}

function Kpi({ icon: Icon, label, value, caption, tone, onClick }: { icon: typeof Layers; label: string; value: string; caption?: string; tone: string; onClick?: () => void }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined} onClick={onClick}
      className={`flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-left shadow-sm ${onClick ? "cursor-pointer transition hover:-translate-y-0.5 hover:shadow-md" : ""}`}
    >
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white ${tone}`}><Icon className="h-4 w-4" /></span>
      <span className="min-w-0">
        <span className="block whitespace-nowrap text-lg font-extrabold leading-tight text-[#1e2a78]">{value}</span>
        <span className="block text-[10px] font-semibold leading-tight text-slate-600">{label}</span>
        {caption && <span className="block text-[10px] font-bold leading-tight text-emerald-600">{caption}</span>}
      </span>
    </Tag>
  );
}

const TH = "border border-slate-200 bg-[#1e3a6e] px-2 py-1 text-center text-[10px] font-bold text-white";
const TD = "border border-slate-200 px-2 py-1 text-center text-[11px] text-slate-700";

/* ------------------------------- drill-down drawer ------------------------------- */

interface DrawerColumn<T> { label: string; value: (rows: T[]) => number; fmt: (n: number) => string }
interface DrawerSpec<T extends { date: string }> { title: string; subtitle: string; rows: T[]; columns: Array<DrawerColumn<T>> }
type AnyDrawer = DrawerSpec<{ date: string }>;

/** Week-wise rows with their day rows, from per-date rows: each column is computed from the SUMS of the rows in the group. */
function buildWeeks<T extends { date: string }>(rows: T[], columns: Array<DrawerColumn<T>>): PeriodWeek[] {
  const toRow = (key: string, label: string, subset: T[]): PeriodRow => {
    const vals = columns.map((c) => c.value(subset));
    return { key, label, cells: vals.map((v, i) => columns[i].fmt(v)), raw: vals.map((v) => Math.round(v * 10000) / 10000) };
  };
  const byWeek = new Map<string, T[]>();
  for (const r of rows) byWeek.set(weekOf(r.date), [...(byWeek.get(weekOf(r.date)) ?? []), r]);
  return [...byWeek.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([wk, subset]) => ({
    ...toRow(wk, wk, subset),
    days: subset.map((r) => toRow(r.date, fmtShortDay(r.date), [r])),
  }));
}

function DetailDrawer({ spec, onClose }: { spec: AnyDrawer | null; onClose: () => void }) {
  const weeks = useMemo(() => (spec ? buildWeeks(spec.rows, spec.columns) : []), [spec]);
  return (
    <Sheet open={!!spec} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full max-w-2xl overflow-y-auto p-0 sm:max-w-2xl">
        <SheetHeader className="sticky top-0 z-10 border-b border-slate-100 bg-white px-5 py-4 text-left">
          <div className="flex flex-wrap items-center gap-2 pr-10">
            <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-700">Dalmia</span>
            <SheetTitle className="text-base font-bold text-slate-800">{spec?.title}</SheetTitle>
          </div>
          <SheetDescription className="text-[11px] text-slate-400">{spec?.subtitle} · week-wise and date-wise detail.</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-5 py-4">
          {spec && (
            <PeriodSection
              metricLabels={spec.columns.map((c) => c.label)} weeks={weeks} fileBase={`Dalmia_${spec.title}`} accentClass="text-indigo-700"
              leadSheets={[{ name: "Summary", columns: ["Item", "Value"], rows: [["Metric", spec.title], ["Period", spec.subtitle]] }]}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Several rows per date (one per language / lead source) -> one row per date, numeric fields summed. */
function collapseByDate<T extends { date: string }>(rows: T[]): T[] {
  const m = new Map<string, Record<string, unknown>>();
  for (const r of rows) {
    const cur = m.get(r.date);
    if (!cur) { m.set(r.date, { ...r }); continue; }
    for (const [k, v] of Object.entries(r)) if (typeof v === "number") cur[k] = (Number(cur[k]) || 0) + v;
  }
  return [...m.values()] as unknown as T[];
}

const sum = <T,>(rows: T[], pick: (r: T) => number): number => rows.reduce((n, r) => n + pick(r), 0);
const div = (a: number, b: number): number => (b > 0 ? a / b : 0);

/* ------------------------------------ page ------------------------------------ */

export function DalmiaDashboard() {
  const months = useMemo(recentMonths, []);
  const [month, setMonth] = useState(months[0]);
  const bounds = monthBounds(month);
  const today = localISO(new Date());
  const [from, setFrom] = useState(bounds.first);
  const [to, setTo] = useState(bounds.last > today ? today : bounds.last);
  const [view, setView] = useState<BucketKey>("MTD");
  const [data, setData] = useState<DalmiaData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [drawer, setDrawer] = useState<AnyDrawer | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: DalmiaData }>(`${API}?month=${month}&from=${from}&to=${to}`);
      setData(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load the Dalmia dashboard.");
    } finally { setLoading(false); }
  }, [month, from, to]);
  useEffect(() => { void load(); }, [load]);

  function pickMonth(m: string) {
    const b = monthBounds(m);
    setMonth(m); setFrom(b.first); setTo(b.last > today ? today : b.last); setView("MTD");
  }

  // The chosen view must exist in the loaded range (e.g. W-4 is absent for a range ending on the 20th).
  useEffect(() => { if (data && !data.buckets.some((b) => b.key === view)) setView("MTD"); }, [data, view]);

  if (!data) {
    return error
      ? <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      : <div className="flex justify-center py-24"><Loader2 className="h-7 w-7 animate-spin text-slate-400" /></div>;
  }

  const ib = data.inbound.byBucket[view];
  const mtd = data.inbound.byBucket.MTD;
  const w1 = data.inbound.byBucket["W-1"];
  const sub = (fmt: (t: InboundTotals) => string): string | undefined => (view === "MTD" ? (data.buckets.some((b) => b.key === "W-1") ? `W-1: ${fmt(w1)}` : undefined) : `MTD: ${fmt(mtd)}`);
  const days = data.inbound.daily.filter((d) => inView(d.date, view));
  const langs = data.languages[view];
  const langTotal = langs.reduce((a, r) => ({ abandon: a.abandon + r.abandon, caller: a.caller + r.caller, total: a.total + r.total, answered: a.answered + r.answered, threshold: a.threshold + r.threshold }), { abandon: 0, caller: 0, total: 0, answered: 0, threshold: 0 });
  const ob = data.outbound.byBucket[view];
  const dispositions = data.outbound.dispositions[view];
  const dispMax = Math.max(1, ...dispositions.map((d) => d.count));
  const qrc = data.qrc.byBucket[view];
  const leads = data.leads[view];
  const bucketList = data.buckets.filter((b) => b.key !== "W-5" || data.inbound.byBucket["W-5"].offered > 0);
  const weekBuckets = bucketList.filter((b) => b.key !== "MTD");
  const range = `${fmtDate(data.from)} – ${fmtDate(data.to)}`;

  /* ---- drawers (each row/tile opens its own date-wise + week-wise view) ---- */
  const inboundRows = data.inbound.daily.filter((d) => inView(d.date, "MTD"));
  const openInbound = (title: string, cols: Array<DrawerColumn<DayInbound>>) =>
    setDrawer({ title, subtitle: range, rows: inboundRows, columns: cols as Array<DrawerColumn<{ date: string }>> });
  const cOffered: DrawerColumn<DayInbound> = { label: "Offered", value: (r) => sum(r, (x) => x.offered), fmt: fmtN };
  const cAnswered: DrawerColumn<DayInbound> = { label: "Answered", value: (r) => sum(r, (x) => x.answered), fmt: fmtN };
  const cAbn: DrawerColumn<DayInbound> = { label: "Abandoned", value: (r) => sum(r, (x) => x.abandoned), fmt: fmtN };
  const cAl: DrawerColumn<DayInbound> = { label: "AL %", value: (r) => div(sum(r, (x) => x.answered), sum(r, (x) => x.offered)), fmt: pct1 };
  const cAbnPct: DrawerColumn<DayInbound> = { label: "Abn %", value: (r) => div(sum(r, (x) => x.abandoned), sum(r, (x) => x.offered)), fmt: pct1 };
  const cUnique: DrawerColumn<DayInbound> = { label: "Unique", value: (r) => sum(r, (x) => x.unique), fmt: fmtN };
  const cRepeat: DrawerColumn<DayInbound> = { label: "Repeat", value: (r) => sum(r, (x) => x.repeat), fmt: fmtN };
  const cRepeatPct: DrawerColumn<DayInbound> = { label: "Repeat %", value: (r) => div(sum(r, (x) => x.repeat), sum(r, (x) => x.unique + x.repeat)), fmt: pct1 };
  const cThr: DrawerColumn<DayInbound> = { label: "Ans in Threshold", value: (r) => sum(r, (x) => x.ansInThreshold), fmt: fmtN };
  const cAbnThr: DrawerColumn<DayInbound> = { label: "Abn in Threshold", value: (r) => sum(r, (x) => x.abnInThreshold), fmt: fmtN };
  const cSl: DrawerColumn<DayInbound> = { label: "SL %", value: (r) => div(sum(r, (x) => x.ansInThreshold), sum(r, (x) => x.offered - x.abnInThreshold)), fmt: pct1 };
  const cTalk: DrawerColumn<DayInbound> = { label: "Talk time", value: (r) => sum(r, (x) => x.talkSec), fmt: hms };
  const cDispo: DrawerColumn<DayInbound> = { label: "Dispo time", value: (r) => sum(r, (x) => x.dispoSec), fmt: hms };
  const cAcht: DrawerColumn<DayInbound> = { label: "ACHT", value: (r) => div(sum(r, (x) => x.talkSec + x.dispoSec), sum(r, (x) => x.answered)), fmt: hms };
  const cTag: DrawerColumn<DayInbound> = { label: "Tagging", value: (r) => sum(r, (x) => x.tagged), fmt: fmtN };
  const cTagPct: DrawerColumn<DayInbound> = { label: "Tagging %", value: (r) => div(sum(r, (x) => x.tagged), sum(r, (x) => x.answered)), fmt: pct1 };

  const openLanguage = (campaign: string, language: string) => {
    const rows = data.languagesDaily.filter((d) => d.campaign === campaign);
    const cols: Array<DrawerColumn<LanguageDay>> = [
      { label: "Offered", value: (r) => sum(r, (x) => x.total), fmt: fmtN }, { label: "Answered", value: (r) => sum(r, (x) => x.answered), fmt: fmtN },
      { label: "Abandon", value: (r) => sum(r, (x) => x.abandon), fmt: fmtN }, { label: "Caller", value: (r) => sum(r, (x) => x.caller), fmt: fmtN },
      { label: "AL %", value: (r) => div(sum(r, (x) => x.answered), sum(r, (x) => x.total)), fmt: pct1 },
      { label: "Abn %", value: (r) => div(sum(r, (x) => x.abandon), sum(r, (x) => x.total)), fmt: pct1 },
    ];
    setDrawer({ title: `${language} (${campaign})`, subtitle: range, rows, columns: cols as Array<DrawerColumn<{ date: string }>> });
  };
  const openLanguageAll = (title: string) => {
    const cols: Array<DrawerColumn<LanguageDay>> = [
      { label: "Offered", value: (r) => sum(r, (x) => x.total), fmt: fmtN }, { label: "Answered", value: (r) => sum(r, (x) => x.answered), fmt: fmtN },
      { label: "Abandon", value: (r) => sum(r, (x) => x.abandon), fmt: fmtN }, { label: "Caller", value: (r) => sum(r, (x) => x.caller), fmt: fmtN },
      { label: "AL %", value: (r) => div(sum(r, (x) => x.answered), sum(r, (x) => x.total)), fmt: pct1 },
      { label: "Abn %", value: (r) => div(sum(r, (x) => x.abandon), sum(r, (x) => x.total)), fmt: pct1 },
    ];
    setDrawer({ title, subtitle: range, rows: collapseByDate(data.languagesDaily), columns: cols as Array<DrawerColumn<{ date: string }>> });
  };
  const openOutbound = (title: string) => {
    const cols: Array<DrawerColumn<OutboundDay>> = [
      { label: "Overall calls", value: (r) => sum(r, (x) => x.overall), fmt: fmtN }, { label: "Unique calls", value: (r) => sum(r, (x) => x.unique), fmt: fmtN },
      { label: "Connected", value: (r) => sum(r, (x) => x.connected), fmt: fmtN },
      { label: "Connect %", value: (r) => div(sum(r, (x) => x.connected), sum(r, (x) => x.overall)), fmt: pct1 },
    ];
    setDrawer({ title, subtitle: range, rows: data.outbound.daily, columns: cols as Array<DrawerColumn<{ date: string }>> });
  };
  const openQrc = (title: string) => {
    const cols: Array<DrawerColumn<(typeof data.qrc.daily)[number]>> = [
      { label: "Query", value: (r) => sum(r, (x) => x.Query), fmt: fmtN }, { label: "Request", value: (r) => sum(r, (x) => x.Request), fmt: fmtN },
      { label: "Complaint", value: (r) => sum(r, (x) => x.Complain), fmt: fmtN },
      { label: "Total QRC", value: (r) => sum(r, (x) => x.Query + x.Request + x.Complain), fmt: fmtN },
    ];
    setDrawer({ title, subtitle: range, rows: data.qrc.daily, columns: cols as Array<DrawerColumn<{ date: string }>> });
  };
  const openLeadSource = (source: string | null) => {
    const rows = source ? data.leadsDaily.filter((d) => d.source === source) : collapseByDate(data.leadsDaily);
    const cols: Array<DrawerColumn<LeadDay>> = [
      { label: "Data received", value: (r) => sum(r, (x) => x.dataReceived), fmt: fmtN }, { label: "Connected", value: (r) => sum(r, (x) => x.connected), fmt: fmtN },
      { label: "Qualified leads", value: (r) => sum(r, (x) => x.qualified), fmt: fmtN },
    ];
    setDrawer({ title: source ? `Leads — ${source}` : "Leads — all sources", subtitle: range, rows, columns: cols as Array<DrawerColumn<{ date: string }>> });
  };

  const trend = days.map((d) => ({ date: d.date, offered: d.offered, answered: d.answered, al: Math.round(d.alPct * 1000) / 10, sl: Math.round(d.slPct * 1000) / 10 }));
  const weekly = bucketList.filter((b) => b.key === "MTD" || weekBuckets.some((w) => w.key === b.key)).map((b) => {
    const t = data.inbound.byBucket[b.key];
    return { name: b.label, Offered: t.offered, Answered: t.answered, Unique: t.unique, Repeat: t.repeat };
  });
  const weeklyKeyCols = bucketList.slice(0, 6);
  const langBars = langs.map((l) => ({ name: l.language, pct: Math.round(l.alPct * 100) }));
  const langChart = langs.map((l) => ({ name: l.language, "Call Offered": l.total, "Call Answered": l.answered }));
  const qrcDonut = [{ name: "Query", value: qrc.Query, color: C.blue }, { name: "Request", value: qrc.Request, color: C.amber }, { name: "Complaint", value: qrc.Complain, color: C.red }];
  const qrcTrend = bucketList.map((b) => ({ name: b.label, Query: data.qrc.byBucket[b.key].Query, Request: data.qrc.byBucket[b.key].Request, Complaint: data.qrc.byBucket[b.key].Complain }));
  const util = data.utilization[view];

  return (
    <div className="space-y-3 rounded-2xl bg-[#fbf8ee] p-2 sm:p-3">
      {/* ------------------------------ header ------------------------------ */}
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3 text-white shadow" style={{ background: `linear-gradient(90deg, ${NAVY}, #12306b 55%, ${NAVY})` }}>
        <div className="flex items-center gap-3">
          <div className="leading-none"><p className="text-2xl font-black tracking-tight">Dalmia</p><p className="text-[10px] font-semibold text-sky-200">Bharat Cement</p></div>
          <div>
            <h2 className="text-lg font-extrabold sm:text-xl">Dalmia – Inbound &amp; Outbound Performance Dashboard</h2>
            <p className="text-xs text-sky-100">Calls | Tickets | QRC | Leads | Agent Performance</p>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2 text-[10px] font-semibold text-sky-200">
          <label className="rounded-lg border border-white/20 bg-white/5 px-2 py-1 text-sky-200">Date Range
            <span className="mt-0.5 flex items-center gap-1 text-white">
              <input type="date" value={from} min={bounds.first} max={bounds.last} onChange={(e) => setFrom(e.target.value || bounds.first)} className="w-[112px] bg-transparent text-xs font-bold outline-none [color-scheme:dark]" />
              –
              <input type="date" value={to} min={bounds.first} max={bounds.last} onChange={(e) => setTo(e.target.value || bounds.last)} className="w-[112px] bg-transparent text-xs font-bold outline-none [color-scheme:dark]" />
            </span>
          </label>
          <label className="rounded-lg border border-white/20 bg-white/5 px-2 py-1 text-sky-200">Month
            <select value={month} onChange={(e) => pickMonth(e.target.value)} className="mt-0.5 block bg-transparent text-xs font-bold text-white outline-none">
              {months.map((m) => <option key={m} value={m} className="text-slate-900">{monthLabel(m)}</option>)}
            </select>
          </label>
          <label className="rounded-lg border border-white/20 bg-white/5 px-2 py-1 text-sky-200">Process
            <select value="Dalmia" disabled className="mt-0.5 block bg-transparent text-xs font-bold text-white outline-none"><option className="text-slate-900">Dalmia</option></select>
          </label>
          <div className="rounded-lg border border-white/20 bg-white/5 px-2 py-1 text-sky-200">View
            <div className="mt-0.5 flex gap-1">
              {(["MTD", "W-1", "W-2", "W-3", "W-4", "W-5"] as BucketKey[]).filter((k) => data.buckets.some((b) => b.key === k)).map((k) => (
                <button key={k} type="button" onClick={() => setView(k)} className={`rounded px-2 py-0.5 text-[11px] font-bold transition ${view === k ? "bg-white text-[#0b1f4b]" : "text-white hover:bg-white/15"}`}>{k}</button>
              ))}
            </div>
          </div>
        </div>
      </header>

      {loading && <p className="text-right text-[11px] text-slate-400">Refreshing…</p>}
      {error && <div className="rounded-xl border border-red-100 bg-red-50 p-3 text-xs text-red-700">{error}</div>}
      {data.dataStatus.notes.length > 0 && (
        <div className="space-y-1 rounded-xl border border-sky-100 bg-sky-50 p-3 text-[11px] font-medium text-sky-800">
          {data.dataStatus.notes.map((n) => <p key={n} className="flex items-start gap-2"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />{n}</p>)}
        </div>
      )}

      {/* ------------------------------ KPI strip ------------------------------ */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6 min-[1900px]:grid-cols-12">
        <Kpi icon={PhoneIncoming} label="Call Offered" value={fmtN(ib.offered)} caption={sub((t) => fmtN(t.offered))} tone="bg-blue-600" onClick={() => openInbound("Call Offered", [cOffered, cAnswered, cAl, cAbn, cAbnPct])} />
        <Kpi icon={PhoneCall} label="Call Answered" value={fmtN(ib.answered)} caption={sub((t) => fmtN(t.answered))} tone="bg-emerald-500" onClick={() => openInbound("Call Answered", [cOffered, cAnswered, cAl])} />
        <Kpi icon={Users} label="Unique Calls" value={fmtN(ib.unique)} caption={sub((t) => fmtN(t.unique))} tone="bg-indigo-500" onClick={() => openInbound("Unique Calls", [cUnique, cRepeat, cRepeatPct])} />
        <Kpi icon={Repeat} label="Repeat Calls" value={fmtN(ib.repeat)} caption={sub((t) => fmtN(t.repeat))} tone="bg-rose-500" onClick={() => openInbound("Repeat Calls", [cUnique, cRepeat, cRepeatPct])} />
        <Kpi icon={Percent} label="Repeat %" value={pct1(ib.repeatPct)} caption={sub((t) => pct1(t.repeatPct))} tone="bg-amber-500" onClick={() => openInbound("Repeat %", [cUnique, cRepeat, cRepeatPct])} />
        <Kpi icon={Headphones} label="Answer Level (AL)" value={pct1(ib.alPct)} caption={sub((t) => pct1(t.alPct))} tone="bg-emerald-600" onClick={() => openInbound("Answer Level (AL)", [cOffered, cAnswered, cAl])} />
        <Kpi icon={PhoneMissed} label="Abandoned Calls" value={fmtN(ib.abandoned)} caption={sub((t) => fmtN(t.abandoned))} tone="bg-red-500" onClick={() => openInbound("Abandoned Calls", [cOffered, cAbn, cAbnPct])} />
        <Kpi icon={Percent} label="Abandon %" value={pct1(ib.abnPct)} caption={sub((t) => pct1(t.abnPct))} tone="bg-rose-600" onClick={() => openInbound("Abandon %", [cOffered, cAbn, cAbnPct])} />
        <Kpi icon={Timer} label="Ans in Threshold" value={fmtN(ib.ansInThreshold)} caption={sub((t) => fmtN(t.ansInThreshold))} tone="bg-blue-500" onClick={() => openInbound("Answered in Threshold", [cThr, cAbnThr, cSl])} />
        <Kpi icon={ShieldCheck} label="Service Level" value={pct1(ib.slPct)} caption={sub((t) => pct1(t.slPct))} tone="bg-green-600" onClick={() => openInbound("Service Level", [cThr, cAbnThr, cSl])} />
        <Kpi icon={Timer} label="ACHT" value={hms(ib.achtSec)} caption={sub((t) => hms(t.achtSec))} tone="bg-violet-600" onClick={() => openInbound("ACHT", [cTalk, cDispo, cAnswered, cAcht])} />
        <Kpi icon={Tag} label="Tagging %" value={pct1(ib.taggingPct)} caption={sub((t) => pct1(t.taggingPct))} tone="bg-amber-600" onClick={() => openInbound("Tagging %", [cTag, cAnswered, cTagPct])} />
      </div>

      {/* ------------------------- funnel / trend / weekly ------------------------- */}
      <div className="grid gap-3 lg:grid-cols-[1fr_1.35fr_1.35fr]">
        <Panel icon={PhoneIncoming} title={`Inbound Call Funnel (${view})`} action={<DetailsBtn onClick={() => openInbound("Inbound Call Funnel", [cOffered, cAnswered, cThr, cAbn, cAbnThr, cAl, cSl])} />}>
          <div className="space-y-2 text-xs">
            {[
              { label: "Call Offered", v: ib.offered, p: 1, bg: "bg-[#1e2a78]" },
              { label: "Call Answered", v: ib.answered, p: ib.alPct, bg: "bg-[#3b82f6]" },
              { label: "Answered in Threshold", v: ib.ansInThreshold, p: div(ib.ansInThreshold, ib.offered), bg: "bg-[#22c55e]" },
            ].map((s) => (
              <div key={s.label} className="flex items-center gap-2">
                <span className="w-32 shrink-0 font-semibold text-slate-700">{s.label}</span>
                <div className="flex-1"><div className={`${s.bg} mx-auto rounded py-1 text-center font-bold text-white`} style={{ width: `${Math.max(28, s.p * 100)}%` }}>{fmtN(s.v)}</div></div>
                <span className="w-12 shrink-0 text-right font-semibold text-slate-500">{pct1(s.p)}</span>
              </div>
            ))}
            <div className="mt-2 grid grid-cols-2 gap-2 pt-1">
              <button type="button" onClick={() => openInbound("Abandoned Calls", [cOffered, cAbn, cAbnPct])} className="rounded-lg border border-rose-100 bg-rose-50 p-2 text-center">
                <p className="text-[10px] font-semibold text-rose-700">Abandoned Calls</p><p className="text-2xl font-extrabold text-rose-600">{fmtN(ib.abandoned)}</p><p className="text-[10px] font-bold text-rose-500">{pct1(ib.abnPct)}</p>
              </button>
              <button type="button" onClick={() => openInbound("Abandon within Threshold", [cAbnThr, cOffered])} className="rounded-lg border border-amber-100 bg-amber-50 p-2 text-center">
                <p className="text-[10px] font-semibold text-amber-700">Abn within Threshold</p><p className="text-2xl font-extrabold text-amber-600">{fmtN(ib.abnInThreshold)}</p><p className="text-[10px] font-bold text-amber-600">{pct1(div(ib.abnInThreshold, ib.offered))}</p>
              </button>
            </div>
          </div>
        </Panel>

        <Panel icon={TrendingUp} title={`Inbound Trend & SLA (${monthLabel(month)})`} action={<DetailsBtn onClick={() => openInbound("Inbound Trend & SLA", [cOffered, cAnswered, cThr, cAbn, cAbnThr, cAl, cSl])} />}>
          <ResponsiveContainer width="100%" height={250}>
            <ComposedChart data={trend} margin={{ top: 6, right: 4, left: -14, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              <XAxis dataKey="date" tickFormatter={fmtShortDay} tick={{ fontSize: 9 }} interval="preserveStartEnd" />
              <YAxis yAxisId="l" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="r" orientation="right" domain={[0, 120]} tick={{ fontSize: 10 }} tickFormatter={(v: number) => `${v}%`} />
              <Tooltip {...TOOLTIP_PROPS} labelFormatter={(v) => fmtDate(String(v))} />
              <Legend wrapperStyle={{ fontSize: 10 }} iconType="circle" />
              <Bar yAxisId="l" dataKey="offered" name="Call Offered" fill={C.sky} />
              <Bar yAxisId="l" dataKey="answered" name="Call Answered" fill={C.navy} />
              <Line yAxisId="r" type="monotone" dataKey="al" name="AL %" stroke={C.green} strokeWidth={2} dot={{ r: 2 }} />
              <Line yAxisId="r" type="monotone" dataKey="sl" name="SL %" stroke={C.amber} strokeWidth={2} dot={{ r: 2 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </Panel>

        <Panel icon={BarChart3} title="Weekly Performance (Inbound)" action={<DetailsBtn onClick={() => openInbound("Weekly Performance (Inbound)", [cOffered, cAnswered, cUnique, cRepeat, cRepeatPct, cAl, cAbnPct, cSl, cTagPct])} />}>
          <div className="space-y-2">
            <ResponsiveContainer width="100%" height={230}>
              <BarChart data={weekly} margin={{ top: 14, right: 4, left: -14, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip {...TOOLTIP_PROPS} />
                <Legend wrapperStyle={{ fontSize: 10 }} iconType="square" />
                <Bar dataKey="Offered" fill={C.sky}><LabelList dataKey="Offered" position="top" fontSize={8} /></Bar>
                <Bar dataKey="Answered" fill={C.navy} />
                <Bar dataKey="Unique" fill={C.green} />
                <Bar dataKey="Repeat" fill={C.red} />
              </BarChart>
            </ResponsiveContainer>
            <div className="overflow-x-auto">
              <p className="mb-1 rounded bg-[#1e3a6e] px-2 py-0.5 text-[10px] font-bold text-white">Weekly Key Metrics</p>
              <table className="w-full border-collapse">
                <thead><tr><th className={TH} />{weeklyKeyCols.map((b) => <th key={b.key} className={TH}>{b.label}</th>)}</tr></thead>
                <tbody>
                  {([
                    ["Repeat %", (t: InboundTotals) => pct1(t.repeatPct)], ["AL %", (t: InboundTotals) => pct1(t.alPct)],
                    ["Abn %", (t: InboundTotals) => pct1(t.abnPct)], ["SL %", (t: InboundTotals) => pct1(t.slPct)],
                    ["Tagging %", (t: InboundTotals) => pct0(t.taggingPct)],
                  ] as Array<[string, (t: InboundTotals) => string]>).map(([label, fmt]) => (
                    <tr key={label}><td className={`${TD} bg-slate-50 text-left font-bold`}>{label}</td>{weeklyKeyCols.map((b) => <td key={b.key} className={TD}>{fmt(data.inbound.byBucket[b.key])}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Panel>
      </div>

      {/* ------------------------------ language ------------------------------ */}
      <div className="grid gap-3 lg:grid-cols-[1.25fr_1fr]">
        <Panel icon={Languages} title={`Language Wise Performance (${view})`} action={<DetailsBtn onClick={() => openLanguageAll("Language Wise Performance")} />}>
          <div className="grid gap-3 xl:grid-cols-[1.5fr_1fr]">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead><tr>{["Language", "Abandon", "Caller", "Grand Total", "Answered", "AL %", "Threshold", "Abn %"].map((h) => <th key={h} className={TH}>{h}</th>)}</tr></thead>
                <tbody>
                  {langs.map((l) => (
                    <tr key={l.campaign} onClick={() => openLanguage(l.campaign, l.language)} className="cursor-pointer hover:bg-sky-50">
                      <td className={`${TD} text-left font-semibold`}>{l.language}</td><td className={TD}>{l.abandon}</td><td className={TD}>{l.caller}</td>
                      <td className={`${TD} font-bold`}>{l.total}</td><td className={TD}>{l.answered}</td>
                      <td className={`${TD} font-bold ${l.alPct >= 0.95 ? "bg-emerald-100 text-emerald-800" : l.alPct >= 0.85 ? "bg-lime-100 text-lime-800" : "bg-amber-100 text-amber-800"}`}>{pct0(l.alPct)}</td>
                      <td className={TD}>{l.threshold}</td><td className={TD}>{pct0(l.abnPct)}</td>
                    </tr>
                  ))}
                  <tr className="bg-sky-100 font-bold">
                    <td className={`${TD} text-left`}>Total</td><td className={TD}>{langTotal.abandon}</td><td className={TD}>{langTotal.caller}</td><td className={TD}>{langTotal.total}</td>
                    <td className={TD}>{langTotal.answered}</td><td className={TD}>{pct0(div(langTotal.answered, langTotal.total))}</td><td className={TD}>{langTotal.threshold}</td><td className={TD}>{pct0(div(langTotal.abandon, langTotal.total))}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div>
              <p className="mb-1 text-xs font-bold text-slate-700">Answer % by Language</p>
              <div className="space-y-1">
                {langBars.map((b) => (
                  <div key={b.name} className="flex items-center gap-2 text-[11px]">
                    <span className="w-16 shrink-0 text-right font-semibold text-slate-600">{b.name}</span>
                    <div className="h-3.5 flex-1 rounded bg-slate-100"><div className="h-full rounded bg-[#3b82f6]" style={{ width: `${b.pct}%` }} /></div>
                    <span className="w-9 shrink-0 font-bold text-slate-700">{b.pct}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Panel>

        <Panel icon={Languages} title={`Call Offer vs Call Answer by Language (${view})`} action={<DetailsBtn onClick={() => openLanguageAll("Call Offer vs Call Answer by Language")} />}>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={langChart} margin={{ top: 14, right: 4, left: -14, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 9 }} interval={0} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip {...TOOLTIP_PROPS} />
              <Legend wrapperStyle={{ fontSize: 10 }} iconType="square" />
              <Bar dataKey="Call Offered" fill={C.sky}><LabelList dataKey="Call Offered" position="top" fontSize={8} /></Bar>
              <Bar dataKey="Call Answered" fill={C.navy}><LabelList dataKey="Call Answered" position="top" fontSize={8} /></Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      {/* --------------------- outbound / QRC / leads --------------------- */}
      <div className="grid gap-3 lg:grid-cols-[1.25fr_0.9fr_1.15fr]">
        <Panel icon={PhoneOutgoing} title="Outbound Performance" action={<DetailsBtn onClick={() => openOutbound("Outbound Performance")} />}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Kpi icon={PhoneOutgoing} label="Overall Calls" value={fmtN(ob.overall)} tone="bg-blue-600" onClick={() => openOutbound("Outbound — overall calls")} />
            <Kpi icon={Users} label="Unique Calls" value={fmtN(ob.unique)} tone="bg-indigo-500" onClick={() => openOutbound("Outbound — unique calls")} />
            <Kpi icon={PhoneCall} label="Connected" value={fmtN(ob.connected)} tone="bg-rose-500" onClick={() => openOutbound("Outbound — connected calls")} />
            <Kpi icon={Percent} label="Overall Connect %" value={pct0(ob.conPct)} tone="bg-amber-500" onClick={() => openOutbound("Outbound — connect %")} />
            <Kpi icon={Users} label="Unique Calls %" value={pct0(ob.uniquePct)} tone="bg-violet-600" onClick={() => openOutbound("Outbound — unique calls %")} />
          </div>
          <div className="mt-3 space-y-3">
            <div className="space-y-1.5 text-xs">
              <p className="font-bold text-slate-700">Outbound Funnel</p>
              {[{ l: "Overall Calls", v: ob.overall, p: 1, bg: "bg-[#1e2a78]" }, { l: "Unique Calls", v: ob.unique, p: ob.uniquePct, bg: "bg-[#3b82f6]" }, { l: "Connected Calls", v: ob.connected, p: ob.conPct, bg: "bg-[#22c55e]" }].map((s) => (
                <div key={s.l}>
                  <div className="flex items-center gap-2"><span className="w-24 shrink-0 font-semibold text-slate-600">{s.l}</span><div className="flex-1"><div className={`${s.bg} mx-auto rounded py-1 text-center font-bold text-white`} style={{ width: `${Math.max(30, s.p * 100)}%` }}>{fmtN(s.v)}</div></div><span className="w-10 shrink-0 text-right font-semibold text-slate-500">{pct0(s.p)}</span></div>
                </div>
              ))}
            </div>
            <div>
              <p className="mb-1 text-xs font-bold text-slate-700">Connected Disposition ({view})</p>
              <div className="space-y-1">
                {dispositions.map((d) => (
                  <div key={d.name} className="flex items-center gap-2 text-[10px]">
                    <span className="w-40 shrink-0 truncate text-slate-600" title={d.name}>{d.name}</span>
                    <div className="h-2.5 flex-1 rounded bg-slate-100"><div className="h-full rounded bg-[#3b6fd8]" style={{ width: `${(d.count / dispMax) * 100}%` }} /></div>
                    <span className="w-7 shrink-0 text-right font-bold text-slate-700">{d.count}</span>
                  </div>
                ))}
                <p className="pt-0.5 text-right text-[10px] font-bold text-slate-500">Total {fmtN(dispositions.reduce((n, d) => n + d.count, 0))}</p>
              </div>
            </div>
          </div>
        </Panel>

        <Panel icon={ClipboardList} title="QRC Mix" action={<DetailsBtn onClick={() => openQrc("QRC Mix")} />}>
          <div className="grid grid-cols-5 gap-1.5 text-center">
            <button type="button" onClick={() => openQrc("QRC volume")} className="rounded-lg border border-slate-200 bg-slate-50 px-1 py-1"><p className="text-lg font-extrabold text-[#1e2a78]">{fmtN(qrc.total)}</p><p className="text-[9px] font-semibold text-slate-500">Total QRC</p></button>
            {["W-1", "W-2", "W-3", "W-4"].map((k) => (
              <button key={k} type="button" onClick={() => openQrc("QRC volume")} className="rounded-lg border border-slate-200 bg-slate-50 px-1 py-1"><p className="text-lg font-extrabold text-[#1e2a78]">{fmtN(data.qrc.byBucket[k as BucketKey].total)}</p><p className="text-[9px] font-semibold text-slate-500">{k}</p></button>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <div className="relative h-[150px] w-[150px] shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart><Pie data={qrcDonut} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="92%" paddingAngle={2} stroke="none">{qrcDonut.map((s) => <Cell key={s.name} fill={s.color} />)}</Pie><Tooltip {...TOOLTIP_PROPS} itemStyle={{ color: "#f1f5f9" }} /></PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><span className="text-lg font-extrabold text-slate-800">{fmtN(qrc.total)}</span><span className="text-[9px] font-semibold text-slate-400">Total</span></div>
            </div>
            <ul className="space-y-1 text-xs">
              {qrcDonut.map((s) => (
                <li key={s.name} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} /><span className="font-semibold text-slate-600">{s.name}</span><span className="font-bold text-slate-800">{fmtN(s.value)}</span><span className="text-slate-400">({pct1(div(s.value, qrc.total))})</span></li>
              ))}
            </ul>
          </div>
          <p className="mt-1 text-[11px] font-bold text-slate-700">QRC Trend</p>
          <ResponsiveContainer width="100%" height={110}>
            <BarChart data={qrcTrend} margin={{ top: 10, right: 4, left: -22, bottom: 0 }}>
              <XAxis dataKey="name" tick={{ fontSize: 9 }} /><YAxis tick={{ fontSize: 9 }} />
              <Tooltip {...TOOLTIP_PROPS} />
              <Bar dataKey="Query" fill={C.blue}><LabelList dataKey="Query" position="top" fontSize={7} /></Bar>
              <Bar dataKey="Request" fill={C.amber}><LabelList dataKey="Request" position="top" fontSize={7} /></Bar>
              <Bar dataKey="Complaint" fill={C.red}><LabelList dataKey="Complaint" position="top" fontSize={7} /></Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        <Panel icon={Target} title={`Lead Source & Qualification (${view})`} action={<DetailsBtn onClick={() => openLeadSource(null)} />}>
          <div className="space-y-2">
            <table className="w-full border-collapse">
              <thead><tr>{["Source", "Data Received", "Connected", "Qualified Leads"].map((h) => <th key={h} className={TH}>{h}</th>)}</tr></thead>
              <tbody>
                {leads.sources.map((s) => (
                  <tr key={s.source} onClick={() => openLeadSource(s.source)} className="cursor-pointer hover:bg-sky-50">
                    <td className={`${TD} text-left font-semibold`}>{s.source}</td><td className={TD}>{fmtN(s.dataReceived)}</td><td className={TD}>{fmtN(s.connected)}</td><td className={TD}>{fmtN(s.qualified)}</td>
                  </tr>
                ))}
                <tr onClick={() => openLeadSource(null)} className="cursor-pointer bg-sky-100 font-bold hover:bg-sky-200">
                  <td className={`${TD} text-left`}>Total</td><td className={TD}>{fmtN(leads.total.dataReceived)}</td><td className={TD}>{fmtN(leads.total.connected)}</td><td className={TD}>{fmtN(leads.total.qualified)}</td>
                </tr>
              </tbody>
            </table>
            <div className="space-y-1.5 text-xs">
              <p className="font-bold text-slate-700">Lead Conversion Funnel</p>
              {[{ l: "Data Received", v: leads.total.dataReceived, bg: "bg-[#1e2a78]", p: 1 }, { l: "Connected", v: leads.total.connected, bg: "bg-[#3b82f6]", p: div(leads.total.connected, leads.total.dataReceived) }, { l: "Qualified Leads", v: leads.total.qualified, bg: "bg-[#22c55e]", p: div(leads.total.qualified, leads.total.dataReceived) }].map((s) => (
                <div key={s.l} className="flex items-center gap-2"><span className="w-20 shrink-0 text-[10px] font-semibold text-slate-600">{s.l}</span><div className="flex-1"><div className={`${s.bg} mx-auto rounded py-1 text-center font-bold text-white`} style={{ width: `${Math.max(30, s.p * 100)}%` }}>{fmtN(s.v)}</div></div></div>
              ))}
            </div>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div>
              <p className="mb-1 rounded bg-[#1e3a6e] px-2 py-0.5 text-[10px] font-bold text-white">Leads by Type ({view})</p>
              <table className="w-full border-collapse"><thead><tr><th className={TH}>Type of Leads</th><th className={TH}>Count</th></tr></thead>
                <tbody>{leads.byType.map((t) => <tr key={t.type}><td className={`${TD} text-left font-semibold`}>{t.type}</td><td className={TD}>{fmtN(t.count)}</td></tr>)}</tbody></table>
            </div>
            <div>
              <p className="mb-1 rounded bg-[#1e3a6e] px-2 py-0.5 text-[10px] font-bold text-white">Ticket Status ({view})</p>
              <table className="w-full border-collapse"><thead><tr><th className={TH}>Status</th><th className={TH}>Count</th></tr></thead>
                <tbody>{([["Open", leads.status.open], ["Close", leads.status.closed], ["Converted", leads.status.converted], ["MT", leads.status.mt]] as Array<[string, number]>).map(([l, v]) => <tr key={l}><td className={`${TD} text-left font-semibold`}>{l}</td><td className={TD}>{fmtN(v)}</td></tr>)}</tbody></table>
            </div>
          </div>
        </Panel>
      </div>

      {/* --------------------------- management snapshot --------------------------- */}
      <div className="rounded-xl p-2 text-white shadow" style={{ background: NAVY }}>
        <div className="grid gap-2 sm:grid-cols-[150px_1fr]">
          <div className="flex items-center justify-center rounded-lg bg-white/10 px-2 py-2 text-center text-sm font-extrabold">Management Snapshot ({view})</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
            {([
              [Gauge, "Answer Level (AL)", pct1(ib.alPct), sub((t) => pct1(t.alPct))],
              [ShieldCheck, "Service Level", pct1(ib.slPct), sub((t) => pct1(t.slPct))],
              [PhoneMissed, "Abandon %", pct1(ib.abnPct), sub((t) => pct1(t.abnPct))],
              [Tag, "Tagging %", pct0(ib.taggingPct), sub((t) => pct0(t.taggingPct))],
              [PhoneOutgoing, "Outbound Connect %", pct0(ob.conPct), undefined],
              [MessageSquare, "QRC Volume", fmtN(qrc.total), undefined],
              [Target, "Qualified Leads", fmtN(leads.total.qualified), undefined],
              [Users, "Avg Utilization (APR)", util === null ? "—" : `${util}%`, undefined],
            ] as Array<[typeof Layers, string, string, string | undefined]>).map(([Icon, label, value, cap]) => (
              <div key={label} className="flex items-center gap-2 rounded-lg bg-white px-2 py-1.5 text-slate-800">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#e8eefb] text-[#1e2a78]"><Icon className="h-4 w-4" /></span>
                <span className="min-w-0"><span className="block text-base font-extrabold leading-tight text-[#1e2a78]">{value}</span><span className="block truncate text-[10px] font-semibold text-slate-600">{label}</span>{cap && <span className="block text-[9px] font-bold text-emerald-600">{cap}</span>}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <DetailDrawer spec={drawer} onClose={() => setDrawer(null)} />
    </div>
  );
}
