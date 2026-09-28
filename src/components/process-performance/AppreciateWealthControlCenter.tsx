import { useEffect, useMemo, useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell,
} from "recharts";
import {
  PhoneCall, Headphones, Percent, Clock, AudioLines, UserX, Gauge as GaugeIcon, Coffee, TrendingUp, Users, CalendarClock, Timer, Globe2,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { hrmsApi } from "@/lib/hrmsApi";
import { Spinner } from "./DashboardKit";
import type { DrawerTarget } from "./AppreciateWealthDrawer";
import {
  TOOLTIP_PROPS, fmtHms, fmtMins, fmtNum, fmtPctVal, deltaOf, DeltaText, CcShell, CcHeader, CcPanel, CcTile, Ring, CoverageNote,
} from "./AwControlKit";

/**
 * Appreciate Wealth -- Agent-wise "Performance Control Center". Every figure
 * is live from GET /appreciate-wealth/control-center, which reuses the same
 * de-duplicated agent-day rows as the other Appreciate Wealth tabs (see
 * appreciate-wealth-control-center.service.ts for each formula). The mock-up's
 * enquiry-channel panel (Meta / IndiaMART / ...) has no data behind it, so it
 * is replaced by the real CDR call-source mix.
 */

const API = "/api/process-performance/appreciate-wealth";
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDay = (iso: string) => `${iso.slice(8, 10)}-${MON[Number(iso.slice(5, 7)) - 1]}`;
const fullDay = (iso: string) => `${iso.slice(8, 10)}-${MON[Number(iso.slice(5, 7)) - 1]}-${iso.slice(2, 4)}`;
const PALETTE = ["#4338ca", "#0ea5e9", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6", "#f97316", "#64748b"];

interface Kpis { agentDays: number; calls: number; connected: number; connectedPct: number; talkS: number; avgTalkPerCallS: number; latePct: number; lateDays: number; productivePct: number; breakAvgS: number; loginS: number }
interface Day { date: string; agentDays: number; calls: number; connected: number; connectedPct: number; talkS: number; productivePct: number; breakS: number; breakAvgS: number; lateDays: number; latePct: number }
interface Agent { agentId: string; name: string; empId: string; segment: string; agentDays: number; calls: number; connected: number; connectedPct: number; talkS: number; productivePct: number; latePct: number; lateDays: number; breakAvgS: number }
interface Data {
  from: string; to: string; effectiveTo: string; prevFrom: string; prevTo: string; segment: string; segments: string[];
  coverage: { billingFrom: string | null; billingTo: string | null; cdrFrom: string | null; cdrTo: string | null };
  kpis: Kpis; prev: Kpis | null; daily: Day[];
  wtd: { anchor: string | null; from: string; to: string; prevFrom: string; prevTo: string; calls: number; connected: number; prevCalls: number; prevConnected: number } | null;
  agents: Agent[];
  heat: { dates: string[]; agents: Array<{ name: string; agentId: string; cells: number[] }> };
  sources: { total: number; items: Array<{ name: string; legs: number; answered: number; source: "inbound" | "cdr" }> };
}

export function AppreciateWealthControlCenter({ from, to, onOpen }: { from: string; to: string; onOpen: (t: DrawerTarget) => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [segment, setSegment] = useState("All");

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    hrmsApi.get<{ success: boolean; data: Data }>(`${API}/control-center?from=${from}&to=${to}&segment=${encodeURIComponent(segment)}`)
      .then((res) => { if (!cancelled) setData(res.data); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Unable to load the control center."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [from, to, segment]);

  const top10 = useMemo(() => (data?.agents ?? []).slice(0, 10), [data]);
  const maxConnected = Math.max(1, ...top10.map((a) => a.connected));
  const last7 = useMemo(() => (data?.daily ?? []).slice(-7), [data]);

  if (loading && !data) return <Spinner tone="blue" />;
  if (error) return <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return null;

  const k = data.kpis; const p = data.prev;
  const openDay = (a: string, b: string, label: string) => onOpen({ kind: "day", from: a, to: b, label });
  const rangeLabel = `${fullDay(data.from)} – ${fullDay(data.effectiveTo)}`;
  const loginShareBreak = k.loginS > 0 ? (k.breakAvgS * k.agentDays / k.loginS) * 100 : 0;
  const lateTone = k.latePct >= 50 ? "#e11d48" : k.latePct >= 25 ? "#f59e0b" : "#10b981";
  const srcTotal = data.sources.total;
  const w = data.wtd;

  return (
    <CcShell>
      <CcHeader
        title="Appreciate Wealth — Performance Control Center"
        subtitle={`Agent-wise · Daily / WTD / MTD view · ${rangeLabel}`}
        right={
          <Select value={segment} onValueChange={setSegment}>
            <SelectTrigger className="h-9 w-[150px] border-indigo-300/40 bg-white/10 text-xs font-semibold text-white" aria-label="Segment"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All segments</SelectItem>
              {data.segments.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        }
      />
      <CoverageNote>
        Agent-day data is uploaded {data.coverage.billingFrom ? fullDay(data.coverage.billingFrom) : "—"} to {data.coverage.billingTo ? fullDay(data.coverage.billingTo) : "—"}; call-level (CDR) data {data.coverage.cdrFrom ? fullDay(data.coverage.cdrFrom) : "—"} to {data.coverage.cdrTo ? fullDay(data.coverage.cdrTo) : "—"}.
        {data.effectiveTo < data.to && <> Figures cover {fullDay(data.from)} – {fullDay(data.effectiveTo)} (the last uploaded day); the previous period is the {data.prevFrom === data.prevTo ? "day" : "same number of days"} before ({fullDay(data.prevFrom)} – {fullDay(data.prevTo)}).</>}
      </CoverageNote>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <CcTile icon={PhoneCall} label="Total Calls" value={fmtNum(k.calls)} tone="bg-blue-100 text-blue-700" delta={deltaOf(k.calls, p?.calls, "pct", true)} onClick={() => openDay(data.from, data.effectiveTo, "Total Calls")} />
        <CcTile icon={Headphones} label="Connected Calls" value={fmtNum(k.connected)} tone="bg-emerald-100 text-emerald-700" delta={deltaOf(k.connected, p?.connected, "pct", true)} onClick={() => openDay(data.from, data.effectiveTo, "Connected Calls")} />
        <CcTile icon={Percent} label="Connected %" value={fmtPctVal(k.connectedPct)} tone="" ring={k.connectedPct} delta={deltaOf(k.connectedPct, p?.connectedPct, "pp", true)} onClick={() => openDay(data.from, data.effectiveTo, "Connected %")} />
        <CcTile icon={Clock} label="Total Talk Time" value={fmtHms(k.talkS)} tone="bg-indigo-100 text-indigo-700" delta={deltaOf(k.talkS, p?.talkS, "pct", true)} onClick={() => openDay(data.from, data.effectiveTo, "Total Talk Time")} />
        <CcTile icon={AudioLines} label="Avg. Talk Time" value={fmtMins(k.avgTalkPerCallS)} sub="per connected call · vs previous" tone="bg-sky-100 text-sky-700" delta={deltaOf(k.avgTalkPerCallS, p?.avgTalkPerCallS, "pct", true)} />
        <CcTile icon={UserX} label="Late Login %" value={fmtPctVal(k.latePct)} sub={`${k.lateDays} of ${k.agentDays} agent-days`} tone="bg-amber-100 text-amber-700" delta={deltaOf(k.latePct, p?.latePct, "pp", false)} />
        <CcTile icon={GaugeIcon} label="Productive % (net occ.)" value={fmtPctVal(k.productivePct)} sub="(talk+wrap) / net login" tone="bg-violet-100 text-violet-700" delta={deltaOf(k.productivePct, p?.productivePct, "pp", true)} />
        <CcTile icon={Coffee} label="Break Time (Avg.)" value={fmtHms(k.breakAvgS)} sub="per agent-day" tone="bg-orange-100 text-orange-700" delta={deltaOf(k.breakAvgS, p?.breakAvgS, "pct", false)} />
      </div>

      {/* trend + WTD + call source */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <CcPanel title="Call Performance Trend" icon={TrendingUp}>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_170px]">
            <ResponsiveContainer width="100%" height={210}>
              <AreaChart data={data.daily.map((d) => ({ ...d, x: shortDay(d.date) }))} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}
                onClick={(s: unknown) => { const d = (s as { activePayload?: Array<{ payload?: Day }> } | null)?.activePayload?.[0]?.payload; if (d) openDay(d.date, d.date, fullDay(d.date)); }} style={{ cursor: "pointer" }}>
                <defs>
                  <linearGradient id="awccTot" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#4338ca" stopOpacity={0.3} /><stop offset="100%" stopColor="#4338ca" stopOpacity={0.02} /></linearGradient>
                  <linearGradient id="awccCon" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10b981" stopOpacity={0.35} /><stop offset="100%" stopColor="#10b981" stopOpacity={0.02} /></linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="x" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} />
                <Tooltip {...TOOLTIP_PROPS} /><Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
                <Area type="monotone" dataKey="calls" name="Total Calls" stroke="#4338ca" strokeWidth={2} fill="url(#awccTot)" dot={{ r: 3 }} />
                <Area type="monotone" dataKey="connected" name="Connected Calls" stroke="#10b981" strokeWidth={2} fill="url(#awccCon)" dot={{ r: 3 }} />
              </AreaChart>
            </ResponsiveContainer>
            <div className="rounded-xl border border-amber-200 bg-white p-3">
              <p className="text-xs font-extrabold text-indigo-950">WTD Comparison</p>
              {!w ? <p className="mt-2 text-xs text-slate-400">No data yet.</p> : (
                <div className="mt-2 space-y-3">
                  <p className="text-[10px] text-slate-500">{shortDay(w.from)} – {shortDay(w.to)} vs {shortDay(w.prevFrom)} – {shortDay(w.prevTo)}</p>
                  <div><p className="text-[11px] text-slate-500">Total Calls</p><p className="text-2xl font-extrabold text-indigo-950">{fmtNum(w.calls)}</p><DeltaText d={deltaOf(w.calls, w.prevCalls, "pct", true)} /></div>
                  <div><p className="text-[11px] text-slate-500">Connected Calls</p><p className="text-2xl font-extrabold text-indigo-950">{fmtNum(w.connected)}</p><DeltaText d={deltaOf(w.connected, w.prevConnected, "pct", true)} /></div>
                </div>
              )}
            </div>
          </div>
        </CcPanel>

        <CcPanel title="Call Source / Campaign (CDR legs)" icon={Globe2}>
          {srcTotal === 0 ? <p className="py-10 text-center text-xs text-slate-400">No call-level records in this range.</p> : (
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_150px]">
              <ul className="space-y-1.5 text-xs">
                {data.sources.items.map((s, i) => (
                  <li key={s.name}>
                    <button type="button" disabled={s.name.startsWith("Others")} onClick={() => onOpen({ kind: "group", source: s.source, dim: "campaign", value: s.name })} className="block w-full text-left disabled:cursor-default" title={s.name.startsWith("Others") ? s.name : `${s.name} — click for calls`}>
                      <span className="flex justify-between gap-2"><span className="truncate font-medium text-slate-700">{s.name}</span><span className="shrink-0 font-bold text-indigo-950">{fmtNum(s.legs)} <span className="font-medium text-slate-500">({fmtPctVal((s.legs / srcTotal) * 100)})</span></span></span>
                      <span className="mt-0.5 block h-2 overflow-hidden rounded-full bg-slate-200"><span className="block h-full rounded-full" style={{ width: `${(s.legs / data.sources.items[0].legs) * 100}%`, backgroundColor: PALETTE[i % PALETTE.length] }} /></span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="relative h-[150px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart><Pie data={data.sources.items} dataKey="legs" nameKey="name" innerRadius="62%" outerRadius="94%" paddingAngle={2} stroke="none" label={false}>
                    {data.sources.items.map((s, i) => <Cell key={s.name} fill={PALETTE[i % PALETTE.length]} />)}
                  </Pie><Tooltip {...TOOLTIP_PROPS} formatter={(v: number) => fmtNum(Number(v))} /></PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><span className="text-base font-extrabold text-indigo-950">{fmtNum(srcTotal)}</span><span className="text-[9px] font-semibold text-slate-500">Call legs</span></div>
              </div>
            </div>
          )}
          <p className="mt-2 text-[10px] text-slate-400">Enquiry channels (Meta, IndiaMART, ChatBot, Website) are not in the uploaded data, so the CDR campaign mix is shown instead. CDRs carry no segment, so this ignores the segment filter.</p>
        </CcPanel>
      </div>

      {/* agent productivity + attendance */}
      <div className="grid gap-3 lg:grid-cols-2">
        <CcPanel title="Agent Productivity (Connected Calls)" icon={Users}>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
            <div>
              <p className="mb-1 text-[11px] font-bold text-slate-500">Top agents by connected calls</p>
              {top10.length === 0 ? <p className="text-xs text-slate-400">None</p> : (
                <ul className="space-y-1">
                  {top10.map((a) => (
                    <li key={a.agentId}>
                      <button type="button" onClick={() => onOpen({ kind: "agent", key: a.agentId })} className="flex w-full items-center gap-2 text-left text-[11px] hover:opacity-80">
                        <span className="w-24 shrink-0 truncate font-medium text-slate-700">{a.name}</span>
                        <span className="h-3 flex-1 overflow-hidden rounded bg-slate-200"><span className="block h-full rounded bg-indigo-500" style={{ width: `${(a.connected / maxConnected) * 100}%` }} /></span>
                        <span className="w-10 shrink-0 text-right font-bold text-indigo-950">{fmtNum(a.connected)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="mb-1 text-[11px] font-bold text-slate-500">Agent wise key metrics</p>
              <div className="max-h-[300px] overflow-auto rounded-lg border border-slate-200">
                <table className="w-full text-center text-[11px]">
                  <thead><tr className="sticky top-0 bg-indigo-950 text-white">{["Agent", "Connected", "Talk Time", "Productive", "Late Login %"].map((h) => <th key={h} className="whitespace-nowrap px-2 py-1.5 font-bold">{h}</th>)}</tr></thead>
                  <tbody>
                    {data.agents.map((a, i) => (
                      <tr key={a.agentId} onClick={() => onOpen({ kind: "agent", key: a.agentId })} className={`cursor-pointer hover:bg-indigo-50 ${i % 2 ? "bg-slate-50" : "bg-white"}`}>
                        <td className="whitespace-nowrap px-2 py-1 text-left font-semibold text-slate-700">{a.name}</td>
                        <td className="px-2 py-1">{fmtNum(a.connected)}</td>
                        <td className="px-2 py-1">{fmtHms(a.talkS)}</td>
                        <td className="px-2 py-1">{a.calls > 0 || a.productivePct > 0 ? fmtPctVal(a.productivePct) : "—"}</td>
                        <td className={`px-2 py-1 font-bold ${a.latePct >= 50 ? "bg-rose-200 text-rose-800" : a.latePct > 0 ? "bg-amber-100 text-amber-800" : "text-slate-600"}`}>{fmtPctVal(a.latePct)}</td>
                      </tr>
                    ))}
                    {data.agents.length === 0 && <tr><td colSpan={5} className="py-4 text-slate-400">None</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </CcPanel>

        <CcPanel title="Attendance & Adherence" icon={CalendarClock}>
          <div className="flex flex-wrap items-start gap-4">
            <div className="flex gap-3">
              <div className="text-center"><p className="mb-1 text-[11px] font-bold text-slate-500">Late Login %</p><Ring pct={k.latePct} color={lateTone} size={84} label={fmtPctVal(k.latePct)} /></div>
              <div className="text-center"><p className="mb-1 text-[11px] font-bold text-slate-500">Productive %</p><Ring pct={k.productivePct} color="#4f46e5" size={84} label={fmtPctVal(k.productivePct)} /></div>
              <div className="text-center"><p className="mb-1 text-[11px] font-bold text-slate-500">Break (Avg.)</p><Ring pct={loginShareBreak} color="#f59e0b" size={84} label={fmtHms(k.breakAvgS)} sub={`${Math.round(loginShareBreak)}% of login`} /></div>
            </div>
            <div className="min-w-0 flex-1">
              <p className="mb-1 text-[11px] font-bold text-slate-500">Late login heat-map (agents with most late days)</p>
              {data.heat.agents.length === 0 ? <p className="text-xs text-slate-400">None</p> : (
                <div className="max-h-[210px] overflow-auto rounded-lg border border-slate-200 bg-white p-1">
                  <table className="border-collapse text-[9px]">
                    <thead><tr><th className="sticky left-0 bg-white pr-2 text-left font-bold text-slate-500">Agent</th>{data.heat.dates.map((d) => <th key={d} className="px-0.5 font-semibold text-slate-500">{d.slice(8, 10)}</th>)}</tr></thead>
                    <tbody>
                      {data.heat.agents.map((a) => (
                        <tr key={a.agentId}>
                          <td className="sticky left-0 whitespace-nowrap bg-white pr-2 font-medium text-slate-700">{a.name}</td>
                          {a.cells.map((c, i) => <td key={i} className="p-0.5"><span className={`block h-3.5 w-4 rounded-sm ${c === 2 ? "bg-rose-500" : c === 1 ? "bg-emerald-400" : "bg-slate-200"}`} title={`${a.name} · ${shortDay(data.heat.dates[i])} · ${c === 2 ? "late login" : c === 1 ? "on time" : "no agent-day row"}`} /></td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="mt-1 flex flex-wrap gap-3 text-[10px] text-slate-500"><span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-emerald-400" />On time</span><span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-rose-500" />Late login</span><span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-slate-200" />No row</span></p>
            </div>
          </div>
        </CcPanel>
      </div>

      {/* talk time & break + daily snapshot */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <CcPanel title="Talk Time & Break Analysis" icon={Timer}>
          <div className="grid gap-3 md:grid-cols-2">
            {([["Total talk time (hours)", "talkH", "#4f46e5"], ["Avg break per agent-day (minutes)", "breakM", "#f59e0b"]] as const).map(([title, key, color]) => (
              <div key={key}>
                <p className="mb-1 text-[11px] font-bold text-slate-500">{title}</p>
                <ResponsiveContainer width="100%" height={150}>
                  <AreaChart data={data.daily.map((d) => ({ x: shortDay(d.date), talkH: Math.round((d.talkS / 3600) * 10) / 10, breakM: Math.round(d.breakAvgS / 60) }))} margin={{ top: 4, right: 6, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="x" tick={{ fontSize: 9 }} /><YAxis tick={{ fontSize: 9 }} /><Tooltip {...TOOLTIP_PROPS} />
                    <Area type="monotone" dataKey={key} name={key === "talkH" ? "Talk (h)" : "Break (min)"} stroke={color} fill={color} fillOpacity={0.18} strokeWidth={2} dot={{ r: 2 }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-600">Avg. talk time <b className="text-indigo-950">{fmtMins(k.avgTalkPerCallS)}</b> per connected call <DeltaText d={deltaOf(k.avgTalkPerCallS, p?.avgTalkPerCallS, "pct", true)} /></p>
        </CcPanel>

        <CcPanel title="Daily Operational Snapshot (last 7 days with data)" icon={CalendarClock}>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-center text-[11px]">
              <thead><tr className="bg-indigo-950 text-white">{["Date", "Total Calls", "Connected", "Connected %", "Talk Time", "Productive", "Break", "Late Login %"].map((h) => <th key={h} className="whitespace-nowrap px-2 py-1.5 font-bold">{h}</th>)}</tr></thead>
              <tbody>
                {last7.map((d, i) => (
                  <tr key={d.date} onClick={() => openDay(d.date, d.date, fullDay(d.date))} className={`cursor-pointer hover:bg-indigo-50 ${i % 2 ? "bg-slate-50" : "bg-white"}`}>
                    <td className="whitespace-nowrap px-2 py-1 font-semibold text-slate-700">{fullDay(d.date)}</td>
                    <td className="px-2 py-1">{fmtNum(d.calls)}</td><td className="px-2 py-1">{fmtNum(d.connected)}</td>
                    <td className="px-2 py-1">{fmtPctVal(d.connectedPct)}</td><td className="px-2 py-1">{fmtHms(d.talkS)}</td>
                    <td className="px-2 py-1">{fmtPctVal(d.productivePct)}</td><td className="px-2 py-1">{fmtHms(d.breakAvgS)}</td>
                    <td className={`px-2 py-1 font-bold ${d.latePct >= 40 ? "bg-rose-200 text-rose-800" : d.latePct > 0 ? "bg-amber-100 text-amber-800" : "text-slate-600"}`}>{fmtPctVal(d.latePct)}</td>
                  </tr>
                ))}
                {last7.length === 0 && <tr><td colSpan={8} className="py-4 text-slate-400">No agent-day data in this range.</td></tr>}
              </tbody>
            </table>
          </div>
        </CcPanel>
      </div>
    </CcShell>
  );
}
