import { useEffect, useMemo, useState } from "react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, BarChart,
} from "recharts";
import {
  PhoneCall, PhoneIncoming, PhoneOff, Target, Users, Clock, Timer, CalendarDays, UserX, Gauge as GaugeIcon, Hourglass, Coffee,
  TrendingUp, PieChart as PieIcon, IndianRupee, ListChecks, AlertTriangle, Layers,
} from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Spinner } from "./DashboardKit";
import type { DrawerTarget } from "./AppreciateWealthDrawer";
import {
  TOOLTIP_PROPS, fmtHms, fmtNum, fmtPctVal, deltaOf, CcShell, CcHeader, CcPanel, CcTile, CoverageNote,
} from "./AwControlKit";

/**
 * Appreciate Wealth -- "Outbound Performance Dashboard". Every figure is live
 * from GET /appreciate-wealth/outbound-center (aw_out, the Outbound agent-day
 * uploader); appreciate-wealth-outbound-center.service.ts documents each
 * formula. The mock-up's "US SIP" product and "MAS Tele" process split have
 * no columns in the upload, so they are not shown.
 */

const API = "/api/process-performance/appreciate-wealth";
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDay = (iso: string) => `${iso.slice(8, 10)}-${MON[Number(iso.slice(5, 7)) - 1]}`;
const fullDay = (iso: string) => `${iso.slice(8, 10)}-${MON[Number(iso.slice(5, 7)) - 1]}-${iso.slice(2, 4)}`;
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const inrShort = (n: number) => (Math.abs(n) >= 10000000 ? `₹${Math.round(n / 100000) / 100}Cr` : Math.abs(n) >= 100000 ? `₹${Math.round(n / 1000) / 100}L` : inr(n));
const secLabel = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const TOTAL_TH = "sticky top-0 whitespace-nowrap bg-indigo-950 px-2 py-1.5 font-bold text-white";

interface Kpis {
  agentDays: number; agents: number; calls: number; target: number; achPct: number;
  connected: number; notConnected: number; connectedPct: number; avgConnectedPerAgentDay: number; avgNotConnectedPerAgentDay: number;
  talkS: number; avgTalkS: number; ahtNoPickS: number; ahtWithPickS: number; mandays: number; mandaysMissing: number;
  lateDays: number; latePct: number; occCallingPct: number; occNetPct: number; occOverallPct: number;
  wrapExceedDays: number; breakExceedDays: number;
  loginS: number; netS: number; wrapS: number; pauseS: number; idleS: number; pickS: number;
  agentDisc: number; custDisc: number; belowTargetDays: number;
  lrsT: number; lrsC: number; lrsA: number; trT: number; trC: number; trA: number; mfT: number; mfC: number; mfA: number;
  salesT: number; salesA: number; salesC: number;
}
interface Day extends Kpis { date: string }
interface Agent extends Kpis { agentId: string; name: string; empId: string; callsPerHr: number }
interface Data {
  from: string; to: string; effectiveTo: string; prevFrom: string; prevTo: string;
  coverage: { from: string | null; to: string | null; agentsInFile: number; teams: string[]; excluded: { agentDays: number; calls: number } };
  kpis: Kpis; prev: Kpis | null; daily: Day[]; agents: Agent[];
  status: { active: number; inactive: number; inactiveAgents: Array<{ agentId: string; name: string }>; activeAgents: Array<{ agentId: string; name: string }> };
  products: Array<{ key: "lrs" | "trade" | "mf"; label: string; target: number; achieved: number; count: number; effPct: number; avgTicket: number; salesPerConnectedPct: number }>;
  time: Array<{ key: string; label: string; seconds: number; pctOfLogin: number }>;
}

const effTint = (v: number, has: boolean) => (!has ? "text-slate-400" : v >= 100 ? "bg-emerald-200 font-bold text-emerald-900" : v >= 60 ? "bg-amber-100 font-bold text-amber-900" : "bg-rose-200 font-bold text-rose-900");
const lateTint = (v: number) => (v >= 50 ? "bg-rose-200 font-bold text-rose-800" : v > 0 ? "bg-amber-100 font-bold text-amber-800" : "text-slate-600");

export function AppreciateWealthOutboundCenter({ from, to, onOpen }: { from: string; to: string; onOpen: (t: DrawerTarget) => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    hrmsApi.get<{ success: boolean; data: Data }>(`${API}/outbound-center?from=${from}&to=${to}`)
      .then((res) => { if (!cancelled) setData(res.data); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Unable to load the outbound dashboard."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [from, to]);

  const trend = useMemo(() => (data?.daily ?? []).map((d) => ({ ...d, x: shortDay(d.date) })), [data]);

  if (loading && !data) return <Spinner tone="blue" />;
  if (error) return <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return null;

  const k = data.kpis; const p = data.prev;
  const openDay = (a: string, b: string, label: string) => onOpen({ kind: "day", from: a, to: b, label });
  const openAll = (label: string) => openDay(data.from, data.effectiveTo, label);
  const openAgent = (id: string) => onOpen({ kind: "agent", key: id });
  const rangeLabel = `${fullDay(data.from)} – ${fullDay(data.effectiveTo)}`;
  const disposition = [
    { name: "Connected", value: k.connected, color: "#10b981" },
    { name: "Not Connected", value: k.notConnected, color: "#f43f5e" },
  ];
  const agentStatus = [
    { name: "Active", value: data.status.active, color: "#4f46e5" },
    { name: "Inactive", value: data.status.inactive, color: "#94a3b8" },
  ].filter((s) => s.value > 0);
  const productBars = data.products.map((x) => ({ name: x.label, Target: x.target, Achieved: x.achieved, effPct: x.effPct }));
  const timeRow = (key: string) => data.time.find((t) => t.key === key);

  const TH = ["Agent", "Days", "Calls Target", "Calls Actual", "Calls / hr", "Connected", "Not Connected", "Connectivity %", "Late Login %", "Occupancy %", "Talk Time", "AHT (with pick)"];
  const PRODUCT_COLS: Array<{ label: string; t: keyof Kpis; a: keyof Kpis }> = [
    { label: "LRS", t: "lrsT", a: "lrsA" }, { label: "Trade", t: "trT", a: "trA" }, { label: "Mutual Funds", t: "mfT", a: "mfA" },
  ];

  return (
    <CcShell>
      <CcHeader
        title="Appreciate Wealth — Outbound Performance Dashboard"
        subtitle={`Outbound calling & sales · ${rangeLabel}${data.coverage.teams.length ? ` · ${data.coverage.teams.join(", ")}` : ""}`}
      />
      <CoverageNote>
        Outbound agent-day data is uploaded {data.coverage.from ? fullDay(data.coverage.from) : "—"} to {data.coverage.to ? fullDay(data.coverage.to) : "—"} ({data.coverage.agentsInFile} agents).
        {data.effectiveTo < data.to && <> Figures cover {fullDay(data.from)} – {fullDay(data.effectiveTo)} (the last uploaded day).</>}
        {" "}{p ? "Deltas compare with the same number of days before." : "No earlier upload exists, so no comparison deltas are shown."}
        {data.coverage.excluded.agentDays > 0 && <> {data.coverage.excluded.agentDays} placeholder agent-days with no login time ({data.coverage.excluded.calls} calls) are left out of every total, target and average.</>}
        {" "}The mock-up's US SIP product has no columns in the upload and is not shown.
      </CoverageNote>

      {/* KPI row 1 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <CcTile icon={PhoneCall} label="Total Calls" value={fmtNum(k.calls)} sub={`Target ${fmtNum(k.target)}`} tone="" ring={k.achPct} delta={deltaOf(k.calls, p?.calls, "pct", true)} onClick={() => openAll("Total Calls")} />
        <CcTile icon={PhoneIncoming} label="Connected Calls" value={fmtNum(k.connected)} sub={`Avg ${k.avgConnectedPerAgentDay} / agent-day`} tone="bg-emerald-100 text-emerald-700" delta={deltaOf(k.connected, p?.connected, "pct", true)} onClick={() => openAll("Connected Calls")} />
        <CcTile icon={PhoneOff} label="Not Connected" value={fmtNum(k.notConnected)} sub={`Avg ${k.avgNotConnectedPerAgentDay} / agent-day`} tone="bg-rose-100 text-rose-700" delta={deltaOf(k.notConnected, p?.notConnected, "pct", false)} onClick={() => openAll("Not Connected")} />
        <CcTile icon={Target} label="Calling Achievement" value={fmtPctVal(k.achPct)} sub="calls ÷ calling target" tone="bg-indigo-100 text-indigo-700" delta={deltaOf(k.achPct, p?.achPct, "pp", true)} onClick={() => openAll("Calling Achievement")} />
        <CcTile icon={Users} label="Total Agents (Active)" value={fmtNum(k.agents)} sub={`${k.agentDays} agent-days`} tone="bg-sky-100 text-sky-700" delta={deltaOf(k.agents, p?.agents, "pct", true)} onClick={() => openAll("Active agents")} />
        <CcTile icon={Clock} label="Total Talk Time" value={fmtHms(k.talkS)} sub={`Avg ${secLabel(k.avgTalkS)} / connected`} tone="bg-violet-100 text-violet-700" delta={deltaOf(k.talkS, p?.talkS, "pct", true)} onClick={() => openAll("Total Talk Time")} />
        <CcTile icon={Timer} label="AHT (w/o Pick)" value={secLabel(k.ahtNoPickS)} sub="(talk+wrap) ÷ connected" tone="bg-amber-100 text-amber-700" delta={deltaOf(k.ahtNoPickS, p?.ahtNoPickS, "pct", false)} onClick={() => openAll("AHT")} />
        <CcTile icon={Timer} label="AHT (with Pick)" value={secLabel(k.ahtWithPickS)} sub="(talk+wrap+pickup) ÷ calls" tone="bg-orange-100 text-orange-700" delta={deltaOf(k.ahtWithPickS, p?.ahtWithPickS, "pct", false)} onClick={() => openAll("AHT with pickup")} />
      </div>

      {/* KPI row 2 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <CcTile icon={CalendarDays} label="Actual Mandays" value={String(k.mandays)} sub={k.mandaysMissing ? `${k.mandaysMissing} agent-days blank` : "sum of actual_mandays"} tone="bg-blue-100 text-blue-700" delta={deltaOf(k.mandays, p?.mandays, "pct", true)} onClick={() => openAll("Actual Mandays")} />
        <CcTile icon={UserX} label="Late Login %" value={fmtPctVal(k.latePct)} sub={`${k.lateDays} of ${k.agentDays} agent-days`} tone="bg-amber-100 text-amber-700" delta={deltaOf(k.latePct, p?.latePct, "pp", false)} onClick={() => openAll("Late logins")} />
        <CcTile icon={GaugeIcon} label="Occupancy % (Calling)" value={fmtPctVal(k.occCallingPct)} sub="(talk+wrap+pick) ÷ (…+idle)" tone="bg-emerald-100 text-emerald-700" delta={deltaOf(k.occCallingPct, p?.occCallingPct, "pp", true)} onClick={() => openAll("Occupancy")} />
        <CcTile icon={GaugeIcon} label="Occupancy % (Net Login)" value={fmtPctVal(k.occNetPct)} sub="(talk+wrap) ÷ net login" tone="bg-indigo-100 text-indigo-700" delta={deltaOf(k.occNetPct, p?.occNetPct, "pp", true)} onClick={() => openAll("Occupancy")} />
        <CcTile icon={GaugeIcon} label="Overall Occupancy %" value={fmtPctVal(k.occOverallPct)} sub="(talk+wrap+pick) ÷ gross login" tone="bg-violet-100 text-violet-700" delta={deltaOf(k.occOverallPct, p?.occOverallPct, "pp", true)} onClick={() => openAll("Occupancy")} />
        <CcTile icon={Hourglass} label="Wrap Exceed > 1 Hr" value={fmtNum(k.wrapExceedDays)} sub="agent-days flagged" tone="bg-rose-100 text-rose-700" delta={deltaOf(k.wrapExceedDays, p?.wrapExceedDays, "pct", false)} onClick={() => openAll("Wrap exceed")} />
        <CcTile icon={Coffee} label="Break Exceed > 1 Hr" value={fmtNum(k.breakExceedDays)} sub="agent-days flagged" tone="bg-orange-100 text-orange-700" delta={deltaOf(k.breakExceedDays, p?.breakExceedDays, "pct", false)} onClick={() => openAll("Break exceed")} />
      </div>

      {/* charts */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,0.8fr)] xl:grid-cols-[minmax(0,1.5fr)_minmax(0,0.7fr)_minmax(0,1.1fr)_minmax(0,0.7fr)]">
        <CcPanel title="Calling Trend (Target vs Actual)" icon={TrendingUp}>
          {trend.length === 0 ? <p className="py-10 text-center text-xs text-slate-400">None</p> : (
            <ResponsiveContainer width="100%" height={230}>
              <ComposedChart data={trend} margin={{ top: 4, right: 4, left: -14, bottom: 0 }} style={{ cursor: "pointer" }}
                onClick={(s: unknown) => { const d = (s as { activePayload?: Array<{ payload?: Day }> } | null)?.activePayload?.[0]?.payload; if (d) openDay(d.date, d.date, fullDay(d.date)); }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="x" tick={{ fontSize: 10 }} />
                <YAxis yAxisId="l" tick={{ fontSize: 10 }} />
                <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10 }} unit="%" />
                <Tooltip {...TOOLTIP_PROPS} /><Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
                <Bar yAxisId="l" dataKey="target" name="Target" fill="#c7d2fe" radius={[4, 4, 0, 0]} />
                <Bar yAxisId="l" dataKey="calls" name="Actual" fill="#4338ca" radius={[4, 4, 0, 0]} />
                <Line yAxisId="r" type="monotone" dataKey="achPct" name="Achievement %" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CcPanel>

        <CcPanel title="Call Disposition" icon={PieIcon}>
          <div className="relative h-[170px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart><Pie data={disposition} dataKey="value" nameKey="name" innerRadius="60%" outerRadius="94%" paddingAngle={2} stroke="none" label={false}
                onClick={(d: { name?: string }) => openAll(`${d.name ?? "Calls"}`)} style={{ cursor: "pointer" }}>
                {disposition.map((s) => <Cell key={s.name} fill={s.color} />)}
              </Pie><Tooltip {...TOOLTIP_PROPS} formatter={(v: number) => fmtNum(Number(v))} /></PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><span className="text-lg font-extrabold text-indigo-950">{fmtPctVal(k.connectedPct)}</span><span className="text-[9px] font-semibold text-slate-500">Connected</span></div>
          </div>
          <ul className="mt-1 space-y-1 text-[11px]">
            {disposition.map((s) => (
              <li key={s.name} className="flex items-center justify-between gap-2"><span className="flex items-center gap-1.5 font-medium text-slate-700"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />{s.name}</span><span className="font-bold text-indigo-950">{fmtNum(s.value)} <span className="font-medium text-slate-500">({fmtPctVal(k.calls > 0 ? (s.value / k.calls) * 100 : 0)})</span></span></li>
            ))}
          </ul>
        </CcPanel>

        <CcPanel title="Process-wise Achievement (₹)" icon={IndianRupee}>
          <ResponsiveContainer width="100%" height={190}>
            <BarChart data={productBars} margin={{ top: 4, right: 4, left: -8, bottom: 0 }} style={{ cursor: "pointer" }} onClick={() => onOpen({ kind: "source", table: "aw_out" })}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => inrShort(v)} />
              <Tooltip {...TOOLTIP_PROPS} formatter={(v: number) => inr(Number(v))} /><Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
              <Bar dataKey="Target" fill="#c7d2fe" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Achieved" fill="#10b981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-1 grid grid-cols-3 gap-1.5">
            {data.products.map((x) => (
              <div key={x.key} className="rounded-lg bg-white px-2 py-1 text-center">
                <p className="text-[10px] font-semibold text-slate-500">{x.label}</p>
                <p className={`rounded text-sm font-extrabold ${effTint(x.effPct, x.target > 0)}`}>{fmtPctVal(x.effPct)}</p>
              </div>
            ))}
          </div>
        </CcPanel>

        <CcPanel title="Agent Status" icon={Users}>
          <div className="relative h-[170px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart><Pie data={agentStatus} dataKey="value" nameKey="name" innerRadius="60%" outerRadius="94%" paddingAngle={2} stroke="none" label={false}>
                {agentStatus.map((s) => <Cell key={s.name} fill={s.color} />)}
              </Pie><Tooltip {...TOOLTIP_PROPS} /></PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><span className="text-lg font-extrabold text-indigo-950">{data.status.active + data.status.inactive}</span><span className="text-[9px] font-semibold text-slate-500">Agents</span></div>
          </div>
          <ul className="mt-1 space-y-1 text-[11px]">
            <li className="flex items-center justify-between"><span className="flex items-center gap-1.5 font-medium text-slate-700"><span className="h-2.5 w-2.5 rounded-full bg-indigo-600" />Active</span><span className="font-bold text-indigo-950">{data.status.active}</span></li>
            <li className="flex items-center justify-between"><span className="flex items-center gap-1.5 font-medium text-slate-700"><span className="h-2.5 w-2.5 rounded-full bg-slate-400" />Inactive</span><span className="font-bold text-indigo-950">{data.status.inactive}</span></li>
          </ul>
          {data.status.inactiveAgents.length > 0 && (
            <p className="mt-1 text-[10px] text-slate-500">Inactive (no login in range): {data.status.inactiveAgents.map((a, i) => (
              <span key={a.agentId}>{i > 0 && ", "}<button type="button" className="font-semibold text-indigo-700 hover:underline" onClick={() => openAgent(a.agentId)}>{a.name}</button></span>
            ))}</p>
          )}
        </CcPanel>
      </div>

      {/* agent-wise table */}
      <CcPanel title="Agent Wise Performance" icon={Users}>
        <div className="max-h-[420px] overflow-auto rounded-lg border border-slate-200">
          <table className="w-full text-center text-[11px]">
            <thead>
              <tr>
                <th rowSpan={2} className={`${TOTAL_TH} left-0 z-20 text-left`}>{TH[0]}</th>
                {TH.slice(1).map((h) => <th key={h} rowSpan={2} className={TOTAL_TH}>{h}</th>)}
                {PRODUCT_COLS.map((c) => <th key={c.label} colSpan={3} className="sticky top-0 whitespace-nowrap border-l border-indigo-800 bg-indigo-900 px-2 py-1.5 font-bold text-white">{c.label} (₹)</th>)}
              </tr>
              <tr>{PRODUCT_COLS.map((c) => ["Target", "Achieved", "Eff %"].map((h) => <th key={`${c.label}${h}`} className="sticky top-[30px] whitespace-nowrap border-l border-indigo-800 bg-indigo-900 px-2 py-1 font-semibold text-indigo-100">{h}</th>))}</tr>
            </thead>
            <tbody>
              {data.agents.map((a, i) => (
                <tr key={a.agentId} onClick={() => openAgent(a.agentId)} className={`cursor-pointer hover:bg-indigo-50 ${i % 2 ? "bg-slate-50" : "bg-white"}`}>
                  <td className={`sticky left-0 z-10 whitespace-nowrap px-2 py-1 text-left font-semibold text-slate-700 ${i % 2 ? "bg-slate-50" : "bg-white"}`}>{a.name}</td>
                  <td className="px-2 py-1">{a.agentDays}</td>
                  <td className="px-2 py-1">{fmtNum(a.target)}</td>
                  <td className="px-2 py-1 font-bold text-indigo-950">{fmtNum(a.calls)}</td>
                  <td className="px-2 py-1">{a.callsPerHr}</td>
                  <td className="px-2 py-1">{fmtNum(a.connected)}</td>
                  <td className="px-2 py-1">{fmtNum(a.notConnected)}</td>
                  <td className="px-2 py-1">{fmtPctVal(a.connectedPct)}</td>
                  <td className={`px-2 py-1 ${lateTint(a.latePct)}`}>{fmtPctVal(a.latePct)}</td>
                  <td className="px-2 py-1">{fmtPctVal(a.occNetPct)}</td>
                  <td className="px-2 py-1">{fmtHms(a.talkS)}</td>
                  <td className="px-2 py-1">{secLabel(a.ahtWithPickS)}</td>
                  {PRODUCT_COLS.map((c) => {
                    const t = a[c.t] as number; const v = a[c.a] as number;
                    return [
                      <td key={`${c.label}t`} className="border-l border-slate-200 px-2 py-1">{t > 0 ? inr(t) : "—"}</td>,
                      <td key={`${c.label}a`} className="px-2 py-1">{inr(v)}</td>,
                      <td key={`${c.label}e`} className={`px-2 py-1 ${effTint(t > 0 ? (v / t) * 100 : 0, t > 0)}`}>{t > 0 ? fmtPctVal((v / t) * 100) : "—"}</td>,
                    ];
                  })}
                </tr>
              ))}
              {data.agents.length === 0 && <tr><td colSpan={12 + PRODUCT_COLS.length * 3} className="py-4 text-slate-400">None</td></tr>}
              {data.agents.length > 0 && (
                <tr className="sticky bottom-0 bg-indigo-950 font-extrabold text-white">
                  <td className="sticky left-0 z-10 bg-indigo-950 px-2 py-1.5 text-left">Grand Total</td>
                  <td className="px-2 py-1.5">{k.agentDays}</td>
                  <td className="px-2 py-1.5">{fmtNum(k.target)}</td>
                  <td className="px-2 py-1.5">{fmtNum(k.calls)}</td>
                  <td className="px-2 py-1.5">{k.netS > 0 ? Math.round((k.calls / (k.netS / 3600)) * 10) / 10 : 0}</td>
                  <td className="px-2 py-1.5">{fmtNum(k.connected)}</td>
                  <td className="px-2 py-1.5">{fmtNum(k.notConnected)}</td>
                  <td className="px-2 py-1.5">{fmtPctVal(k.connectedPct)}</td>
                  <td className="px-2 py-1.5">{fmtPctVal(k.latePct)}</td>
                  <td className="px-2 py-1.5">{fmtPctVal(k.occNetPct)}</td>
                  <td className="px-2 py-1.5">{fmtHms(k.talkS)}</td>
                  <td className="px-2 py-1.5">{secLabel(k.ahtWithPickS)}</td>
                  {PRODUCT_COLS.map((c) => {
                    const t = k[c.t] as number; const v = k[c.a] as number;
                    return [
                      <td key={`${c.label}t`} className="border-l border-indigo-800 px-2 py-1.5">{t > 0 ? inr(t) : "—"}</td>,
                      <td key={`${c.label}a`} className="px-2 py-1.5">{inr(v)}</td>,
                      <td key={`${c.label}e`} className="px-2 py-1.5">{t > 0 ? fmtPctVal((v / t) * 100) : "—"}</td>,
                    ];
                  })}
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-[10px] text-slate-400">Calls / hr = calls ÷ net login hours. Occupancy % = (talk + wrap) ÷ net login. Click an agent for the full agent record.</p>
      </CcPanel>

      {/* summaries */}
      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
        <CcPanel title="Overall Summary" icon={ListChecks}>
          <SummaryTable rows={[
            ["Agent-days worked", fmtNum(k.agentDays)],
            ["Calling target", fmtNum(k.target)],
            ["Calls made", fmtNum(k.calls)],
            ["Achievement", fmtPctVal(k.achPct)],
            ["Connected", `${fmtNum(k.connected)} (${fmtPctVal(k.connectedPct)})`],
            ["Not connected", fmtNum(k.notConnected)],
            ["Avg talk / connected call", secLabel(k.avgTalkS)],
            ["AHT (w/o pick)", secLabel(k.ahtNoPickS)],
            ["Agent-days below target", `${k.belowTargetDays} of ${k.agentDays}`],
          ]} onRow={() => openAll("Overall summary")} />
        </CcPanel>

        <CcPanel title="Revenue / Conversion Summary" icon={IndianRupee}>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-center text-[11px]">
              <thead><tr>{["Product", "Sales", "Amount", "Avg ticket", "Sales ÷ connected"].map((h) => <th key={h} className={TOTAL_TH}>{h}</th>)}</tr></thead>
              <tbody>
                {data.products.map((x, i) => (
                  <tr key={x.key} onClick={() => onOpen({ kind: "source", table: "aw_out" })} className={`cursor-pointer hover:bg-indigo-50 ${i % 2 ? "bg-slate-50" : "bg-white"}`}>
                    <td className="px-2 py-1 text-left font-semibold text-slate-700">{x.label}</td>
                    <td className="px-2 py-1">{fmtNum(x.count)}</td>
                    <td className="px-2 py-1">{inr(x.achieved)}</td>
                    <td className="px-2 py-1">{x.count > 0 ? inr(x.avgTicket) : "—"}</td>
                    <td className="px-2 py-1">{fmtPctVal(x.salesPerConnectedPct)}</td>
                  </tr>
                ))}
                <tr className="bg-indigo-950 font-extrabold text-white">
                  <td className="px-2 py-1 text-left">Total</td><td className="px-2 py-1">{fmtNum(k.salesC)}</td><td className="px-2 py-1">{inr(k.salesA)}</td>
                  <td className="px-2 py-1">{k.salesC > 0 ? inr(k.salesA / k.salesC) : "—"}</td><td className="px-2 py-1">{fmtPctVal(k.connected > 0 ? (k.salesC / k.connected) * 100 : 0)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-[10px] text-slate-400">Overall target {inr(k.salesT)} · achieved {fmtPctVal(k.salesT > 0 ? (k.salesA / k.salesT) * 100 : 0)}. The upload's own conversion columns are all zero, so sales ÷ connected calls is shown instead.</p>
        </CcPanel>

        <CcPanel title="Time Analysis (Total Hours)" icon={Clock}>
          <div className="max-h-[300px] overflow-auto rounded-lg border border-slate-200">
            <table className="w-full text-center text-[11px]">
              <thead><tr>{["Bucket", "Hours", "% of login"].map((h) => <th key={h} className={TOTAL_TH}>{h}</th>)}</tr></thead>
              <tbody>
                {data.time.filter((t) => t.seconds > 0 || ["login", "net", "talk", "wrap", "idle", "pause"].includes(t.key)).map((t, i) => (
                  <tr key={t.key} className={i % 2 ? "bg-slate-50" : "bg-white"}>
                    <td className="px-2 py-1 text-left font-semibold text-slate-700">{t.label}</td>
                    <td className="px-2 py-1">{fmtHms(t.seconds)}</td>
                    <td className="px-2 py-1">{t.key === "login" ? "—" : fmtPctVal(t.pctOfLogin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-[10px] text-slate-400">Sums over active agent-days. Pause covers all AUX codes; the rows below it are the individual codes the upload carries.</p>
        </CcPanel>

        <CcPanel title="Behaviour & Exceptions" icon={AlertTriangle}>
          <SummaryTable rows={[
            ["Late logins", `${k.lateDays} (${fmtPctVal(k.latePct)})`],
            ["Wrap exceed > 1 hr", `${k.wrapExceedDays} agent-days`],
            ["Break exceed > 1 hr", `${k.breakExceedDays} agent-days`],
            ["Days below calling target", `${k.belowTargetDays} of ${k.agentDays}`],
            ["Agent-initiated disconnects", `${fmtNum(k.agentDisc)}${k.connected > 0 ? ` (${fmtPctVal((k.agentDisc / k.connected) * 100)} of connected)` : ""}`],
            ["Customer-initiated disconnects", fmtNum(k.custDisc)],
            ["Idle time", `${fmtHms(k.idleS)} (${fmtPctVal(timeRow("idle")?.pctOfLogin ?? 0)} of login)`],
            ["Pause / AUX time", `${fmtHms(k.pauseS)} (${fmtPctVal(timeRow("pause")?.pctOfLogin ?? 0)} of login)`],
          ]} onRow={() => openAll("Behaviour & exceptions")} />
          <p className="mt-1 text-[10px] text-slate-400">Disconnect counts are the upload's customer_disconnect / agent_disconnect columns; the exceed flags are the upload's own wrap_exceed / break_exceed columns.</p>
        </CcPanel>
      </div>

      <CcPanel title="Daily Details" icon={Layers}>
        <div className="max-h-[300px] overflow-auto rounded-lg border border-slate-200">
          <table className="w-full text-center text-[11px]">
            <thead><tr>{["Date", "Agents", "Calls Target", "Calls Actual", "Achievement %", "Connected", "Connectivity %", "Late Login %", "Occupancy %", "Sales ₹ Target", "Sales ₹ Achieved", "Eff %"].map((h) => <th key={h} className={TOTAL_TH}>{h}</th>)}</tr></thead>
            <tbody>
              {data.daily.map((d, i) => (
                <tr key={d.date} onClick={() => openDay(d.date, d.date, fullDay(d.date))} className={`cursor-pointer hover:bg-indigo-50 ${i % 2 ? "bg-slate-50" : "bg-white"}`}>
                  <td className="whitespace-nowrap px-2 py-1 font-semibold text-slate-700">{fullDay(d.date)}</td>
                  <td className="px-2 py-1">{d.agents}</td>
                  <td className="px-2 py-1">{fmtNum(d.target)}</td>
                  <td className="px-2 py-1 font-bold text-indigo-950">{fmtNum(d.calls)}</td>
                  <td className={`px-2 py-1 ${effTint(d.achPct, d.target > 0)}`}>{fmtPctVal(d.achPct)}</td>
                  <td className="px-2 py-1">{fmtNum(d.connected)}</td>
                  <td className="px-2 py-1">{fmtPctVal(d.connectedPct)}</td>
                  <td className={`px-2 py-1 ${lateTint(d.latePct)}`}>{fmtPctVal(d.latePct)}</td>
                  <td className="px-2 py-1">{fmtPctVal(d.occNetPct)}</td>
                  <td className="px-2 py-1">{inr(d.salesT)}</td>
                  <td className="px-2 py-1">{inr(d.salesA)}</td>
                  <td className={`px-2 py-1 ${effTint(d.salesT > 0 ? (d.salesA / d.salesT) * 100 : 0, d.salesT > 0)}`}>{d.salesT > 0 ? fmtPctVal((d.salesA / d.salesT) * 100) : "—"}</td>
                </tr>
              ))}
              {data.daily.length === 0 && <tr><td colSpan={12} className="py-4 text-slate-400">None</td></tr>}
            </tbody>
          </table>
        </div>
      </CcPanel>
    </CcShell>
  );
}

function SummaryTable({ rows, onRow }: { rows: Array<[string, string]>; onRow: () => void }) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <table className="w-full text-[11px]">
        <tbody>
          {rows.map(([label, value], i) => (
            <tr key={label} onClick={onRow} className={`cursor-pointer hover:bg-indigo-50 ${i % 2 ? "bg-slate-50" : "bg-white"}`}>
              <td className="px-2 py-1.5 font-semibold text-slate-600">{label}</td>
              <td className="px-2 py-1.5 text-right font-bold text-indigo-950">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
