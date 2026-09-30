import { useEffect, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Loader2, Info, AlertTriangle, CheckCircle2 } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";

interface Slice { label: string; count: number; revenue: number }
interface AgentRow { empCode: string; empName: string; sales: number; revenue: number; aov: number; prepaidPct: number; rtoPct: number; activeDays: number }
interface Analytics {
  totals: { sales: number; revenue: number; agentsSelling: number; sameDayPtp: number; h24: number };
  campaigns: Slice[]; payment: Slice[]; business: Slice[]; orderStatus: Slice[]; channel: Slice[]; callOutcome: Slice[];
  byHour: Array<{ hour: number; sales: number }>;
  byWeekday: Array<{ weekday: number; label: string; sales: number; revenue: number; days: number; avgSales: number }>;
  agents: AgentRow[];
  manpower: { available: boolean; activeHeadcount: number; avgPresent: number | null; avgSelling: number | null; sellingPerPresent: number | null; salesPerSeller: number | null; salesPerPresent: number | null; daily: Array<{ date: string; present: number; selling: number; sales: number }> };
  orderStatusPending: { total: number; withoutStatus: number; rtoOfUpdatedPct: number };
  insights: Array<{ tone: "good" | "warn" | "bad" | "info"; text: string }>;
}
export interface FunnelInput { freshBase: number; freshWorkable: number; uniqueAttempt: number; connected: number; realTimeSale: number }

const COLORS = ["#1A1A1A", "#D4AF37", "#2f6fed", "#0d9488", "#e11d48", "#7c3aed", "#f59e0b", "#64748b"];
const fmt = (v: number) => Math.round(v).toLocaleString("en-IN");
const inr = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;
const pc = (v: number) => `${(v * 100).toFixed(1)}%`;
const one = (v: number | null) => (v === null ? "—" : v.toFixed(1));
const TONE = { good: "text-emerald-700 bg-emerald-50", warn: "text-amber-800 bg-amber-50", bad: "text-rose-700 bg-rose-50", info: "text-slate-700 bg-slate-50" } as const;

function Card({ title, sub, children, className = "" }: { title: string; sub?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-slate-100 bg-white p-4 shadow-sm ${className}`}>
      <p className="text-sm font-semibold text-slate-700">{title}</p>
      {sub && <p className="mb-2 text-[11px] text-slate-400">{sub}</p>}
      {children}
    </div>
  );
}

function Donut({ data }: { data: Slice[] }) {
  if (!data.length) return <p className="py-6 text-center text-xs text-slate-400">No data</p>;
  const total = data.reduce((a, d) => a + d.count, 0);
  return (
    <div className="flex items-center gap-3">
      <div className="h-36 w-36 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="count" nameKey="label" innerRadius={38} outerRadius={64} paddingAngle={2}>
              {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Pie>
            <Tooltip formatter={(v: number, _n, p) => [`${fmt(v)} (${pc(v / total)}) · ${inr((p.payload as Slice).revenue)}`, (p.payload as Slice).label]} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="min-w-0 flex-1 space-y-1 text-xs">
        {data.map((d, i) => (
          <li key={d.label} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
            <span className="truncate text-slate-600">{d.label}</span>
            <span className="ml-auto font-semibold text-slate-800">{pc(d.count / total)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function HBars({ data, color = "#1A1A1A" }: { data: Slice[]; color?: string }) {
  if (!data.length) return <p className="py-6 text-center text-xs text-slate-400">No data</p>;
  return (
    <div style={{ height: Math.max(120, data.length * 26) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="label" width={130} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip formatter={(v: number, _n, p) => [`${fmt(v)} · ${inr((p.payload as Slice).revenue)}`, "Orders"]} />
          <Bar dataKey="count" fill={color} radius={[0, 4, 4, 0]} label={{ position: "right", fontSize: 10, fill: "#64748b" }} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function Funnel({ f }: { f: FunnelInput }) {
  const stages = [
    ["Fresh base", f.freshBase], ["Fresh workable", f.freshWorkable], ["Attempted (same day)", f.uniqueAttempt], ["Connected", f.connected], ["Sale (Real Time)", f.realTimeSale],
  ] as const;
  const max = Math.max(1, ...stages.map((s) => s[1]));
  return (
    <div className="space-y-1.5">
      {stages.map(([label, v], i) => {
        const prev = i > 0 ? stages[i - 1][1] : 0;
        return (
          <div key={label} className="flex items-center gap-2 text-xs">
            <span className="w-36 shrink-0 text-slate-600">{label}</span>
            <div className="h-5 flex-1 rounded bg-slate-100">
              <div className="h-5 rounded" style={{ width: `${(v / max) * 100}%`, background: COLORS[i % COLORS.length] }} />
            </div>
            <span className="w-14 text-right font-semibold text-slate-800">{fmt(v)}</span>
            <span className="w-14 text-right text-slate-400">{i > 0 && prev > 0 ? pc(v / prev) : ""}</span>
          </div>
        );
      })}
      <p className="pt-1 text-[10px] text-slate-400">Right-hand % is the step-to-step rate. The sale step is compared with connected calls, but sales also come from non-fresh data, so read it as an indicator, not a strict funnel.</p>
    </div>
  );
}

export default function BlaAnalytics({ from, to, funnel }: { from: string; to: string; funnel?: FunnelInput }) {
  const [a, setA] = useState<Analytics | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    let live = true;
    setA(null); setErr(null);
    hrmsApi.get<{ data: Analytics }>(`/api/bla-bli-blu-dashboard/analytics?from=${from}&to=${to}`, 60_000)
      .then((r) => { if (live) setA(r.data); })
      .catch((e) => { if (live) setErr(e instanceof Error ? e.message : "Could not load analytics"); });
    return () => { live = false; };
  }, [from, to]);

  if (err) return <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-600">{err}</p>;
  if (!a) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>;
  if (!a.totals.sales) return null;

  const agents = showAll ? a.agents : a.agents.slice(0, 10);
  const m = a.manpower;
  return (
    <section className="space-y-4">
      <p className="text-base font-bold text-slate-800">Analytics</p>

      <div className="grid gap-2 md:grid-cols-2">
        {a.insights.map((i, k) => {
          const Icon = i.tone === "good" ? CheckCircle2 : i.tone === "info" ? Info : AlertTriangle;
          return <p key={k} className={`flex items-start gap-2 rounded-lg p-2.5 text-xs ${TONE[i.tone]}`}><Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />{i.text}</p>;
        })}
      </div>

      {funnel && funnel.freshBase > 0 && <Card title="Data to sale funnel" sub="Received Data (Fresh) through to Real Time Sales, for the range and LOB selected above"><Funnel f={funnel} /></Card>}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Sales by campaign" sub="Real Time Sales"><Donut data={a.campaigns} /></Card>
        <Card title="Prepaid vs COD" sub="Real Time Sales by payment status"><Donut data={a.payment} /></Card>
        <Card title="Sale type" sub="Real Time vs Same Day PTP vs 24 Hrs (separate buckets per workbook)"><Donut data={a.business} /></Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Order status" sub="What happened to Real Time Sales orders. “Not updated yet” means the courier status is still blank, so RTO is not final."><HBars data={a.orderStatus} color="#2f6fed" /></Card>
        <Card title="Where orders come from" sub="Checkout channel of Real Time Sales"><HBars data={a.channel} color="#0d9488" /></Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Sales by hour of day" sub="Hour of the sale call (blank call times excluded)">
          <div className="h-52"><ResponsiveContainer width="100%" height="100%">
            <BarChart data={a.byHour}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="hour" tickFormatter={(h: number) => `${h}h`} tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} width={34} /><Tooltip labelFormatter={(h: number) => `${String(h).padStart(2, "0")}:00`} /><Bar dataKey="sales" fill="#D4AF37" radius={[4, 4, 0, 0]} /></BarChart>
          </ResponsiveContainer></div>
        </Card>
        <Card title="Average sales by weekday" sub="Total sales ÷ days with sales, so a short month does not distort it">
          <div className="h-52"><ResponsiveContainer width="100%" height="100%">
            <BarChart data={a.byWeekday}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} width={34} /><Tooltip /><Bar dataKey="avgSales" name="Avg sales / day" fill="#1A1A1A" radius={[4, 4, 0, 0]} /></BarChart>
          </ResponsiveContainer></div>
        </Card>
      </div>

      <Card title="Manpower and productivity" sub="Headcount and attendance come from HRMS; “selling” is agents with at least one Real Time Sale that day. The old Sales MBR HC / attendance / utilization view, rebuilt.">
        {m.available ? (
          <>
            <div className="mb-3 grid grid-cols-2 gap-2 text-xs md:grid-cols-5">
              {[
                ["Active headcount", fmt(m.activeHeadcount)], ["Avg present / day", one(m.avgPresent)], ["Avg agents selling / day", one(m.avgSelling)],
                ["Selling ÷ present", m.sellingPerPresent === null ? "—" : pc(m.sellingPerPresent)], ["Sales per selling agent / day", one(m.salesPerSeller)],
              ].map(([l, v]) => <div key={l} className="rounded-lg bg-slate-50 p-2"><p className="text-slate-400">{l}</p><p className="text-base font-bold text-slate-800">{v}</p></div>)}
            </div>
            {m.avgPresent === null && <p className="mb-2 text-[11px] text-amber-700">No attendance is recorded for this process in the range, so present-based ratios are blank.</p>}
            <div className="h-52"><ResponsiveContainer width="100%" height="100%">
              <LineChart data={m.daily}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" tickFormatter={(d: string) => d.slice(5)} tick={{ fontSize: 11 }} minTickGap={16} /><YAxis tick={{ fontSize: 11 }} width={34} /><Tooltip /><Legend />
                <Line dataKey="present" name="Present" stroke="#64748b" dot={false} /><Line dataKey="selling" name="Selling" stroke="#0d9488" dot={false} /><Line dataKey="sales" name="Sales" stroke="#D4AF37" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer></div>
          </>
        ) : <p className="text-xs text-slate-400">No active Bla Bli Blu process found in HRMS to read headcount from.</p>}
      </Card>

      <Card title={`Agent leaderboard · ${a.totals.agentsSelling} agents selling`} sub="Real Time Sales per agent. RTO % is red at 10% or more; treat it with care while many orders have no status yet.">
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 text-left text-slate-500"><tr>{["#", "Agent", "Sales", "Revenue", "AOV", "Prepaid", "RTO", "Days sold"].map((h) => <th key={h} className="px-2 py-2 font-semibold">{h}</th>)}</tr></thead>
            <tbody>
              {agents.map((g, i) => (
                <tr key={g.empCode} className="border-t border-slate-100">
                  <td className="px-2 py-1.5 text-slate-400">{i + 1}</td>
                  <td className="px-2"><span className="font-medium text-slate-800">{g.empName || g.empCode}</span> <span className="text-slate-400">{g.empCode}</span></td>
                  <td className="px-2 font-semibold">{fmt(g.sales)}</td><td className="px-2">{inr(g.revenue)}</td><td className="px-2">{inr(g.aov)}</td>
                  <td className="px-2">{pc(g.prepaidPct)}</td><td className={`px-2 ${g.rtoPct >= 0.1 ? "font-semibold text-rose-600" : ""}`}>{pc(g.rtoPct)}</td><td className="px-2">{g.activeDays}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {a.agents.length > 10 && <button onClick={() => setShowAll((v) => !v)} className="mt-2 text-xs font-semibold text-blue-600 underline">{showAll ? "Show top 10" : `Show all ${a.agents.length}`}</button>}
      </Card>

      {a.callOutcome.length > 0 && <Card title="Call outcomes on the sales sheet" sub="Calling status of every row in Overall Sales (sales, follow-ups, PTPs, drops)"><HBars data={a.callOutcome} color="#7c3aed" /></Card>}
    </section>
  );
}
