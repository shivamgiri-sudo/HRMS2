import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  PhoneIncoming, PhoneOutgoing, PhoneCall, Users, Mail, MessageSquare, ShieldCheck, Smile, Frown, Gauge, Eye,
  RefreshCw, ArrowUp, ArrowDown, Lightbulb, Trophy, UsersRound, Headset, TrendingUp, LayoutDashboard,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner, DashboardExportMenu, formatShortDate, KPI_TONES, type KpiTone, type ExportSlide } from "./DashboardKit";
import { GncDetailDrawer, type DrawerSeries } from "./GncAbandonCartDetailDrawer";
import { DetailDrawer, type DrillTarget } from "./CloviaReportKit";

/**
 * Clovia -- Customer Support Performance Dashboard (Overview slide).
 *
 * Every figure is live from GET /api/process-performance/clovia-lob/overview-dashboard,
 * which composes the same Clovia LOB services the Inbound / Email / Chat /
 * Outbound slides use (live dialer for inbound; cl_outbound / cl_email_raw /
 * cl_chat / cl_feedback / cl_quality for the rest). The four LOB volumes are
 * different units and are never added together.
 *
 * Deliberately absent from the reference layout because Clovia has no source
 * for them: Revenue, Sale Count, AOV, and every Target / Ach % column (no
 * targets are stored), plus the Week / TL / Agent header filters (the four
 * channels do not share an agent or TL key). Nothing on this page is estimated.
 */

type Day = Record<string, string | number>;
interface InboundBlock {
  offered: number; answered: number; abandoned: number; answeredPct: number; abandonPct: number; slPct: number; slThresholdSec: number;
  aht: number; avgTalk: number; avgHold: number; avgAcw: number; asa: number; uniqueCallers: number; repeatCallers: number; repeatCallerPct: number;
  agentsActive: number; callsPerAgent: number; daily: Day[];
}
interface AgentMix { empId: string; agent: string; inbound: number; email: number; chat: number; outbound: number; total: number; lobs: number; quality: number | null; audits: number }
interface Overview {
  from: string; to: string; prevFrom: string; prevTo: string;
  deltas: Record<"offered" | "answered" | "uniqueCallers" | "slPct" | "connectPct" | "emails" | "chats" | "quality" | "csat" | "dsat", number | null>;
  insights: Array<{ tone: "good" | "warn" | "info"; text: string }>;
  inbound: InboundBlock | null;
  rechurn: { calls: number; unique: number; abandon: number; avgDelayMin: number };
  outbound: { metrics: Record<string, number>; daily: Day[] };
  email: { metrics: Record<string, number>; daily: Day[] };
  chat: { metrics: Record<string, number>; daily: Day[] };
  csat: { responses: number; satisfied: number; notSatisfied: number; csatPct: number; dsatPct: number; daily: Day[] };
  quality: { audits: number; avg: number; fatal: number; byLob: Array<{ lob: string; audits: number; avg: number; fatal: number }>; daily: Array<{ date: string; audits: number; avg: number }> };
  agents: AgentMix[];
  headcount: { inbound: number; email: number; chat: number; outbound: number; distinct: number; multiLob: number };
  latest: Record<"email" | "chat" | "outbound" | "csat", string | null>;
  empty: Record<"email" | "chat" | "outbound" | "csat", boolean>;
}

/* ---------------------------------- helpers -------------------------------- */

const int = (n: number) => Math.round(n).toLocaleString("en-IN");
const r1 = (n: number) => Math.round(n * 10) / 10;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const hms = (s: number) => {
  const t = Math.round(s);
  return `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};
const ddmm = (iso: string | null) => (iso ? formatShortDate(iso) : "—");
const TOOLTIP_STYLE = { fontSize: 11, borderRadius: 10, border: "1px solid #e2e8f0" } as const;
const C = { rose: "#ec4899", purple: "#8b5cf6", blue: "#3b82f6", sky: "#0ea5e9", green: "#10b981", amber: "#f59e0b", orange: "#f97316", red: "#f43f5e", teal: "#14b8a6", slate: "#94a3b8" };
const dim = (iso: string) => new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), 0)).getUTCDate();

/** Day-of-month buckets (1-7 = W-1 ...), the same the Clovia LOB slides' week columns use. */
function weekBucket(iso: string): { key: string; label: string } {
  const day = Number(iso.slice(8, 10));
  const n = Math.ceil(day / 7);
  const start = (n - 1) * 7 + 1;
  const mon = new Date(`${iso.slice(0, 7)}-01T00:00:00`).toLocaleDateString("en-IN", { month: "short" });
  return { key: `${iso.slice(0, 7)}-W${n}`, label: `W-${n} (${start}-${Math.min(start + 6, dim(iso))} ${mon})` };
}

/** Sums the count fields per week, weights the per-row averages by their own volume, then derives ratios from the sums (never averages a %). */
function weekly(
  rows: Day[], sums: string[], weighted: Array<[string, string]> = [], derive?: (s: Record<string, number>) => Record<string, number>,
): Array<Record<string, string | number>> {
  const map = new Map<string, { label: string; s: Record<string, number>; w: Record<string, number> }>();
  for (const r of rows) {
    const { key, label } = weekBucket(String(r.date));
    const cur = map.get(key) ?? { label, s: {}, w: {} };
    for (const k of sums) cur.s[k] = (cur.s[k] ?? 0) + Number(r[k] ?? 0);
    for (const [k, wk] of weighted) { cur.w[k] = (cur.w[k] ?? 0) + Number(r[k] ?? 0) * Number(r[wk] ?? 0); cur.s[wk] = cur.s[wk] ?? 0; }
    map.set(key, cur);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => {
    const out: Record<string, string | number> = { label: v.label };
    for (const k of sums) out[k] = v.s[k] ?? 0;
    for (const [k, wk] of weighted) out[k] = v.s[wk] > 0 ? r1(v.w[k] / v.s[wk]) : 0;
    if (derive) Object.assign(out, derive(v.s));
    return out;
  });
}
const ratio = (a: number, b: number) => (b > 0 ? r1((a / b) * 100) : 0);

/* ------------------------------- small pieces ------------------------------ */

function DeltaBadge({ value, unit, invert }: { value: number | null; unit: "%" | "pp"; invert?: boolean }) {
  if (value === null) return null;
  const up = value >= 0;
  const good = invert ? !up : up;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold ${good ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"}`}>
      {up ? <ArrowUp className="h-2.5 w-2.5" /> : <ArrowDown className="h-2.5 w-2.5" />}
      {Math.abs(value)}{unit}
    </span>
  );
}

function StatTile({ icon: Icon, tone, label, value, sub, delta, unit = "%", invert, onClick }: {
  icon: typeof PhoneCall; tone: KpiTone; label: string; value: string; sub?: string; delta?: number | null; unit?: "%" | "pp"; invert?: boolean; onClick?: () => void;
}) {
  const t = KPI_TONES[tone];
  return (
    <button
      type="button" onClick={onClick} disabled={!onClick} title="Click for week-wise & date-wise details"
      className={`relative overflow-hidden rounded-lg border border-slate-100 bg-white p-2 text-left shadow-sm transition-shadow ${onClick ? "cursor-pointer hover:shadow-md" : "cursor-default"}`}
    >
      <div className={`absolute inset-y-0 left-0 w-1 ${t.accent}`} />
      <div className="flex items-start justify-between pl-1">
        <span className={`flex h-6 w-6 items-center justify-center rounded-md ${t.badge}`}><Icon className="h-3 w-3" /></span>
        <DeltaBadge value={delta ?? null} unit={unit} invert={invert} />
      </div>
      <p className={`mt-1 pl-1 text-base font-extrabold leading-tight tracking-tight ${t.value}`}>{value}</p>
      <p className="truncate pl-1 text-[10px] font-semibold leading-tight text-slate-600">{label}</p>
      {sub && <p className="truncate pl-1 text-[9px] leading-tight text-slate-400" title={sub}>{sub}</p>}
    </button>
  );
}

function ViewDetailsBtn({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-white/70 px-2 py-1 text-[10px] font-semibold text-slate-500 transition-colors hover:bg-white hover:text-slate-700">
      <Eye className="h-3 w-3" /> View details
    </button>
  );
}

function MiniSelect({ value, onChange, label }: { value: "daily" | "weekly"; onChange: (v: "daily" | "weekly") => void; label: string }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as "daily" | "weekly")}>
      <SelectTrigger className="h-7 w-[92px] bg-white text-[11px]" aria-label={label}><SelectValue /></SelectTrigger>
      <SelectContent><SelectItem value="daily">Daily</SelectItem><SelectItem value="weekly">Weekly</SelectItem></SelectContent>
    </Select>
  );
}

function Card({ title, icon: Icon, tone, action, children, footnote }: {
  title: string; icon: typeof PhoneCall; tone: KpiTone; action?: React.ReactNode; children: React.ReactNode; footnote?: string;
}) {
  const t = KPI_TONES[tone];
  return (
    <div className="rounded-2xl border border-white/70 bg-white/85 p-3 shadow-sm backdrop-blur-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`flex h-6 w-6 items-center justify-center rounded-lg ${t.badge}`}><Icon className="h-3.5 w-3.5" /></span>
          <p className="text-[13px] font-bold text-slate-700">{title}</p>
        </div>
        {action}
      </div>
      {children}
      {footnote && <p className="mt-2 border-t border-slate-50 pt-1.5 text-[10px] leading-relaxed text-slate-400">{footnote}</p>}
    </div>
  );
}

function Mini({ label, value, sub, cls = "text-slate-800" }: { label: string; value: string; sub?: string; cls?: string }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-white px-2 py-1.5 text-center">
      <p className={`text-sm font-extrabold leading-tight ${cls}`}>{value}</p>
      <p className="text-[9px] font-semibold leading-tight text-slate-500">{label}</p>
      {sub && <p className="text-[8px] leading-tight text-slate-400">{sub}</p>}
    </div>
  );
}

function MetricTable({ rows, onClick }: { rows: Array<{ label: string; value: string }>; onClick: () => void }) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="bg-slate-800 text-[10px] font-bold uppercase tracking-wide text-white">
          <th className="rounded-l-md px-2 py-1 text-left font-bold text-white">Metric</th>
          <th className="rounded-r-md px-2 py-1 text-right font-bold text-white">Value</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.label} onClick={onClick} className={`cursor-pointer transition-colors hover:bg-rose-50 ${i % 2 === 1 ? "bg-slate-50/70" : "bg-white"}`}>
            <td className="px-2 py-1 text-left font-medium text-slate-600">{r.label}</td>
            <td className="px-2 py-1 text-right font-semibold text-slate-800">{r.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ----------------------------------- page ---------------------------------- */

type DrawerState = { title: string; series: DrawerSeries[]; daily: Array<Record<string, string | number>>; weekly: Array<Record<string, string | number>> };
const ser = (key: string, label: string, fmt: DrawerSeries["fmt"], color: string): DrawerSeries => ({ key, label, fmt, color });

export function CloviaOverviewDashboard({ from, to }: { from: string; to: string }) {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const [agentDrill, setAgentDrill] = useState<DrillTarget | null>(null);
  const [callMode, setCallMode] = useState<"daily" | "weekly">("daily");
  const [connMode, setConnMode] = useState<"daily" | "weekly">("daily");
  const [msgMode, setMsgMode] = useState<"daily" | "weekly">("daily");
  const [showAllAgents, setShowAllAgents] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: Overview }>(`/api/process-performance/clovia-lob/overview-dashboard?from=${from}&to=${to}`);
      setData(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load the Clovia overview.");
    } finally { setLoading(false); }
  }, [from, to]);
  useEffect(() => { void load(); }, [load]);

  /* Daily rows (with derived ratios) and their weekly roll-ups, per source. */
  const rows = useMemo(() => {
    if (!data) return null;
    const ib = data.inbound?.daily ?? [];
    const csatDaily = data.csat.daily.map((d) => ({ ...d, dsatPct: ratio(Number(d.notSatisfied), Number(d.responses)) }));
    const qDaily = data.quality.daily.map((d) => ({ date: d.date, audits: d.audits, quality: d.avg }));
    return {
      ib: { daily: ib, weekly: weekly(ib, ["offered", "answered", "abandoned"], [], (s) => ({ answeredPct: ratio(s.answered, s.offered), abandonPct: ratio(s.abandoned, s.offered) })) },
      ob: { daily: data.outbound.daily, weekly: weekly(data.outbound.daily, ["dials", "connected"], [], (s) => ({ connectPct: ratio(s.connected, s.dials) })) },
      em: { daily: data.email.daily, weekly: weekly(data.email.daily, ["assigned", "touched", "closed", "open", "inProcess", "reOpen", "junk"], [], (s) => ({ closurePct: ratio(s.closed, s.assigned) })) },
      ch: { daily: data.chat.daily, weekly: weekly(data.chat.daily, ["chats", "repeat"], [["avgWait", "chats"], ["wait30", "chats"], ["avgDur", "chats"]]) },
      cs: { daily: csatDaily, weekly: weekly(csatDaily, ["responses", "satisfied", "notSatisfied"], [], (s) => ({ csatPct: ratio(s.satisfied, s.responses), dsatPct: ratio(s.notSatisfied, s.responses) })) },
      qa: { daily: qDaily, weekly: weekly(qDaily, ["audits"], [["quality", "audits"]]) },
    };
  }, [data]);

  const open = (title: string, series: DrawerSeries[], set: { daily: Array<Record<string, string | number>>; weekly: Array<Record<string, string | number>> }) =>
    setDrawer({ title, series, daily: set.daily, weekly: set.weekly });

  const exportSlides = useMemo<ExportSlide[]>(() => {
    if (!data) return [];
    const ib = data.inbound; const om = data.outbound.metrics; const em = data.email.metrics; const ch = data.chat.metrics;
    return [{
      title: "Customer Support Overview",
      kpis: [
        { label: "Inbound Calls Offered", value: int(ib?.offered ?? 0) }, { label: "Calls Answered", value: int(ib?.answered ?? 0) },
        { label: "Unique Callers", value: int(ib?.uniqueCallers ?? 0) }, { label: "Outbound Connected %", value: `${om.connectPct ?? 0}%` },
        { label: "Emails Assigned", value: int(em.assigned ?? 0) }, { label: "Chats", value: int(ch.chats ?? 0) },
        { label: "Quality Score", value: data.quality.audits ? `${data.quality.avg}%` : "—" },
        { label: "C-SAT", value: data.csat.responses ? `${data.csat.csatPct}%` : "—" }, { label: "D-SAT", value: data.csat.responses ? `${data.csat.dsatPct}%` : "—" },
      ],
      tables: [
        { title: "Quality by LOB", columns: ["LOB", "Audits", "Avg score", "Fatal"], rows: data.quality.byLob.map((q) => [q.lob, q.audits, q.audits ? `${q.avg}%` : "—", q.fatal]) },
        { title: "Headcount summary", columns: ["Channel", "Agents"], rows: [["Inbound", data.headcount.inbound], ["Email", data.headcount.email], ["Chat", data.headcount.chat], ["Outbound", data.headcount.outbound], ["Distinct agents", data.headcount.distinct], ["Agents on 2+ LOBs", data.headcount.multiLob]] },
        { title: "Agents (contacts handled)", columns: ["Agent", "Emp ID", "Inbound", "Email", "Chat", "Outbound", "Total", "Quality"], rows: data.agents.map((a) => [a.agent, a.empId, a.inbound, a.email, a.chat, a.outbound, a.total, a.quality === null ? "—" : `${a.quality}%`]) },
        { title: "Key insights", columns: ["Insight"], rows: data.insights.map((i) => [i.text]) },
      ],
    }];
  }, [data]);

  if (loading && !data) return <Spinner />;
  if (error && !data) return <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data || !rows) return null;

  const ib = data.inbound;
  const om = data.outbound.metrics; const em = data.email.metrics; const ch = data.chat.metrics;
  const d = data.deltas;
  const qLob = (lob: string) => data.quality.byLob.find((q) => q.lob === lob);
  const qText = (lob: string) => { const q = qLob(lob); return q && q.audits > 0 ? `${q.avg}%` : "—"; };
  const callChart = (callMode === "daily" ? rows.ib.daily.map((r) => ({ ...r, x: formatShortDate(String(r.date)) })) : rows.ib.weekly.map((r) => ({ ...r, x: String(r.label).replace(/\s*\(.*\)/, "") })));
  const connChart = (connMode === "daily" ? rows.ob.daily.map((r) => ({ ...r, x: formatShortDate(String(r.date)) })) : rows.ob.weekly.map((r) => ({ ...r, x: String(r.label).replace(/\s*\(.*\)/, "") })));
  const msgChart = (() => {
    const src = msgMode === "daily"
      ? { em: rows.em.daily as Array<Record<string, string | number>>, ch: rows.ch.daily as Array<Record<string, string | number>>, key: "date" }
      : { em: rows.em.weekly, ch: rows.ch.weekly, key: "label" };
    const keys = [...new Set([...src.em.map((r) => String(r[src.key])), ...src.ch.map((r) => String(r[src.key]))])].sort();
    return keys.map((k) => {
      const e = src.em.find((r) => String(r[src.key]) === k); const c = src.ch.find((r) => String(r[src.key]) === k);
      return { x: msgMode === "daily" ? formatShortDate(k) : k.replace(/\s*\(.*\)/, ""), emails: e ? Number(e.assigned) : undefined, chats: c ? Number(c.chats) : undefined };
    });
  })();
  const agentRows = showAllAgents ? data.agents : data.agents.slice(0, 5);
  const latestNote = `Inbound is live through ${ddmm(data.inbound?.daily.length ? String(data.inbound.daily[data.inbound.daily.length - 1].date) : null)}. Uploaded data — Outbound ${ddmm(data.latest.outbound)}, Email ${ddmm(data.latest.email)}, Chat ${ddmm(data.latest.chat)}, Survey ${ddmm(data.latest.csat)} (the latest date on file for each; none of it is estimated).`;

  const S = {
    offered: ser("offered", "Calls Offered", "int", C.blue), answered: ser("answered", "Calls Answered", "int", C.green),
    answeredPct: ser("answeredPct", "Answered %", "pct", C.teal), abandoned: ser("abandoned", "Abandoned", "int", C.red), abandonPct: ser("abandonPct", "Abandon %", "pct", C.orange),
    unique: ser("uniqueCallers", "Unique Callers", "int", C.purple), sl: ser("slPct", "SL %", "pct", C.sky),
    dials: ser("dials", "Dialed", "int", C.purple), connected: ser("connected", "Connected", "int", C.green), connectPct: ser("connectPct", "Connected %", "pct", C.rose),
    assigned: ser("assigned", "Emails Assigned", "int", C.sky), closed: ser("closed", "Closed", "int", C.green), closurePct: ser("closurePct", "Closure %", "pct", C.teal),
    open: ser("open", "Open", "int", C.blue), inProcess: ser("inProcess", "In Process", "int", C.amber), reOpen: ser("reOpen", "Re-open", "int", C.red),
    chats: ser("chats", "Chats", "int", C.green), avgWait: ser("avgWait", "Avg Wait (s)", "int", C.amber), wait30: ser("wait30", "Accepted ≤30s %", "pct", C.teal), avgDur: ser("avgDur", "Avg Chat Duration", "hms", C.rose),
    csat: ser("csatPct", "C-SAT %", "pct", C.green), dsat: ser("dsatPct", "D-SAT %", "pct", C.red), responses: ser("responses", "Survey Responses", "int", C.slate),
    quality: ser("quality", "Quality Score %", "pct", C.amber), audits: ser("audits", "Audits", "int", C.slate),
  };

  return (
    <div className="space-y-3 rounded-3xl bg-gradient-to-br from-pink-50 via-rose-50 to-orange-50 p-3 sm:p-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-pink-600 to-rose-600 text-white shadow"><LayoutDashboard className="h-5 w-5" /></span>
          <div>
            <h2 className="text-lg font-extrabold leading-tight text-slate-800">Customer Support Performance Dashboard</h2>
            <p className="text-xs font-medium text-slate-500">Inbound &nbsp;|&nbsp; Outbound &nbsp;|&nbsp; Email &nbsp;|&nbsp; Chat</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DashboardExportMenu
            reportTitle="Clovia — Customer Support Overview" fileBaseName="Clovia_Overview" raw={{ dashboard: "clovia", from, to }}
            subtitle={`${from} to ${to}`} slides={exportSlides} activeSlideTitle="Customer Support Overview"
          />
          <button
            type="button" onClick={() => void load()} disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-slate-700 disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </div>
      {error && <div className="rounded-xl border border-red-100 bg-red-50 p-3 text-xs text-red-700">{error}</div>}

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 xl:grid-cols-10">
        <StatTile icon={PhoneIncoming} tone="rose" label="Inbound Calls Offered" value={int(ib?.offered ?? 0)} delta={d.offered} sub="vs previous period"
          onClick={() => open("Inbound Calls Offered", [S.offered, S.abandoned], rows.ib)} />
        <StatTile icon={PhoneCall} tone="emerald" label="Calls Answered" value={int(ib?.answered ?? 0)} delta={d.answered} sub={ib ? `${ib.answeredPct}% of offered` : undefined}
          onClick={() => open("Calls Answered", [S.answered, S.answeredPct], rows.ib)} />
        <StatTile icon={Users} tone="indigo" label="Unique Callers" value={int(ib?.uniqueCallers ?? 0)} delta={d.uniqueCallers} sub={ib ? `${ib.repeatCallerPct}% repeat callers` : undefined}
          onClick={() => open("Unique Callers (daily)", [S.unique], { daily: rows.ib.daily, weekly: [] })} />
        <StatTile icon={Gauge} tone="sky" label="Service Level" value={ib ? `${ib.slPct}%` : "—"} delta={d.slPct} unit="pp" sub={ib ? `answered within ${ib.slThresholdSec}s` : undefined}
          onClick={() => open("Service Level (daily)", [S.sl], { daily: rows.ib.daily, weekly: [] })} />
        <StatTile icon={PhoneOutgoing} tone="violet" label="Outbound Connected %" value={data.empty.outbound ? "—" : `${om.connectPct ?? 0}%`} delta={d.connectPct} unit="pp" sub={`${int(om.dials ?? 0)} dialed`}
          onClick={() => open("Outbound Connected %", [S.connectPct, S.dials, S.connected], rows.ob)} />
        <StatTile icon={Mail} tone="cyan" label="Emails Assigned" value={int(em.assigned ?? 0)} delta={d.emails} sub={`${em.closurePct ?? 0}% closed`}
          onClick={() => open("Emails Assigned", [S.assigned, S.closed, S.closurePct], rows.em)} />
        <StatTile icon={MessageSquare} tone="teal" label="Chats" value={int(ch.chats ?? 0)} delta={d.chats} sub={`${ch.wait30 ?? 0}% accepted ≤30s`}
          onClick={() => open("Chats", [S.chats, S.avgWait, S.wait30], rows.ch)} />
        <StatTile icon={ShieldCheck} tone="amber" label="Quality Score" value={data.quality.audits ? `${data.quality.avg}%` : "—"} delta={d.quality} unit="pp" sub={`${data.quality.audits} audits · ${data.quality.fatal} fatal`}
          onClick={() => open("Quality Score (by audit date)", [S.quality, S.audits], rows.qa)} />
        <StatTile icon={Smile} tone="emerald" label="C-SAT" value={data.csat.responses ? `${data.csat.csatPct}%` : "—"} delta={d.csat} unit="pp" sub={`${int(data.csat.responses)} responses`}
          onClick={() => open("C-SAT", [S.csat, S.responses], rows.cs)} />
        <StatTile icon={Frown} tone="rose" label="D-SAT" value={data.csat.responses ? `${data.csat.dsatPct}%` : "—"} delta={d.dsat} unit="pp" invert sub="IVR survey"
          onClick={() => open("D-SAT", [S.dsat, S.responses], rows.cs)} />
      </div>

      {/* Trend row */}
      <div className="grid gap-3 lg:grid-cols-3">
        <Card title="Call Volume Trend" icon={PhoneIncoming} tone="rose"
          action={<div className="flex items-center gap-1.5"><MiniSelect label="Call volume period" value={callMode} onChange={setCallMode} /><ViewDetailsBtn onClick={() => open("Call Volume Trend", [S.offered, S.answered, S.abandoned, S.answeredPct], rows.ib)} /></div>}>
          <ResponsiveContainer width="100%" height={190}>
            <ComposedChart data={callChart} margin={{ top: 4, right: 6, left: -14, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="x" tick={{ fontSize: 9 }} />
              <YAxis tick={{ fontSize: 9 }} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="offered" name="Offered" fill="#f9a8d4" radius={[3, 3, 0, 0]} maxBarSize={16} />
              <Bar dataKey="answered" name="Answered" fill={C.purple} radius={[3, 3, 0, 0]} maxBarSize={16} />
              {callMode === "daily" && <Line type="monotone" dataKey="uniqueCallers" name="Unique Callers" stroke={C.blue} strokeWidth={2} dot={false} />}
            </ComposedChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Outbound Connected %" icon={PhoneOutgoing} tone="violet"
          footnote="No connected-% target is stored for Clovia, so no target line is drawn."
          action={<div className="flex items-center gap-1.5"><MiniSelect label="Connected percent period" value={connMode} onChange={setConnMode} /><ViewDetailsBtn onClick={() => open("Outbound Connected %", [S.connectPct, S.dials, S.connected], rows.ob)} /></div>}>
          {connChart.length === 0 ? <p className="py-16 text-center text-xs text-slate-400">No outbound data in this range.</p> : (
            <ResponsiveContainer width="100%" height={175}>
              <ComposedChart data={connChart} margin={{ top: 4, right: 6, left: -14, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="x" tick={{ fontSize: 9 }} />
                <YAxis tick={{ fontSize: 9 }} domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => `${v}%`} />
                <Line type="monotone" dataKey="connectPct" name="Connected %" stroke={C.rose} strokeWidth={2} dot={{ r: 2 }} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="Email & Chat Volume Trend" icon={TrendingUp} tone="teal"
          action={<div className="flex items-center gap-1.5"><MiniSelect label="Email and chat period" value={msgMode} onChange={setMsgMode} /><ViewDetailsBtn onClick={() => open("Email volume", [S.assigned, S.closed, S.open, S.reOpen], rows.em)} /></div>}>
          {msgChart.length === 0 ? <p className="py-16 text-center text-xs text-slate-400">No email or chat data in this range.</p> : (
            <ResponsiveContainer width="100%" height={190}>
              <ComposedChart data={msgChart} margin={{ top: 4, right: 6, left: -14, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="x" tick={{ fontSize: 9 }} />
                <YAxis tick={{ fontSize: 9 }} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Bar dataKey="emails" name="Emails assigned" fill={C.sky} radius={[3, 3, 0, 0]} maxBarSize={16} />
                <Bar dataKey="chats" name="Chats" fill={C.green} radius={[3, 3, 0, 0]} maxBarSize={16} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {/* Per-LOB panels */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Card title="Inbound Performance" icon={PhoneIncoming} tone="rose"
          action={<ViewDetailsBtn onClick={() => open("Inbound Performance", [S.offered, S.answered, S.abandoned, S.answeredPct, S.abandonPct, S.sl], rows.ib)} />}>
          {ib ? (
            <>
              <div className="mb-2 grid grid-cols-3 gap-1.5">
                <Mini label="Calls Offered" value={int(ib.offered)} /><Mini label="Calls Answered" value={int(ib.answered)} sub={`${ib.answeredPct}%`} cls="text-emerald-600" />
                <Mini label="Unique Callers" value={int(ib.uniqueCallers)} /><Mini label="Repeat Callers" value={int(ib.repeatCallers)} sub={`${ib.repeatCallerPct}%`} cls="text-rose-600" />
                <Mini label="Rechurn Calls" value={int(data.rechurn.calls)} sub={`${data.rechurn.avgDelayMin} min gap`} /><Mini label="Abandoned" value={int(ib.abandoned)} sub={`${ib.abandonPct}%`} cls="text-red-600" />
              </div>
              <MetricTable
                onClick={() => open("Inbound Performance", [S.offered, S.answered, S.abandoned, S.answeredPct, S.abandonPct, S.sl], rows.ib)}
                rows={[
                  { label: "AL % (answered / offered)", value: `${ib.answeredPct}%` }, { label: `SL % (≤${ib.slThresholdSec}s)`, value: `${ib.slPct}%` },
                  { label: "AHT", value: hms(ib.aht) }, { label: "Avg Talk Time", value: hms(ib.avgTalk) }, { label: "Avg Hold Time", value: hms(ib.avgHold) },
                  { label: "Avg After-call Work", value: hms(ib.avgAcw) }, { label: "Avg Speed of Answer", value: hms(ib.asa) }, { label: "Quality Score", value: qText("Inbound") },
                ]}
              />
            </>
          ) : <p className="py-10 text-center text-xs text-slate-400">The live dialer could not be read.</p>}
        </Card>

        <Card title="Outbound Performance" icon={PhoneOutgoing} tone="violet"
          action={<ViewDetailsBtn onClick={() => open("Outbound Performance", [S.dials, S.connected, S.connectPct], rows.ob)} />}>
          <div className="mb-2 grid grid-cols-3 gap-1.5">
            <Mini label="Dialed" value={int(om.dials ?? 0)} /><Mini label="Connected" value={int(om.connected ?? 0)} cls="text-emerald-600" /><Mini label="Connected %" value={`${om.connectPct ?? 0}%`} cls="text-violet-600" />
          </div>
          <MetricTable
            onClick={() => open("Outbound Performance", [S.dials, S.connected, S.connectPct], rows.ob)}
            rows={[
              { label: "Avg Talk Time", value: mmss(om.avgTalk ?? 0) }, { label: "Not Connected", value: int(om.notConnected ?? 0) },
              { label: "Unique Numbers Dialed", value: int(om.uniqueNumbers ?? 0) }, { label: "Repeat Dials", value: `${om.repeatPct ?? 0}%` },
              { label: "Dials / Agent-day", value: String(om.dialsPerAgentDay ?? 0) }, { label: "Agents", value: String(om.agents ?? 0) }, { label: "Quality Score", value: qText("Outbound") },
            ]}
          />
          <p className="mb-1 mt-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">Dialed vs Connected</p>
          <ResponsiveContainer width="100%" height={110}>
            <ComposedChart data={rows.ob.daily.map((r) => ({ ...r, x: formatShortDate(String(r.date)) }))} margin={{ top: 2, right: 4, left: -22, bottom: 0 }}>
              <XAxis dataKey="x" tick={{ fontSize: 8 }} /><YAxis tick={{ fontSize: 8 }} /><Tooltip contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="dials" name="Dialed" fill="#c4b5fd" radius={[2, 2, 0, 0]} maxBarSize={10} /><Bar dataKey="connected" name="Connected" fill={C.rose} radius={[2, 2, 0, 0]} maxBarSize={10} />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Email Performance" icon={Mail} tone="cyan"
          action={<ViewDetailsBtn onClick={() => open("Email Performance", [S.assigned, S.open, S.inProcess, S.reOpen, S.closed, S.closurePct], rows.em)} />}>
          <div className="mb-2 grid grid-cols-3 gap-1.5">
            <Mini label="Total Emails" value={int(em.assigned ?? 0)} /><Mini label="Open" value={int(em.open ?? 0)} cls="text-sky-600" /><Mini label="Re-open" value={int(em.reOpen ?? 0)} sub={`${em.reopenPct ?? 0}%`} cls="text-rose-600" />
            <Mini label="In Process" value={int(em.inProcess ?? 0)} cls="text-amber-600" /><Mini label="Closed" value={int(em.closed ?? 0)} sub={`${em.closurePct ?? 0}%`} cls="text-emerald-600" /><Mini label="Junk" value={int(em.junk ?? 0)} sub={`${em.junkPct ?? 0}%`} />
          </div>
          <MetricTable
            onClick={() => open("Email Performance", [S.assigned, S.open, S.inProcess, S.reOpen, S.closed, S.closurePct], rows.em)}
            rows={[
              { label: "Closure %", value: `${em.closurePct ?? 0}%` }, { label: "Touched %", value: `${em.touchPct ?? 0}%` },
              { label: "Avg Emails / Day", value: String(em.avgAssignedPerDay ?? 0) }, { label: "Touched / Agent-day", value: String(em.avgTouchedPerAgentDay ?? 0) },
              { label: "Agents", value: String(em.agents ?? 0) }, { label: "Quality Score", value: qText("Email") },
            ]}
          />
          <p className="mb-1 mt-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">Email Volume Trend</p>
          <ResponsiveContainer width="100%" height={110}>
            <ComposedChart data={rows.em.daily.map((r) => ({ ...r, x: formatShortDate(String(r.date)) }))} margin={{ top: 2, right: 4, left: -22, bottom: 0 }}>
              <XAxis dataKey="x" tick={{ fontSize: 8 }} /><YAxis tick={{ fontSize: 8 }} /><Tooltip contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="open" name="Open" stackId="e" fill={C.blue} maxBarSize={10} /><Bar dataKey="reOpen" name="Re-open" stackId="e" fill={C.red} maxBarSize={10} /><Bar dataKey="inProcess" name="In Process" stackId="e" fill={C.amber} maxBarSize={10} />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Chat Performance" icon={MessageSquare} tone="teal"
          action={<ViewDetailsBtn onClick={() => open("Chat Performance", [S.chats, S.avgWait, S.wait30, S.avgDur], rows.ch)} />}>
          <div className="mb-2 grid grid-cols-3 gap-1.5">
            <Mini label="Total Chats" value={int(ch.chats ?? 0)} /><Mini label="Avg Chat Duration" value={hms(ch.avgDur ?? 0)} cls="text-teal-600" /><Mini label="Avg Wait Time" value={hms(ch.avgWait ?? 0)} cls="text-amber-600" />
          </div>
          <MetricTable
            onClick={() => open("Chat Performance", [S.chats, S.avgWait, S.wait30, S.avgDur], rows.ch)}
            rows={[
              { label: "Accepted ≤30s", value: `${ch.wait30 ?? 0}%` }, { label: "Accepted ≤60s", value: `${ch.wait60 ?? 0}%` },
              { label: "Repeat Chats", value: `${ch.repeatPct ?? 0}%` }, { label: "Chats / Agent-day", value: String(ch.chatsPerAgentDay ?? 0) },
              { label: "Agents", value: String(ch.agents ?? 0) }, { label: "Avg Star Rating", value: ch.ratings ? String(ch.avgStar) : "—" }, { label: "Quality Score", value: qText("Chat") },
            ]}
          />
          <p className="mb-1 mt-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">Chat Volume Trend</p>
          <ResponsiveContainer width="100%" height={110}>
            <ComposedChart data={rows.ch.daily.map((r) => ({ ...r, x: formatShortDate(String(r.date)) }))} margin={{ top: 2, right: 4, left: -22, bottom: 0 }}>
              <XAxis dataKey="x" tick={{ fontSize: 8 }} /><YAxis tick={{ fontSize: 8 }} /><Tooltip contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="chats" name="Chats" fill="#fdba74" radius={[2, 2, 0, 0]} maxBarSize={10} />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Headcount + Top agents + Insights */}
      <div className="grid gap-3 lg:grid-cols-4">
        <Card title="Headcount Summary" icon={UsersRound} tone="indigo" footnote="Agents with activity in the range, per channel (from the dialer and the uploaded data).">
          <div className="grid grid-cols-2 gap-1.5">
            <Mini label="Inbound Agents" value={String(data.headcount.inbound)} /><Mini label="Outbound Agents" value={String(data.headcount.outbound)} />
            <Mini label="Email Agents" value={String(data.headcount.email)} /><Mini label="Chat Agents" value={String(data.headcount.chat)} />
            <Mini label="Distinct Agents" value={String(data.headcount.distinct)} cls="text-indigo-600" /><Mini label="On 2+ Channels" value={String(data.headcount.multiLob)} cls="text-indigo-600" />
          </div>
        </Card>

        <div className="lg:col-span-2">
          <Card title="Top Performing Agents" icon={Trophy} tone="amber"
            footnote="Ranked by contacts handled across the four channels (units differ; they are counts of contacts). Click an agent for their per-channel detail."
            action={data.agents.length > 5 ? (
              <button type="button" onClick={() => setShowAllAgents((v) => !v)} className="rounded-lg bg-white/70 px-2 py-1 text-[10px] font-semibold text-slate-500 hover:bg-white hover:text-slate-700">
                {showAllAgents ? "Show top 5" : `Show all ${data.agents.length}`}
              </button>
            ) : undefined}>
            <div className="max-h-[300px] overflow-auto">
              <table className="w-full text-center text-xs">
                <thead>
                  <tr className="sticky top-0 z-10 bg-slate-800 text-[10px] font-bold uppercase tracking-wide text-white">
                    <th className="rounded-l-md px-2 py-1.5 font-bold text-white">#</th><th className="px-2 py-1.5 text-left font-bold text-white">Agent</th>
                    <th className="px-2 py-1.5 font-bold text-white">Inbound</th><th className="px-2 py-1.5 font-bold text-white">Email</th><th className="px-2 py-1.5 font-bold text-white">Chat</th>
                    <th className="px-2 py-1.5 font-bold text-white">Outbound</th><th className="px-2 py-1.5 font-bold text-white">Total</th><th className="rounded-r-md px-2 py-1.5 font-bold text-white">Quality</th>
                  </tr>
                </thead>
                <tbody>
                  {agentRows.map((a, i) => (
                    <tr key={a.empId} role="button" tabIndex={0} onClick={() => setAgentDrill({ kind: "agent", key: a.empId })} onKeyDown={(e) => { if (e.key === "Enter") setAgentDrill({ kind: "agent", key: a.empId }); }}
                      className={`cursor-pointer transition-colors hover:bg-rose-50 ${i % 2 === 1 ? "bg-slate-50/70" : "bg-white"}`}>
                      <td className="px-2 py-1.5 text-slate-400">{i + 1}</td>
                      <td className="px-2 py-1.5 text-left"><span className="font-semibold text-rose-700">{a.agent}</span><span className="ml-1 text-[10px] text-slate-400">{a.empId}</span></td>
                      <td className="px-2 py-1.5 text-slate-600">{int(a.inbound)}</td><td className="px-2 py-1.5 text-slate-600">{int(a.email)}</td>
                      <td className="px-2 py-1.5 text-slate-600">{int(a.chat)}</td><td className="px-2 py-1.5 text-slate-600">{int(a.outbound)}</td>
                      <td className="px-2 py-1.5 font-bold text-slate-800">{int(a.total)}</td>
                      <td className={`px-2 py-1.5 font-semibold ${a.quality === null ? "text-slate-300" : a.quality >= 90 ? "text-emerald-600" : "text-amber-600"}`}>{a.quality === null ? "—" : `${a.quality}%`}</td>
                    </tr>
                  ))}
                  {agentRows.length === 0 && <tr><td colSpan={8} className="py-6 text-center text-slate-400">No agent activity in this range.</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <Card title="Key Insights" icon={Lightbulb} tone="amber">
          {data.insights.length === 0 ? <p className="py-6 text-center text-xs text-slate-400">Not enough data in this range.</p> : (
            <ul className="space-y-2">
              {data.insights.map((i) => (
                <li key={i.text} className="flex items-start gap-2 text-[11px] leading-snug text-slate-600">
                  <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${i.tone === "good" ? "bg-emerald-500" : i.tone === "warn" ? "bg-amber-500" : "bg-sky-500"}`} />
                  <span>{i.text}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <p className="flex items-start gap-1.5 px-1 text-[10px] leading-relaxed text-slate-400">
        <Headset className="mt-0.5 h-3 w-3 shrink-0" />
        <span>{latestNote} Revenue, sale count, AOV and targets are not shown — Clovia has no source for them. Previous period: {data.prevFrom} to {data.prevTo}.</span>
      </p>

      {drawer && (
        <GncDetailDrawer
          title={drawer.title} eyebrow="Clovia · Week-wise & Date-wise" gradient="from-pink-600 via-rose-600 to-pink-700"
          series={drawer.series} dailyRows={drawer.daily} weeklyRows={drawer.weekly} onClose={() => setDrawer(null)}
        />
      )}
      <DetailDrawer lob="overview" target={agentDrill} query={`from=${from}&to=${to}`} onClose={() => setAgentDrill(null)} />
    </div>
  );
}
