import { useEffect, useMemo, useState } from "react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { PhoneIncoming, PhoneCall, PhoneMissed, AlertTriangle, Clock, Repeat2, Users, CalendarDays, TrendingUp, PhoneOff } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Spinner } from "./DashboardKit";
import type { DrawerTarget } from "./AppreciateWealthDrawer";
import {
  TOOLTIP_PROPS, fmtClock, fmtNum, fmtPctVal, deltaOf, CcShell, CcHeader, CcPanel, CcTile, CoverageNote, rateTint,
} from "./AwControlKit";

/**
 * Appreciate Wealth -- "Inbound Call Performance" slide, live from
 * GET /appreciate-wealth/inbound-center (aw_inbound rows with call type
 * Inbound, same de-duplication as the Inbound tab). Definitions, and what the
 * mock-up shows that the data cannot support (abandon before/within/after
 * window, queue-based service level), are in the backend service header.
 */

const API = "/api/process-performance/appreciate-wealth";
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDay = (iso: string) => `${iso.slice(8, 10)}-${MON[Number(iso.slice(5, 7)) - 1]}`;
const fullDay = (iso: string) => `${iso.slice(8, 10)}-${MON[Number(iso.slice(5, 7)) - 1]}-${iso.slice(2, 4)}`;
function mondayOf(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return new Date(Date.UTC(y, m - 1, d - dow)).toISOString().slice(0, 10);
}

interface Kpis {
  offered: number; answered: number; alPct: number; abn: number; abnPct: number; neverReached: number; reachedNotAnswered: number;
  uniqueCalls: number; repeatCalls: number; repeatPct: number; talkS: number; avgTalkS: number; ahtS: number;
}
interface Day extends Kpis { date: string }
interface Col { key: string; label: string; kind: "month" | "week"; from: string; to: string }
interface Data {
  from: string; to: string; effectiveTo: string; prevFrom: string; prevTo: string;
  coverage: { from: string | null; to: string | null };
  kpis: Kpis; prev: Kpis | null; daily: Day[]; columns: Col[]; grid: Record<string, Kpis>;
}
type Mode = "range" | "mtd" | "wtd" | "ytd";

interface GridRow { label: string; get: (k: Kpis) => string; tint?: (k: Kpis) => string; bold?: boolean }
const GRID_ROWS: GridRow[] = [
  { label: "Call Offered", get: (k) => fmtNum(k.offered) },
  { label: "Call Answered", get: (k) => fmtNum(k.answered) },
  { label: "AL %", get: (k) => (k.offered ? fmtPctVal(k.alPct) : "—"), tint: (k) => rateTint(k.alPct, true, k.offered > 0) },
  { label: "Abn Calls", get: (k) => fmtNum(k.abn) },
  { label: "Abn — never reached an agent", get: (k) => fmtNum(k.neverReached) },
  { label: "Abn — reached an agent, not answered", get: (k) => fmtNum(k.reachedNotAnswered) },
  { label: "Abn %", get: (k) => (k.offered ? fmtPctVal(k.abnPct) : "—"), tint: (k) => rateTint(k.abnPct * 4, false, k.offered > 0) },
  { label: "Unique Calls", get: (k) => fmtNum(k.uniqueCalls) },
  { label: "Repeat Calls", get: (k) => fmtNum(k.repeatCalls) },
  { label: "Repeat %", get: (k) => (k.offered ? fmtPctVal(k.repeatPct) : "—"), tint: (k) => (k.offered ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-400") },
  { label: "Total Talk Time", get: (k) => (k.talkS ? fmtClock(k.talkS) : "—"), bold: true },
  { label: "Avg. Talk Time", get: (k) => (k.answered ? fmtClock(k.avgTalkS) : "—"), bold: true },
  { label: "AHT", get: (k) => (k.answered ? fmtClock(k.ahtS) : "—"), bold: true },
];

export function AppreciateWealthInboundCenter({ from, to, onOpen }: { from: string; to: string; onOpen: (t: DrawerTarget) => void }) {
  const [mode, setMode] = useState<Mode>("range");
  const [anchor, setAnchor] = useState<string | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Reset when the page's date range changes.
  useEffect(() => { setAnchor(null); setMode("range"); }, [from, to]);

  const win = useMemo(() => {
    const end = anchor ?? to;
    if (mode === "mtd") return { f: `${end.slice(0, 7)}-01`, t: end };
    if (mode === "wtd") return { f: mondayOf(end), t: end };
    if (mode === "ytd") return { f: `${end.slice(0, 4)}-01-01`, t: end };
    return { f: from, t: to };
  }, [mode, anchor, from, to]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    hrmsApi.get<{ success: boolean; data: Data }>(`${API}/inbound-center?from=${win.f}&to=${win.t}`)
      .then((res) => { if (!cancelled) { setData(res.data); setAnchor((a) => a ?? res.data.effectiveTo); } })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Unable to load the inbound slide."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [win.f, win.t]);

  if (loading && !data) return <Spinner tone="blue" />;
  if (error) return <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return null;

  const k = data.kpis; const p = data.prev;
  const openDay = (a: string, b: string, label: string) => onOpen({ kind: "day", from: a, to: b, label });
  const abnDonut = [
    { name: "Never reached an agent", value: k.neverReached, color: "#7c3aed" },
    { name: "Reached an agent, not answered", value: k.reachedNotAnswered, color: "#f59e0b" },
  ];
  const trend = data.daily.map((d) => ({ ...d, x: shortDay(d.date) }));
  const maxUR = Math.max(1, k.uniqueCalls, k.repeatCalls);

  return (
    <CcShell>
      <CcHeader
        title="Inbound Call Performance"
        subtitle={`Customer Support line · aw_inbound, call type Inbound · ${fullDay(data.from)} – ${fullDay(data.effectiveTo)}`}
        right={
          <div className="inline-flex rounded-xl bg-white p-1 shadow">
            {([["range", "Range"], ["mtd", "MTD"], ["wtd", "WTD"], ["ytd", "YTD"]] as Array<[Mode, string]>).map(([m, label]) => (
              <button key={m} type="button" onClick={() => setMode(m)} className={`rounded-lg px-3 py-1 text-xs font-bold transition-colors ${mode === m ? "bg-indigo-700 text-white" : "text-slate-600 hover:bg-slate-100"}`}>{label}</button>
            ))}
          </div>
        }
      />
      <CoverageNote>
        Inbound call data is uploaded {data.coverage.from ? fullDay(data.coverage.from) : "—"} to {data.coverage.to ? fullDay(data.coverage.to) : "—"}.
        {data.effectiveTo < data.to && <> Figures cover {fullDay(data.from)} – {fullDay(data.effectiveTo)}; the previous period is the same number of days before ({fullDay(data.prevFrom)} – {fullDay(data.prevTo)}).</>}
        {" "}Only months that hold inbound calls get a column, and the mock-up's "abandoned before / within / after window" split isn't shown — the data has no operating-window definition.
      </CoverageNote>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <CcTile icon={PhoneIncoming} label="Call Offered" value={fmtNum(k.offered)} tone="bg-blue-100 text-blue-700" delta={deltaOf(k.offered, p?.offered, "pct", true)} onClick={() => openDay(data.from, data.effectiveTo, "Call Offered")} />
        <CcTile icon={PhoneCall} label="Call Answered" value={fmtNum(k.answered)} tone="bg-amber-100 text-amber-700" delta={deltaOf(k.answered, p?.answered, "pct", true)} onClick={() => openDay(data.from, data.effectiveTo, "Call Answered")} />
        <CcTile icon={TrendingUp} label="AL %" value={fmtPctVal(k.alPct)} tone="" ring={k.alPct} sub="answered / offered · vs previous" delta={deltaOf(k.alPct, p?.alPct, "pp", true)} />
        <CcTile icon={AlertTriangle} label="Abn Calls" value={fmtNum(k.abn)} tone="bg-rose-100 text-rose-700" delta={deltaOf(k.abn, p?.abn, "pct", false)} onClick={() => openDay(data.from, data.effectiveTo, "Abn Calls")} />
        <CcTile icon={PhoneOff} label="Abn %" value={fmtPctVal(k.abnPct)} tone="bg-violet-100 text-violet-700" delta={deltaOf(k.abnPct, p?.abnPct, "pp", false)} sub="abn / offered · vs previous" />
        <CcTile icon={Clock} label="Avg. Talk Time" value={fmtClock(k.avgTalkS)} tone="bg-sky-100 text-sky-700" delta={deltaOf(k.avgTalkS, p?.avgTalkS, "pct", true)} />
        <CcTile icon={Clock} label="AHT" value={fmtClock(k.ahtS)} tone="bg-sky-100 text-sky-700" delta={deltaOf(k.ahtS, p?.ahtS, "pct", false)} sub="handling time / answered" />
      </div>

      {/* trend + abandon breakup + unique vs repeat */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <CcPanel title="Call Offered vs Answered Trend" icon={PhoneMissed}>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={trend} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}
              onClick={(s: unknown) => { const d = (s as { activePayload?: Array<{ payload?: Day }> } | null)?.activePayload?.[0]?.payload; if (d) openDay(d.date, d.date, fullDay(d.date)); }} style={{ cursor: "pointer" }}>
              <defs>
                <linearGradient id="awinOff" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3b82f6" stopOpacity={0.3} /><stop offset="100%" stopColor="#3b82f6" stopOpacity={0.02} /></linearGradient>
                <linearGradient id="awinAns" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10b981" stopOpacity={0.35} /><stop offset="100%" stopColor="#10b981" stopOpacity={0.02} /></linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="x" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
              <Tooltip {...TOOLTIP_PROPS} /><Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
              <Area type="monotone" dataKey="offered" name="Call Offered" stroke="#3b82f6" strokeWidth={2} fill="url(#awinOff)" dot={{ r: 3 }} />
              <Area type="monotone" dataKey="answered" name="Call Answered" stroke="#10b981" strokeWidth={2} fill="url(#awinAns)" dot={{ r: 3 }} />
            </AreaChart>
          </ResponsiveContainer>
        </CcPanel>

        <CcPanel title="Abandoned Calls Breakup" icon={AlertTriangle}>
          {k.abn === 0 ? <p className="py-16 text-center text-xs text-slate-400">No abandoned calls in this range.</p> : (
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative h-[150px] w-[150px] shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart><Pie data={abnDonut} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="94%" paddingAngle={2} stroke="none" label={false}>
                    {abnDonut.map((s) => <Cell key={s.name} fill={s.color} />)}
                  </Pie><Tooltip {...TOOLTIP_PROPS} /></PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><span className="text-xl font-extrabold text-indigo-950">{fmtNum(k.abn)}</span><span className="text-[9px] font-semibold text-slate-500">Total Abn Calls</span></div>
              </div>
              <ul className="min-w-0 flex-1 space-y-2 text-xs">
                {abnDonut.map((s) => (
                  <li key={s.name} className="flex items-center gap-2"><span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                    <span className="min-w-0 flex-1 text-slate-600">{s.name}</span><span className="font-bold text-indigo-950">{fmtNum(s.value)} <span className="font-medium text-slate-500">({fmtPctVal((s.value / k.abn) * 100)})</span></span></li>
                ))}
              </ul>
            </div>
          )}
        </CcPanel>

        <CcPanel title="Unique vs Repeat Calls" icon={Repeat2}>
          <div className="space-y-3 pt-2">
            {[
              { label: "Unique Calls", v: k.uniqueCalls, w: (k.uniqueCalls / maxUR) * 100, cls: "bg-indigo-500", text: fmtNum(k.uniqueCalls) },
              { label: "Repeat Calls", v: k.repeatCalls, w: (k.repeatCalls / maxUR) * 100, cls: "bg-blue-500", text: fmtNum(k.repeatCalls) },
              { label: "Repeat %", v: k.repeatPct, w: k.repeatPct, cls: "bg-violet-500", text: fmtPctVal(k.repeatPct) },
            ].map((r) => (
              <div key={r.label} className="flex items-center gap-2 text-xs">
                <span className="w-20 shrink-0 text-right font-medium text-slate-600">{r.label}</span>
                <div className="h-7 flex-1 rounded bg-slate-200"><div className={`flex h-full items-center justify-end rounded pr-2 text-[11px] font-bold text-white ${r.cls}`} style={{ width: `${Math.max(r.w, r.v > 0 ? 14 : 0)}%` }}>{r.text}</div></div>
              </div>
            ))}
            <p className="text-[10px] text-slate-400">Unique = distinct callers in the window; Repeat = calls beyond a caller's first.</p>
          </div>
        </CcPanel>
      </div>

      {/* monthly / weekly KPI grid + daily details */}
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <CcPanel title="Inbound Call KPIs (Monthly / Weekly)" icon={Users}>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-center text-[11px]">
              <thead><tr className="bg-indigo-950 text-white"><th className="px-2 py-1.5 text-left font-bold">KPI</th>{data.columns.map((c) => <th key={c.key} className="whitespace-nowrap px-2 py-1.5 font-bold" title={`${fullDay(c.from)} – ${fullDay(c.to)}`}>{c.label}</th>)}</tr></thead>
              <tbody>
                {GRID_ROWS.map((r) => (
                  <tr key={r.label} className="border-t border-slate-100 bg-white">
                    <td className={`whitespace-nowrap px-2 py-1 text-left ${r.bold ? "font-extrabold text-indigo-900" : "font-semibold text-indigo-900"}`}>{r.label}</td>
                    {data.columns.map((c) => { const g = data.grid[c.key]; return <td key={c.key} onClick={() => openDay(c.from, c.to, c.label)} className={`cursor-pointer px-2 py-1 ${r.tint ? r.tint(g) : "bg-yellow-50 text-slate-700"} ${r.bold ? "font-bold" : ""}`}>{r.get(g)}</td>; })}
                  </tr>
                ))}
                {data.columns.length === 0 && <tr><td className="py-4 text-slate-400">No inbound calls uploaded yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </CcPanel>

        <CcPanel title="Inbound Call KPIs (Daily Details)" icon={CalendarDays}>
          <div className="max-h-[430px] overflow-auto rounded-lg border border-slate-200">
            <table className="w-full text-center text-[11px]">
              <thead><tr className="sticky top-0 bg-indigo-950 text-white">{["Date", "Call Offered", "Call Answered", "AL %", "Abn Calls", "Abn %", "Unique Calls", "Repeat Calls", "Avg. Talk Time", "AHT"].map((h) => <th key={h} className="whitespace-nowrap px-2 py-1.5 font-bold">{h}</th>)}</tr></thead>
              <tbody>
                {data.daily.map((d) => {
                  const has = d.offered > 0;
                  return (
                    <tr key={d.date} onClick={() => openDay(d.date, d.date, fullDay(d.date))} className="cursor-pointer border-t border-slate-100 bg-white hover:bg-indigo-50">
                      <td className="whitespace-nowrap px-2 py-1 font-semibold text-slate-700">{fullDay(d.date)}</td>
                      <td className="px-2 py-1">{has ? fmtNum(d.offered) : "—"}</td><td className="px-2 py-1">{has ? fmtNum(d.answered) : "—"}</td>
                      <td className={`px-2 py-1 font-bold ${rateTint(d.alPct, true, has)}`}>{has ? fmtPctVal(d.alPct) : "—"}</td>
                      <td className="px-2 py-1">{has ? fmtNum(d.abn) : "—"}</td>
                      <td className={`px-2 py-1 font-bold ${rateTint(d.abnPct * 4, false, has)}`}>{has ? fmtPctVal(d.abnPct) : "—"}</td>
                      <td className="px-2 py-1">{has ? fmtNum(d.uniqueCalls) : "—"}</td><td className="px-2 py-1">{has ? fmtNum(d.repeatCalls) : "—"}</td>
                      <td className="px-2 py-1">{d.answered ? fmtClock(d.avgTalkS) : "—"}</td><td className="px-2 py-1">{d.answered ? fmtClock(d.ahtS) : "—"}</td>
                    </tr>
                  );
                })}
                {data.daily.length === 0 && <tr><td colSpan={10} className="py-4 text-slate-400">No inbound calls in this range.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-[10px] text-slate-400">A dash means no inbound call was recorded that day (e.g. no upload).</p>
        </CcPanel>
      </div>
    </CcShell>
  );
}
