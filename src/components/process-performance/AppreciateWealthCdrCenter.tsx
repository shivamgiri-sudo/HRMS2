import { useEffect, useMemo, useState } from "react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, BarChart, LabelList,
} from "recharts";
import {
  PhoneCall, PhoneIncoming, PhoneOff, Clock, ClipboardList, Headphones, Timer, TrendingUp, PieChart as PieIcon, BarChart3, Hourglass, PhoneMissed, Table2, Users,
} from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Spinner } from "./DashboardKit";
import type { DrawerTarget } from "./AppreciateWealthDrawer";
import {
  TOOLTIP_PROPS, fmtHms, fmtClock, fmtNum, fmtPctVal, deltaOf, CcShell, CcHeader, CcPanel, CcTile, CoverageNote,
} from "./AwControlKit";

/**
 * Appreciate Wealth -- "CDR Report" slide. Every figure is live from
 * GET /appreciate-wealth/cdr-center (aw_new_cdr, the Onboarding dialer CDR);
 * appreciate-wealth-cdr-center.service.ts documents each formula. The
 * mock-up's within / before / after-window outcomes and ENSER team have no
 * data behind them, so they are not shown.
 */

const API = "/api/process-performance/appreciate-wealth";
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDay = (iso: string) => `${Number(iso.slice(8, 10))}-${MON[Number(iso.slice(5, 7)) - 1]}`;
const fullDay = (iso: string) => `${Number(iso.slice(8, 10))}-${MON[Number(iso.slice(5, 7)) - 1]}-${iso.slice(2, 4)}`;
const TYPE_COLORS: Record<string, string> = { Progressive: "#4f46e5", Manual: "#f59e0b", Inbound: "#c026d3" };
const typeColor = (t: string) => TYPE_COLORS[t] ?? "#64748b";
const TH = "sticky top-0 z-10 whitespace-nowrap bg-indigo-950 px-2 py-1.5 font-bold text-white";

interface Agg {
  calls: number; answered: number; unanswered: number; answerPct: number; unansweredPct: number;
  talkS: number; wrapS: number; holdS: number; avgTalkS: number; avgWrapS: number; avgHoldS: number; ahtS: number; ahtWithPickupS: number | null;
}
interface TypeRow extends Agg { type: string; pctOfCalls: number; days: number; answeredPerDay: number; unansweredPerDay: number }
interface DetailRow extends Agg { date: string; type: string }
interface AgentRow extends Agg { agent: string; agentId: string }
interface DayPoint { date: string; calls: number; answered: number; unanswered: number; answerPct: number }
interface Data {
  from: string; to: string; effectiveTo: string; prevFrom: string; prevTo: string;
  coverage: { from: string | null; to: string | null; teams: string[]; rawRows: number; dedupDropped: number; daysWithData: number; ttaAvailable: boolean };
  kpis: Agg; prev: Agg | null; daily: DayPoint[]; types: TypeRow[];
  outcomes: { answered: number; unanswered: number; hangup: Array<{ label: string; count: number }> };
  talk: { avgTalkS: number; avgWrapS: number; avgHoldS: number };
  agentDisconnect: { date: string | null; items: Array<{ agent: string; agentId: string; count: number }> };
  details: DetailRow[]; grand: Agg; agents: AgentRow[];
}

type Grain = "daily" | "weekly" | "monthly";
/** Day-of-month blocks (1-7 = W-1, 8-14 = W-2 ...), the week convention used across the app. */
function bucketOf(date: string, grain: Grain): { key: string; label: string } {
  if (grain === "daily") return { key: date, label: shortDay(date) };
  const ym = date.slice(0, 7);
  const m = `${MON[Number(date.slice(5, 7)) - 1]}'${date.slice(2, 4)}`;
  if (grain === "monthly") return { key: ym, label: m };
  const w = Math.min(5, Math.ceil(Number(date.slice(8, 10)) / 7));
  return { key: `${ym}-W${w}`, label: `W-${w} ${m}` };
}

export function AppreciateWealthCdrCenter({ from, to, onOpen }: { from: string; to: string; onOpen: (t: DrawerTarget) => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [grain, setGrain] = useState<Grain>("daily");

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    hrmsApi.get<{ success: boolean; data: Data }>(`${API}/cdr-center?from=${from}&to=${to}`)
      .then((res) => { if (!cancelled) setData(res.data); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Unable to load the CDR report."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [from, to]);

  const trend = useMemo(() => {
    const m = new Map<string, { label: string; calls: number; answered: number }>();
    for (const d of data?.daily ?? []) {
      const b = bucketOf(d.date, grain);
      const e = m.get(b.key) ?? { label: b.label, calls: 0, answered: 0 };
      e.calls += d.calls; e.answered += d.answered; m.set(b.key, e);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, v]) => ({ key, ...v, answerPct: v.calls > 0 ? Math.round((v.answered / v.calls) * 1000) / 10 : 0 }));
  }, [data, grain]);

  if (loading && !data) return <Spinner tone="blue" />;
  if (error) return <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return null;

  const k = data.kpis; const p = data.prev;
  const openRange = (label: string) => onOpen({ kind: "day", from: data.from, to: data.effectiveTo, label });
  const openDay = (d: string) => onOpen({ kind: "day", from: d, to: d, label: fullDay(d) });
  const openType = (t: string) => onOpen({ kind: "group", source: "cdr", dim: "callType", value: t });
  const openAgent = (name: string) => onOpen({ kind: "group", source: "cdr", dim: "agent", value: name });
  const rangeLabel = `${fullDay(data.from)} – ${fullDay(data.effectiveTo)}`;
  const team = data.coverage.teams.length ? data.coverage.teams.join(", ") : "Onboarding dialer";
  const typeDonut = data.types.map((t) => ({ name: t.type, value: t.calls, color: typeColor(t.type), pct: t.pctOfCalls }));
  const typePerf = data.types.map((t) => ({ name: t.type, Answered: t.answeredPerDay, Unanswered: t.unansweredPerDay, answerPct: t.answerPct }));
  const talkBars = [
    { name: "Avg. Talk Time", value: data.talk.avgTalkS, color: "#93c5fd" },
    { name: "Avg. Wrap Time", value: data.talk.avgWrapS, color: "#4f46e5" },
    { name: "Avg. Hold Time", value: data.talk.avgHoldS, color: "#f59e0b" },
  ];
  const outcomeRows = [
    { label: "Answered", count: data.outcomes.answered, color: "bg-emerald-500", onClick: () => openRange("Answered calls") },
    { label: "Unanswered", count: data.outcomes.unanswered, color: "bg-rose-500", onClick: () => openRange("Unanswered calls") },
    ...data.outcomes.hangup.map((h) => ({
      label: h.label, count: h.count, color: "bg-indigo-400",
      onClick: h.label === "Customer hang-up" ? () => onOpen({ kind: "group", source: "cdr", dim: "hangup", value: "UserHangup" })
        : h.label === "Agent hang-up" ? () => onOpen({ kind: "group", source: "cdr", dim: "hangup", value: "AgentHangup" })
        : h.label === "System hang-up" ? () => onOpen({ kind: "group", source: "cdr", dim: "hangup", value: "SystemHangup" })
        : () => onOpen({ kind: "group", source: "cdr", dim: "hangup", value: "(not in file layout)" }),
    })),
  ];
  const maxOutcome = Math.max(1, ...outcomeRows.map((o) => o.count));

  // Daily details: one date cell spanning its call-type rows.
  const dateSpan = new Map<string, number>();
  for (const r of data.details) dateSpan.set(r.date, (dateSpan.get(r.date) ?? 0) + 1);
  const seenDate = new Set<string>();

  const aggCells = (a: Agg, opts: { bold?: boolean } = {}) => (
    <>
      <td className="px-2 py-1">{fmtNum(a.answered)}</td>
      <td className="px-2 py-1">{fmtNum(a.unanswered)}</td>
      <td className="px-2 py-1">{fmtPctVal(a.answerPct)}</td>
      <td className="px-2 py-1">{fmtPctVal(a.unansweredPct)}</td>
      <td className="px-2 py-1">{fmtClock(a.holdS)}</td>
      <td className="px-2 py-1">{fmtClock(a.talkS)}</td>
      <td className="px-2 py-1">{fmtClock(a.wrapS)}</td>
      <td className={`px-2 py-1 ${opts.bold ? "" : "font-semibold"}`}>{fmtClock(a.ahtS)}</td>
      <td className="px-2 py-1">{fmtClock(a.avgTalkS)}</td>
      <td className="px-2 py-1">{fmtClock(a.avgWrapS)}</td>
      <td className="px-2 py-1">{fmtClock(a.avgHoldS)}</td>
    </>
  );

  return (
    <CcShell>
      <CcHeader
        title="Appreciate Wealth — CDR Report"
        subtitle={`${team} · Daily, Weekly & Monthly analysis · ${rangeLabel}`}
        right={
          <div className="inline-flex rounded-lg bg-white/10 p-0.5" role="group" aria-label="Trend grain">
            {(["daily", "weekly", "monthly"] as Grain[]).map((g) => (
              <button key={g} type="button" onClick={() => setGrain(g)} className={`rounded-md px-3 py-1 text-xs font-bold capitalize ${grain === g ? "bg-white text-indigo-950" : "text-indigo-100 hover:bg-white/10"}`}>{g}</button>
            ))}
          </div>
        }
      />
      <CoverageNote>
        Dialer CDR is uploaded {data.coverage.from ? fullDay(data.coverage.from) : "—"} to {data.coverage.to ? fullDay(data.coverage.to) : "—"} ({data.coverage.daysWithData} days with calls in this range; days without an upload are simply absent, not zero).
        {data.effectiveTo < data.to && <> Figures cover {fullDay(data.from)} – {fullDay(data.effectiveTo)} (the last uploaded day).</>}
        {" "}{p ? "Deltas compare with the same number of days before." : "No earlier upload exists, so no comparison deltas are shown."}
        {" "}A call is one de-duplicated CDR leg ({fmtNum(data.coverage.rawRows)} uploaded rows, {data.coverage.dedupDropped} re-upload duplicates removed).
        {!data.coverage.ttaAvailable && <> time_to_answer is filled on too few answered calls, so AHT with pickup cannot be computed.</>}
        {" "}The mock-up's Within / Before / After window outcomes and ENSER team are not in the data and are not shown; hang-up reasons are shown instead.
      </CoverageNote>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <CcTile icon={PhoneCall} label="Total Calls" value={fmtNum(k.calls)} tone="bg-blue-100 text-blue-700" delta={deltaOf(k.calls, p?.calls, "pct", true)} onClick={() => openRange("Total calls")} />
        <CcTile icon={PhoneIncoming} label="Calls Answered" value={fmtNum(k.answered)} tone="" ring={k.answerPct} delta={deltaOf(k.answered, p?.answered, "pct", true)} onClick={() => openRange("Answered calls")} />
        <CcTile icon={PhoneOff} label="Calls Unanswered" value={fmtNum(k.unanswered)} tone="" ring={k.unansweredPct} delta={deltaOf(k.unanswered, p?.unanswered, "pct", false)} onClick={() => openRange("Unanswered calls")} />
        <CcTile icon={Clock} label="Avg. Talk Time" value={fmtClock(k.avgTalkS)} sub="per answered call" tone="bg-sky-100 text-sky-700" delta={deltaOf(k.avgTalkS, p?.avgTalkS, "pct", true)} onClick={() => openRange("Talk time")} />
        <CcTile icon={ClipboardList} label="Avg. Wrap Time" value={fmtClock(k.avgWrapS)} sub="per answered call" tone="bg-rose-100 text-rose-700" delta={deltaOf(k.avgWrapS, p?.avgWrapS, "pct", false)} onClick={() => openRange("Wrap time")} />
        <CcTile icon={Headphones} label="AHT (with Pickup)" value={k.ahtWithPickupS === null ? "n/a" : fmtClock(k.ahtWithPickupS)} sub={k.ahtWithPickupS === null ? "time_to_answer not in upload" : "AHT + avg time to answer"} tone="bg-indigo-100 text-indigo-700" delta={deltaOf(k.ahtWithPickupS ?? 0, p?.ahtWithPickupS ?? undefined, "pct", false)} onClick={() => openRange("AHT")} />
        <CcTile icon={Timer} label="AHT (w/o Pickup)" value={fmtClock(k.ahtS)} sub="handling ÷ answered" tone="bg-fuchsia-100 text-fuchsia-700" delta={deltaOf(k.ahtS, p?.ahtS, "pct", false)} onClick={() => openRange("AHT")} />
      </div>

      {/* trend + type mix + outcomes */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <CcPanel title={`Call Trend (${grain === "daily" ? "Daily" : grain === "weekly" ? "Weekly" : "Monthly"})`} icon={TrendingUp}>
          {trend.length === 0 ? <p className="py-10 text-center text-xs text-slate-400">None</p> : (
            <ResponsiveContainer width="100%" height={230}>
              <ComposedChart data={trend} margin={{ top: 4, right: 4, left: -12, bottom: 0 }} style={{ cursor: grain === "daily" ? "pointer" : "default" }}
                onClick={(s: unknown) => { const d = (s as { activePayload?: Array<{ payload?: { key: string } }> } | null)?.activePayload?.[0]?.payload; if (d && grain === "daily") openDay(d.key); }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis yAxisId="l" tick={{ fontSize: 10 }} />
                <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10 }} unit="%" domain={[0, 100]} />
                <Tooltip {...TOOLTIP_PROPS} /><Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
                <Bar yAxisId="l" dataKey="calls" name="Total Calls" fill="#6366f1" radius={[4, 4, 0, 0]} />
                <Line yAxisId="l" type="monotone" dataKey="answered" name="Calls Answered" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
                <Line yAxisId="r" type="monotone" dataKey="answerPct" name="Answer %" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CcPanel>

        <CcPanel title="Call Type Distribution" icon={PieIcon}>
          <div className="grid items-center gap-2 sm:grid-cols-[150px_minmax(0,1fr)]">
            <div className="relative h-[160px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart><Pie data={typeDonut} dataKey="value" nameKey="name" innerRadius="60%" outerRadius="94%" paddingAngle={2} stroke="none" label={false}
                  onClick={(d: { name?: string }) => d.name && openType(d.name)} style={{ cursor: "pointer" }}>
                  {typeDonut.map((s) => <Cell key={s.name} fill={s.color} />)}
                </Pie><Tooltip {...TOOLTIP_PROPS} formatter={(v: number) => fmtNum(Number(v))} /></PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><span className="text-base font-extrabold text-indigo-950">{fmtNum(k.calls)}</span><span className="text-[9px] font-semibold text-slate-500">Total Calls</span></div>
            </div>
            <ul className="space-y-1.5 text-xs">
              {typeDonut.map((s) => (
                <li key={s.name}>
                  <button type="button" onClick={() => openType(s.name)} className="flex w-full items-center justify-between gap-2 text-left hover:opacity-80">
                    <span className="flex items-center gap-1.5 font-medium text-slate-700"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: s.color }} />{s.name}</span>
                    <span className="font-bold text-indigo-950">{fmtNum(s.value)} <span className="font-medium text-slate-500">({fmtPctVal(s.pct)})</span></span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </CcPanel>

        <CcPanel title="Call Outcomes" icon={BarChart3}>
          <ul className="space-y-2 text-xs">
            {outcomeRows.map((o) => (
              <li key={o.label}>
                <button type="button" onClick={o.onClick} className="flex w-full items-center gap-2 text-left hover:opacity-80" title={`${o.label} — click for calls`}>
                  <span className="w-32 shrink-0 truncate font-medium text-slate-700">{o.label}</span>
                  <span className="h-5 flex-1 overflow-hidden rounded bg-slate-200"><span className={`block h-full rounded ${o.color}`} style={{ width: `${(o.count / maxOutcome) * 100}%` }} /></span>
                  <span className="w-24 shrink-0 text-right font-bold text-indigo-950">{fmtNum(o.count)} <span className="font-medium text-slate-500">({fmtPctVal(k.calls > 0 ? (o.count / k.calls) * 100 : 0)})</span></span>
                </button>
              </li>
            ))}
          </ul>
        </CcPanel>
      </div>

      {/* type performance + talk analysis + agent disconnection */}
      <div className="grid gap-3 lg:grid-cols-3">
        <CcPanel title="Call Type Wise Performance (Daily Avg.)" icon={PhoneMissed}>
          {typePerf.length === 0 ? <p className="py-10 text-center text-xs text-slate-400">None</p> : (
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={typePerf} margin={{ top: 14, right: 4, left: -12, bottom: 0 }} style={{ cursor: "pointer" }}
                onClick={(s: unknown) => { const d = (s as { activeLabel?: string } | null)?.activeLabel; if (d) openType(d); }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis yAxisId="l" tick={{ fontSize: 10 }} />
                <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10 }} unit="%" domain={[0, 100]} />
                <Tooltip {...TOOLTIP_PROPS} /><Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
                <Bar yAxisId="l" dataKey="Answered" fill="#4f46e5" radius={[4, 4, 0, 0]}><LabelList dataKey="Answered" position="top" style={{ fontSize: 10, fontWeight: 700, fill: "#312e81" }} /></Bar>
                <Bar yAxisId="l" dataKey="Unanswered" fill="#f87171" radius={[4, 4, 0, 0]}><LabelList dataKey="Unanswered" position="top" style={{ fontSize: 10, fontWeight: 700, fill: "#991b1b" }} /></Bar>
                <Line yAxisId="r" type="monotone" dataKey="answerPct" name="Answer %" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
          <p className="text-[10px] text-slate-400">Average answered / unanswered calls per day with calls of that type.</p>
        </CcPanel>

        <CcPanel title="Talk Time Analysis (per answered call)" icon={Hourglass}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={talkBars} margin={{ top: 18, right: 4, left: -8, bottom: 0 }} style={{ cursor: "pointer" }} onClick={() => openRange("Talk time")}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => fmtClock(v)} />
              <Tooltip {...TOOLTIP_PROPS} formatter={(v: number) => fmtClock(Number(v))} />
              <Bar dataKey="value" name="Time" radius={[4, 4, 0, 0]}>
                {talkBars.map((b) => <Cell key={b.name} fill={b.color} />)}
                <LabelList dataKey="value" position="top" formatter={(v: number) => fmtClock(Number(v))} style={{ fontSize: 10, fontWeight: 700, fill: "#312e81" }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CcPanel>

        <CcPanel title={`Agent Disconnection${data.agentDisconnect.date ? ` (${fullDay(data.agentDisconnect.date)})` : ""}`} icon={Users}>
          {data.agentDisconnect.items.length === 0 ? <p className="py-10 text-center text-xs text-slate-400">None</p> : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.agentDisconnect.items.map((a) => ({ ...a, short: a.agent.split(" ").map((w, i) => (i === 0 ? w : w[0] + ".")).join(" ") }))} margin={{ top: 18, right: 4, left: -18, bottom: 0 }} style={{ cursor: "pointer" }}
                onClick={(s: unknown) => { const d = (s as { activePayload?: Array<{ payload?: { agent: string } }> } | null)?.activePayload?.[0]?.payload; if (d) openAgent(d.agent); }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="short" tick={{ fontSize: 9 }} interval={0} angle={-25} textAnchor="end" height={48} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip {...TOOLTIP_PROPS} labelFormatter={(_l: unknown, pl: Array<{ payload?: { agent: string } }>) => pl?.[0]?.payload?.agent ?? ""} />
                <Bar dataKey="count" name="Agent hang-ups" fill="#6366f1" radius={[4, 4, 0, 0]}><LabelList dataKey="count" position="top" style={{ fontSize: 10, fontWeight: 700, fill: "#312e81" }} /></Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
          <p className="text-[10px] text-slate-400">Calls ended by the agent (hangup_by = AgentHangup) on the last day with data.</p>
        </CcPanel>
      </div>

      {/* tables */}
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <CcPanel title="Daily Call Details (Call Type Wise)" icon={Table2}>
          <div className="max-h-[440px] overflow-auto rounded-lg border border-slate-200">
            <table className="w-full text-center text-[11px]">
              <thead><tr>{["Call Date", "Call Type", "Answered", "Unanswered", "Answered %", "Unanswered %", "Hold Time", "Talk Time", "Wrap Duration", "AHT", "Avg. Talk", "Avg. Wrap", "Avg. Hold"].map((h) => <th key={h} className={TH}>{h}</th>)}</tr></thead>
              <tbody>
                {data.details.map((r, i) => {
                  const first = !seenDate.has(r.date); seenDate.add(r.date);
                  return (
                    <tr key={`${r.date}|${r.type}`} onClick={() => openDay(r.date)} className={`cursor-pointer hover:bg-indigo-50 ${i % 2 ? "bg-slate-50" : "bg-white"}`}>
                      {first && <td rowSpan={dateSpan.get(r.date)} className="whitespace-nowrap border-r border-slate-200 bg-white px-2 py-1 font-bold text-indigo-950">{fullDay(r.date)}</td>}
                      <td className="whitespace-nowrap px-2 py-1 text-left font-semibold" style={{ color: typeColor(r.type) }}>{r.type}</td>
                      {aggCells(r)}
                    </tr>
                  );
                })}
                {data.details.length === 0 && <tr><td colSpan={13} className="py-4 text-slate-400">None</td></tr>}
                {data.details.length > 0 && (
                  <tr className="sticky bottom-0 bg-indigo-950 font-extrabold text-white" onClick={() => openRange("Grand total")}>
                    <td colSpan={2} className="px-2 py-1.5">Grand Total</td>
                    {aggCells(data.grand, { bold: true })}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-[10px] text-slate-400">Talk, hold, Avg. Talk / Wrap / Hold and AHT are over answered calls; Wrap Duration totals wrap-up on every call (unanswered calls log wrap-up too).</p>
        </CcPanel>

        <CcPanel title="Agent Wise Summary" icon={Users}>
          <div className="max-h-[440px] overflow-auto rounded-lg border border-slate-200">
            <table className="w-full text-center text-[11px]">
              <thead><tr>{["Agent Name", "Answered", "Unanswered", "Answered %", "Talk Time", "Wrapup", "AHT"].map((h) => <th key={h} className={TH}>{h}</th>)}</tr></thead>
              <tbody>
                {data.agents.map((a, i) => (
                  <tr key={a.agentId + a.agent} onClick={() => openAgent(a.agent === "Not assigned to an agent" ? "(no agent)" : a.agent)} className={`cursor-pointer hover:bg-indigo-50 ${i % 2 ? "bg-slate-50" : "bg-white"}`}>
                    <td className="whitespace-nowrap px-2 py-1 text-left font-semibold text-slate-700">{a.agent}</td>
                    <td className="px-2 py-1">{fmtNum(a.answered)}</td>
                    <td className="px-2 py-1">{fmtNum(a.unanswered)}</td>
                    <td className="px-2 py-1">{fmtPctVal(a.answerPct)}</td>
                    <td className="px-2 py-1">{fmtHms(a.talkS)}</td>
                    <td className="px-2 py-1">{fmtHms(a.wrapS)}</td>
                    <td className="px-2 py-1">{a.answered > 0 ? fmtClock(a.ahtS) : "—"}</td>
                  </tr>
                ))}
                {data.agents.length === 0 && <tr><td colSpan={7} className="py-4 text-slate-400">None</td></tr>}
                {data.agents.length > 0 && (
                  <tr className="sticky bottom-0 bg-indigo-950 font-extrabold text-white">
                    <td className="px-2 py-1.5 text-left">Grand Total</td>
                    <td className="px-2 py-1.5">{fmtNum(k.answered)}</td>
                    <td className="px-2 py-1.5">{fmtNum(k.unanswered)}</td>
                    <td className="px-2 py-1.5">{fmtPctVal(k.answerPct)}</td>
                    <td className="px-2 py-1.5">{fmtHms(k.talkS)}</td>
                    <td className="px-2 py-1.5">{fmtHms(k.wrapS)}</td>
                    <td className="px-2 py-1.5">{fmtClock(k.ahtS)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-[10px] text-slate-400">Range: {rangeLabel}. Calls with no agent (e.g. inbound calls nobody picked up) are listed separately so the totals reconcile.</p>
        </CcPanel>
      </div>
    </CcShell>
  );
}
