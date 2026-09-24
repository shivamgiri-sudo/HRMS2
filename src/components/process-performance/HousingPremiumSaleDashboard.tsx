import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ComposedChart, Bar, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  PhoneCall, Users, Gauge, Timer, ListChecks, Search, ListFilter, IndianRupee, ShoppingCart,
  Trophy, Clock, ShieldCheck, Info, MousePointerClick, Inbox, AlertTriangle, UserX,
} from "lucide-react";
import {
  Spinner, KpiCard, SectionCard, DashboardHero, DateRangeToolbar,
  formatINR, currentMonthRange,
} from "./DashboardKit";
import { HousingPremiumAgentDrawer } from "./HousingPremiumAgentDrawer";
import { useSortableRows } from "./useSortableRows";
import { SortTh } from "./SortTh";
import {
  type HPOverviewData, type HPDayWiseData, type HPAgentWiseData, type HPSlotWiseData,
  type HPTqMqBqAgentsData, type HPTqMqBqTlData, type HPTeamDetailsData, type HPValidation, type HPStage,
  HP_API, STAGE_COLORS, STAGE_LABEL, fmtN, fmtPct, fmtDate, fmtShortDay, fmtMdy, hourLabel,
  secToHms, secToShort, heatStyle,
} from "./housingPremiumShared";

/**
 * Housing Premium's full MIS dashboard -- a like-for-like rebuild of the
 * reference "Housing Premium MIS Dashboard" Excel workbook. Every metric and
 * formula is documented in the backend's housing-premium-dashboard.service.ts
 * header. Data sources: db_masmis.pre_sale (Sale Raw), pre_agent_details
 * (Team Details), Pre_cdr (CDR -- only 4 rows uploaded so far; call-based
 * metrics fill in once the full file is uploaded, everything is already
 * written to scale to that via SQL aggregation).
 */

const TOOLTIP_PROPS = {
  contentStyle: { fontSize: 12, borderRadius: 10, border: "1px solid #334155", background: "#0f172a", boxShadow: "0 8px 24px rgba(15,23,42,0.4)", padding: "8px 12px" },
  labelStyle: { color: "#f1f5f9", fontWeight: 600, marginBottom: 4 },
} as const;

type TabKey = "overview" | "daywise" | "agentwise" | "slotwise" | "tqmqbq" | "tlTarget" | "team";
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "daywise", label: "Day Wise" },
  { key: "agentwise", label: "Agent Wise" },
  { key: "slotwise", label: "Slot Wise" },
  { key: "tqmqbq", label: "Target Achievement" },
  { key: "tlTarget", label: "TL Target" },
  { key: "team", label: "Team Details" },
];

function HintChip({ text = "Click a row for detail" }: { text?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-500">
      <MousePointerClick className="h-3 w-3" /> {text}
    </span>
  );
}
function StageBadge({ stage }: { stage: HPStage }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold text-white" style={{ backgroundColor: STAGE_COLORS[stage] }}>
      {stage}
    </span>
  );
}
function MiniBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="ml-auto flex w-28 items-center justify-end gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, pct))}%`, backgroundColor: color }} />
      </div>
      <span className="w-12 text-right font-semibold text-slate-800">{Math.round(pct * 10) / 10}%</span>
    </div>
  );
}

/** Shown at the top of Overview and Team Details -- the actual cross-checks
 * between the three uploaded files, computed live (not the workbook's own
 * self-consistent formulas, since our roster achievement is a separately
 * uploaded value that CAN drift from live Sale data). */
function ValidationBanner({ v }: { v: HPValidation }) {
  const hasIssues = v.achievementMismatches.length > 0 || !v.saleTlNameUsable || v.agentsInSaleNotInRoster.length > 0;
  return (
    <div className={`space-y-2 rounded-2xl border p-4 ${hasIssues ? "border-amber-200 bg-amber-50/60" : "border-emerald-100 bg-emerald-50/60"}`}>
      <div className="flex items-start gap-3">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${hasIssues ? "bg-amber-100 text-amber-600" : "bg-emerald-100 text-emerald-600"}`}>
          {hasIssues ? <AlertTriangle className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
        </span>
        <div className="min-w-0 text-xs leading-relaxed text-slate-600">
          <p className="text-sm font-bold text-slate-700">
            {v.agentRowCount - v.achievementMismatches.length}/{v.agentRowCount} roster agents reconcile exactly against uploaded Sale
          </p>
          <p className="mt-0.5">
            {v.saleRowCount.toLocaleString("en-IN")} Sale rows, {v.agentRowCount} Agent Details rows, {v.cdrRowCount.toLocaleString("en-IN")} CDR rows uploaded.
            {v.achievementMismatches.length > 0 && (
              <> <b className="text-amber-700">{v.achievementMismatches.length} agent(s)</b> have a roster achievement that doesn't match live Sale data.</>
            )}
            {!v.saleTlNameUsable && (
              <> The Sale file's own TL column ({v.saleTlNameValues.join(", ") || "—"}) doesn't match any real TL name ({v.rosterTlNames.join(", ")}) — TL-wise figures are attributed via each agent's roster TL instead.</>
            )}
            {v.agentsInSaleNotInRoster.length > 0 && <> {v.agentsInSaleNotInRoster.length} agent name(s) appear in Sale but have no roster row: {v.agentsInSaleNotInRoster.join(", ")}.</>}
          </p>
        </div>
      </div>
      {v.achievementMismatches.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-white/60 bg-white/60">
          <table className="w-full text-left text-xs">
            <thead><tr className="text-[10px] uppercase tracking-wide text-slate-400"><th className="px-3 py-1.5">Agent</th><th className="px-3 py-1.5 text-right">Roster achievement</th><th className="px-3 py-1.5 text-right">Live Sale revenue</th><th className="px-3 py-1.5 text-right">Diff</th></tr></thead>
            <tbody>
              {v.achievementMismatches.map((m) => (
                <tr key={m.agentName} className="border-t border-white/70">
                  <td className="px-3 py-1.5 font-medium text-slate-700">{m.agentName} {m.empId !== "-" && <span className="text-slate-400">({m.empId})</span>}</td>
                  <td className="px-3 py-1.5 text-right text-slate-600">{formatINR(m.uploadedAchievement)}</td>
                  <td className="px-3 py-1.5 text-right text-slate-600">{formatINR(m.computedRevenue)}</td>
                  <td className="px-3 py-1.5 text-right font-semibold text-rose-600">{formatINR(m.diff)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ================================ OVERVIEW TAB ================================ */

type Fmt = "count" | "pct0" | "pct2" | "inr";
interface OvRow { key: keyof HPOverviewData["overall"][string]; label: string; fmt: Fmt }
const OVERVIEW_ROWS: OvRow[] = [
  { key: "totalCalls", label: "Total Calls", fmt: "count" },
  { key: "connected", label: "Connected Calls", fmt: "count" },
  { key: "notConnected", label: "Not Connected Calls", fmt: "count" },
  { key: "uniqueConnected", label: "Unique Connected Calls", fmt: "count" },
  { key: "connectedPct", label: "Connected %", fmt: "pct0" },
  { key: "target", label: "Target", fmt: "inr" },
  { key: "revenue", label: "Revenue Achieved", fmt: "inr" },
  { key: "saleCount", label: "Sale Count", fmt: "count" },
  { key: "achievedPct", label: "Ach%", fmt: "pct0" },
  { key: "aov", label: "AOV", fmt: "inr" },
  { key: "presentCount", label: "Present Count", fmt: "count" },
  { key: "perAgentDialCount", label: "Per Agent Dial Count", fmt: "count" },
  { key: "avgSalePerAgent", label: "Avg. Sale Count per Agent", fmt: "count" },
];
function formatVal(v: number | undefined, fmt: Fmt): string {
  if (v === undefined) return "—";
  if (fmt === "count") return fmtN(v);
  if (fmt === "pct0") return `${Math.round(v)}%`;
  if (fmt === "pct2") return `${Math.round(v * 100) / 100}%`;
  return formatINR(v);
}

function OverviewTab({ from, to }: { from: string; to: string }) {
  const [data, setData] = useState<HPOverviewData | null>(null);
  const [validation, setValidation] = useState<HPValidation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [scope, setScope] = useState<string>("__overall__");

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    Promise.all([
      hrmsApi.get<{ success: boolean; data: HPOverviewData }>(`${HP_API}/overview?from=${from}&to=${to}`),
      hrmsApi.get<{ success: boolean; data: HPValidation }>(`${HP_API}/validation`),
    ]).then(([ov, val]) => { if (!cancelled) { setData(ov.data); setValidation(val.data); } })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load the overview."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [from, to]);

  const values = useMemo(() => {
    if (!data) return null;
    if (scope === "__overall__") return data.overall;
    return data.byTl.find((t) => t.tlName === scope)?.values ?? data.overall;
  }, [data, scope]);

  /** Agent count behind whatever's currently in scope -- all TLs summed for
   * "Overall", or just the selected TL's own roster count -- so RPA divides
   * by the right denominator either way. */
  const scopedAgentCount = useMemo(() => {
    if (!data) return 0;
    if (scope === "__overall__") return data.byTl.reduce((s, t) => s + t.agentCount, 0);
    return data.byTl.find((t) => t.tlName === scope)?.agentCount ?? 0;
  }, [data, scope]);

  const tlRevenueRows = useMemo(() => (data?.byTl ?? []).map((t) => ({
    tlName: t.tlName,
    agentCount: t.agentCount,
    revenue: t.values.mtd.revenue,
    aov: t.values.mtd.aov,
    rpa: t.agentCount > 0 ? t.values.mtd.revenue / t.agentCount : 0,
  })), [data]);
  const tlRevenueSort = useSortableRows<{ tlName: string; agentCount: number; revenue: number; aov: number; rpa: number }>(
    tlRevenueRows,
    (t, key) => {
      switch (key) {
        case "tlName": return t.tlName;
        case "agentCount": return t.agentCount;
        case "revenue": return t.revenue;
        case "aov": return t.aov;
        case "rpa": return t.rpa;
        default: return null;
      }
    },
  );

  if (loading && !data) return <Spinner tone="blue" />;
  if (error) return <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data || !values) return null;

  const mtd = values.mtd;
  const empty = mtd.totalCalls === 0 && mtd.revenue === 0;

  return (
    <div className="space-y-5">
      {validation && <ValidationBanner v={validation} />}

      {!data.cdrAvailable && (
        <p className="flex items-center gap-2 rounded-xl border border-sky-100 bg-sky-50 p-3 text-xs font-medium text-sky-700">
          <Info className="h-4 w-4 shrink-0" /> Only {data.cdrRowCount} CDR row(s) uploaded so far — call metrics (Connected, Present Count, etc.) will fill in once the full CDR file is uploaded. Sale figures below are already complete ({data.saleRowCount.toLocaleString("en-IN")} rows).
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-slate-500">TL:</span>
        <div role="tablist" className="inline-flex flex-wrap rounded-xl bg-slate-100 p-1">
          <button type="button" onClick={() => setScope("__overall__")} className={`rounded-lg px-3 py-1 text-xs font-semibold transition-all ${scope === "__overall__" ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>Overall</button>
          {data.byTl.map((t) => (
            <button key={t.tlName} type="button" onClick={() => setScope(t.tlName)} className={`rounded-lg px-3 py-1 text-xs font-semibold transition-all ${scope === t.tlName ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
              {t.tlName} <span className="text-slate-400">({t.agentCount})</span>
            </button>
          ))}
        </div>
      </div>

      {empty && (
        <div className="flex items-center gap-2 rounded-xl border border-dashed border-slate-200 bg-white p-6 text-sm text-slate-400">
          <Inbox className="h-5 w-5" /> No data for this selection in the chosen range.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <KpiCard icon={PhoneCall} label="Total Calls" value={fmtN(mtd.totalCalls)} tone="blue" />
        <KpiCard icon={Gauge} label="Connected %" value={fmtPct(mtd.connectedPct)} tone="emerald" />
        <KpiCard icon={ShoppingCart} label="Sale Count" value={fmtN(mtd.saleCount)} tone="teal" />
        <KpiCard icon={IndianRupee} label="Revenue" value={formatINR(mtd.revenue)} tone="amber" />
        <KpiCard icon={IndianRupee} label="AOV" value={formatINR(mtd.aov)} tone="indigo" />
        <KpiCard icon={Users} label="RPA" value={formatINR(scopedAgentCount > 0 ? mtd.revenue / scopedAgentCount : 0)} sub="revenue / agent count" tone="rose" />
        <KpiCard icon={Gauge} label="Ach%" value={fmtPct(mtd.achievedPct)} sub={`of ${formatINR(mtd.target)} target`} tone="violet" />
        <KpiCard icon={Users} label="Present Count" value={fmtN(mtd.presentCount)} tone="sky" />
      </div>

      <SectionCard icon={ListChecks} title={`Housing Premium — ${scope === "__overall__" ? "Overall" : scope}`} tone="indigo"
        footnote="MTD covers the whole selected range; weeks are 7-day blocks from the 1st of the month.">
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="border-collapse text-center text-[13px] tabular-nums">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 min-w-[220px] border-b border-[#0f1a44] bg-[#1c2a5e] px-4 py-3 text-left text-sm font-bold text-white">Metric</th>
                {data.columns.map((c) => (
                  <th key={c.key} className="min-w-[86px] border-b border-l border-[#0f1a44] bg-[#1c2a5e] px-3 py-3 text-sm font-bold text-white">{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {OVERVIEW_ROWS.map((r) => (
                <tr key={r.key}>
                  <td className="sticky left-0 z-10 border-b border-[#e7d6ad] bg-[#fff2cc] px-4 py-2.5 text-left font-medium text-slate-800">{r.label}</td>
                  {data.columns.map((c) => (
                    <td key={c.key} className={`border-b border-l border-[#e7d6ad] px-3 py-2.5 ${c.kind === "mtd" ? "bg-[#f4b183] font-bold text-slate-900" : "bg-[#f8cbad]/60 text-slate-800"}`}>
                      {formatVal((values[c.key] as HPOverviewData["overall"][string] | undefined)?.[r.key], r.fmt)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard icon={Users} title="TL-wise Revenue vs Target (MTD)" tone="blue">
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={data.byTl.map((t) => ({ tl: t.tlName, revenue: t.values.mtd.revenue, target: t.values.mtd.target }))} margin={{ top: 4, right: 12, left: -8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="tl" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip {...TOOLTIP_PROPS} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="target" name="Target" fill="#c7d2fe" radius={[4, 4, 0, 0]} />
              <Bar dataKey="revenue" name="Revenue" fill="#4f46e5" radius={[4, 4, 0, 0]} />
            </ComposedChart>
          </ResponsiveContainer>
        </SectionCard>
        <SectionCard icon={Gauge} title="TL-wise Achievement %" tone="emerald">
          <div className="space-y-3 pt-2">
            {data.byTl.map((t) => (
              <div key={t.tlName}>
                <div className="mb-1 flex items-baseline justify-between text-xs">
                  <span className="font-medium text-slate-600">{t.tlName}</span>
                  <span className="font-semibold text-slate-800">{fmtPct(t.values.mtd.achievedPct)}</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(100, t.values.mtd.achievedPct)}%` }} />
                </div>
              </div>
            ))}
            {data.byTl.length === 0 && <p className="py-6 text-center text-xs text-slate-400">No data.</p>}
          </div>
        </SectionCard>
      </div>

      <SectionCard icon={Users} title="TL-wise Revenue, AOV & RPA (MTD)" tone="indigo">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                <SortTh label="TL" sortKey="tlName" activeKey={tlRevenueSort.sortKey} dir={tlRevenueSort.sortDir} onSort={tlRevenueSort.toggleSort} className="py-2 pr-3 font-semibold" />
                <SortTh label="Agents" sortKey="agentCount" activeKey={tlRevenueSort.sortKey} dir={tlRevenueSort.sortDir} onSort={tlRevenueSort.toggleSort} className="py-2 pr-3 text-right font-semibold" />
                <SortTh label="Revenue" sortKey="revenue" activeKey={tlRevenueSort.sortKey} dir={tlRevenueSort.sortDir} onSort={tlRevenueSort.toggleSort} className="py-2 pr-3 text-right font-semibold" />
                <SortTh label="AOV" sortKey="aov" activeKey={tlRevenueSort.sortKey} dir={tlRevenueSort.sortDir} onSort={tlRevenueSort.toggleSort} className="py-2 pr-3 text-right font-semibold" />
                <SortTh label="RPA" sortKey="rpa" activeKey={tlRevenueSort.sortKey} dir={tlRevenueSort.sortDir} onSort={tlRevenueSort.toggleSort} className="py-2 pr-0 text-right font-semibold" />
              </tr>
            </thead>
            <tbody>
              {tlRevenueSort.sorted.map((t) => (
                <tr key={t.tlName} className="border-b border-slate-50 last:border-0 hover:bg-indigo-50/40">
                  <td className="py-2.5 pr-3 font-medium text-slate-700">{t.tlName}</td>
                  <td className="py-2.5 pr-3 text-right text-slate-600">{t.agentCount}</td>
                  <td className="py-2.5 pr-3 text-right font-semibold text-slate-800">{formatINR(t.revenue)}</td>
                  <td className="py-2.5 pr-3 text-right text-slate-600">{formatINR(t.aov)}</td>
                  <td className="py-2.5 pr-0 text-right text-slate-600">{formatINR(t.rpa)}</td>
                </tr>
              ))}
              {data.byTl.length === 0 && (
                <tr><td colSpan={5} className="py-6 text-center text-slate-400">No data.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}

/* ================================ DAY WISE TAB ================================ */

function DayWiseTab({ from, to, agents }: { from: string; to: string; agents: string[] }) {
  const [agent, setAgent] = useState("Overall");
  const [data, setData] = useState<HPDayWiseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    hrmsApi.get<{ success: boolean; data: HPDayWiseData }>(`${HP_API}/day-wise?from=${from}&to=${to}&agent=${encodeURIComponent(agent)}`)
      .then((res) => { if (!cancelled) setData(res.data); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load Day Wise Performance."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [from, to, agent]);

  if (loading && !data) return <Spinner tone="blue" />;
  if (error) return <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-slate-500">Agent:</span>
        <select value={agent} onChange={(e) => setAgent(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm focus:border-indigo-400 focus:outline-none">
          <option value="Overall">Overall</option>
          {agents.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      <SectionCard icon={ShoppingCart} title="Revenue and sales by day" tone="indigo">
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={data.days} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="date" tickFormatter={fmtShortDay} tick={{ fontSize: 10 }} />
            <YAxis yAxisId="l" tick={{ fontSize: 10 }} />
            <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10 }} />
            <Tooltip {...TOOLTIP_PROPS} labelFormatter={(v) => fmtDate(String(v))} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar yAxisId="l" dataKey="revenue" name="Revenue" fill="#c7d2fe" radius={[4, 4, 0, 0]} />
            <Line yAxisId="r" type="monotone" dataKey="saleCount" name="Sale count" stroke="#4f46e5" strokeWidth={2.5} dot={{ r: 3 }} />
            <Line yAxisId="r" type="monotone" dataKey="connectedPct" name="Connected %" stroke="#059669" strokeWidth={2.5} dot={{ r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </SectionCard>

      <SectionCard icon={Clock} title="Day Wise Performance" tone="blue" footnote="Matches the reference workbook's Day Wise Agent Performance / Date Wise Performance sheets, combined into one agent-selectable table.">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-3 font-semibold">Day</th><th className="py-2 pr-3 font-semibold">Date</th>
                <th className="py-2 pr-3 text-right font-semibold">Target</th><th className="py-2 pr-3 text-right font-semibold">Total Calls</th>
                <th className="py-2 pr-3 text-right font-semibold">Connected</th><th className="py-2 pr-3 text-right font-semibold">Not Connected</th>
                <th className="py-2 pr-3 text-right font-semibold">Unique Conn.</th><th className="py-2 pr-3 text-right font-semibold">Cont%</th>
                <th className="py-2 pr-3 text-right font-semibold">Avg Talk</th><th className="py-2 pr-3 text-right font-semibold">Sale Count</th>
                <th className="py-2 pr-3 text-right font-semibold">Revenue</th><th className="py-2 pr-3 text-right font-semibold">AOV</th>
                <th className="py-2 pr-3 text-right font-semibold">Present</th><th className="py-2 pr-0 text-right font-semibold">Avg Sale/Agent</th>
              </tr>
            </thead>
            <tbody>
              {data.days.map((d) => (
                <tr key={d.date} className="border-b border-slate-50 last:border-0 hover:bg-indigo-50/40">
                  <td className="py-2 pr-3 font-medium text-slate-700">{d.dayName}</td>
                  <td className="py-2 pr-3 text-slate-600">{fmtDate(d.date)}</td>
                  <td className="py-2 pr-3 text-right text-slate-600">{formatINR(d.target)}</td>
                  <td className="py-2 pr-3 text-right text-slate-600">{fmtN(d.totalCalls)}</td>
                  <td className="py-2 pr-3 text-right text-slate-600">{fmtN(d.connected)}</td>
                  <td className="py-2 pr-3 text-right text-slate-600">{fmtN(d.notConnected)}</td>
                  <td className="py-2 pr-3 text-right text-slate-600">{fmtN(d.uniqueConnected)}</td>
                  <td className="py-2 pr-3 text-right font-semibold text-slate-800">{fmtPct(d.connectedPct)}</td>
                  <td className="py-2 pr-3 text-right text-slate-600">{d.avgTalkTimeSec ? secToHms(d.avgTalkTimeSec) : "—"}</td>
                  <td className="py-2 pr-3 text-right text-slate-600">{fmtN(d.saleCount)}</td>
                  <td className="py-2 pr-3 text-right font-semibold text-slate-800">{formatINR(d.revenue)}</td>
                  <td className="py-2 pr-3 text-right text-slate-600">{formatINR(d.aov)}</td>
                  <td className="py-2 pr-3 text-right text-slate-600">{fmtN(d.presentCount)}</td>
                  <td className="py-2 pr-0 text-right text-slate-600">{d.avgSalePerAgent}</td>
                </tr>
              ))}
              {data.days.length === 0 && <tr><td colSpan={14} className="py-6 text-center text-slate-400">No data for this period.</td></tr>}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}

/* =============================== AGENT WISE TAB ================================ */

function AgentWiseTab({ from, to, onOpen }: { from: string; to: string; onOpen: (name: string) => void }) {
  const [data, setData] = useState<HPAgentWiseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    hrmsApi.get<{ success: boolean; data: HPAgentWiseData }>(`${HP_API}/agent-wise?from=${from}&to=${to}`)
      .then((res) => { if (!cancelled) setData(res.data); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load Agent Wise Performance."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [from, to]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = data?.agents ?? [];
    return q ? list.filter((a) => a.name.toLowerCase().includes(q) || a.empId.toLowerCase().includes(q) || a.tlName.toLowerCase().includes(q)) : list;
  }, [data, search]);

  const top3 = useMemo(() => (data?.agents ?? []).filter((a) => a.saleCount > 0).slice(0, 3), [data]);

  if (loading && !data) return <Spinner tone="blue" />;
  if (error) return <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return null;

  return (
    <div className="space-y-5">
      {top3.length > 0 && (
        <div className="grid gap-3 md:grid-cols-3">
          {top3.map((a, i) => (
            <button key={a.empId || a.name} type="button" onClick={() => onOpen(a.name)}
              className="group relative overflow-hidden rounded-2xl border border-slate-100 bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">
              <div className={`absolute inset-x-0 top-0 h-1 ${["bg-amber-400", "bg-slate-300", "bg-orange-300"][i]}`} />
              <div className="flex items-center gap-3">
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${["bg-amber-100 text-amber-700", "bg-slate-100 text-slate-600", "bg-orange-100 text-orange-700"][i]}`}><Trophy className="h-4 w-4" /></span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-800">{a.name}</p>
                  <p className="text-[11px] text-slate-400">{fmtN(a.saleCount)} sales · {a.tlName}</p>
                </div>
                <div className="ml-auto text-right">
                  <p className="text-lg font-bold text-emerald-600">{formatINR(a.revenue)}</p>
                  <p className="text-[10px] text-slate-400">revenue</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search agent, id or TL..."
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs text-slate-700 shadow-sm focus:border-indigo-400 focus:outline-none" />
        </div>
        <div className="flex items-center gap-2">
          <HintChip />
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-500"><ListFilter className="h-3 w-3" />{rows.length} of {data.agents.length}</span>
        </div>
      </div>

      <SectionCard icon={Users} title="Agent Wise Performance" tone="indigo">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-3 font-semibold">Agent</th><th className="py-2 pr-3 font-semibold">TL</th>
                <th className="py-2 pr-3 font-semibold">Bucket</th><th className="py-2 pr-3 font-semibold">Status</th>
                <th className="py-2 pr-3 text-right font-semibold">Target</th><th className="py-2 pr-3 text-right font-semibold">Calls</th>
                <th className="py-2 pr-3 text-right font-semibold">Connected</th><th className="py-2 pr-3 text-right font-semibold">Cont%</th>
                <th className="py-2 pr-3 text-right font-semibold">Avg Talk</th><th className="py-2 pr-3 text-right font-semibold">Sale Count</th>
                <th className="py-2 pr-3 text-right font-semibold">Revenue</th><th className="py-2 pr-3 text-right font-semibold">AOV</th>
                <th className="py-2 pr-0 text-right font-semibold">Ach%</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.empId || a.name} role="button" tabIndex={0} onClick={() => onOpen(a.name)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(a.name); } }}
                  className="cursor-pointer border-b border-slate-50 transition-colors last:border-0 hover:bg-indigo-50/50 focus:bg-indigo-50/60 focus:outline-none">
                  <td className="py-2.5 pr-3"><div className="font-medium text-slate-700">{a.name}</div><div className="text-[11px] text-slate-400">{a.empId || "—"}</div></td>
                  <td className="py-2.5 pr-3 text-slate-600">{a.tlName}</td>
                  <td className="py-2.5 pr-3 text-slate-600">{a.bucket}</td>
                  <td className="py-2.5 pr-3"><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${a.status === "Active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{a.status}</span></td>
                  <td className="py-2.5 pr-3 text-right text-slate-600">{formatINR(a.target)}</td>
                  <td className="py-2.5 pr-3 text-right text-slate-600">{fmtN(a.totalCalls)}</td>
                  <td className="py-2.5 pr-3 text-right text-slate-600">{fmtN(a.connected)}</td>
                  <td className="py-2.5 pr-3 text-right text-slate-600">{fmtPct(a.connectedPct)}</td>
                  <td className="py-2.5 pr-3 text-right text-slate-600">{a.avgTalkTimeSec ? secToHms(a.avgTalkTimeSec) : "—"}</td>
                  <td className="py-2.5 pr-3 text-right text-slate-600">{fmtN(a.saleCount)}</td>
                  <td className="py-2.5 pr-3 text-right font-semibold text-slate-800">{formatINR(a.revenue)}</td>
                  <td className="py-2.5 pr-3 text-right text-slate-600">{formatINR(a.aov)}</td>
                  <td className="py-2.5 pr-0 text-right font-semibold text-indigo-700">{fmtPct(a.achievedPct)}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={13} className="py-6 text-center text-slate-400">No agents match this search.</td></tr>}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}

/* ================================ SLOT WISE TAB ================================ */

function SlotWiseTab({ from, to, agents }: { from: string; to: string; agents: string[] }) {
  const [agent, setAgent] = useState("Overall");
  const [data, setData] = useState<HPSlotWiseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    hrmsApi.get<{ success: boolean; data: HPSlotWiseData }>(`${HP_API}/slot-wise?from=${from}&to=${to}&agent=${encodeURIComponent(agent)}`)
      .then((res) => { if (!cancelled) setData(res.data); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load Slot Wise Performance."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [from, to, agent]);

  if (loading && !data) return <Spinner tone="blue" />;
  if (error) return <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return null;

  const maxCalls = Math.max(1, ...data.slots.map((s) => s.totalCalls));
  const nonZero = data.slots.some((s) => s.totalCalls > 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-slate-500">Agent:</span>
        <select value={agent} onChange={(e) => setAgent(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm focus:border-indigo-400 focus:outline-none">
          <option value="Overall">Overall</option>
          {agents.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      <p className="flex items-start gap-2 rounded-xl border border-slate-100 bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-500">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />{data.saleByHourNote}
      </p>

      {!nonZero ? (
        <div className="flex items-center gap-2 rounded-xl border border-dashed border-slate-200 bg-white p-6 text-sm text-slate-400"><Inbox className="h-5 w-5" /> No call records with a valid hour in this range yet.</div>
      ) : (
        <SectionCard icon={Clock} title="Calls and connect rate by hour" tone="emerald">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-12">
            {data.slots.map((s) => (
              <div key={s.hour} style={heatStyle(s.connectedPct, 100)} className="rounded-xl border border-emerald-100 p-2.5 text-center transition-transform hover:-translate-y-0.5" title={`${s.totalCalls} calls, ${s.connected} connected`}>
                <p className="text-[11px] font-semibold text-slate-700">{hourLabel(s.hour)}</p>
                <p className="text-base font-bold text-emerald-900">{s.totalCalls > 0 ? `${Math.round(s.connectedPct)}%` : "—"}</p>
                <p className="text-[10px] text-slate-600">{s.totalCalls} calls</p>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      <SectionCard icon={Clock} title="Slot Wise Performance" tone="blue">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-3 font-semibold">Hour</th><th className="py-2 pr-3 text-right font-semibold">Total Calls</th>
                <th className="py-2 pr-3 text-right font-semibold">Connected</th><th className="py-2 pr-3 text-right font-semibold">Not Connected</th>
                <th className="py-2 pr-0 text-right font-semibold">Cont%</th><th className="py-2 pr-0 text-right font-semibold">Avg Talk</th>
              </tr>
            </thead>
            <tbody>
              {data.slots.filter((s) => s.totalCalls > 0).map((s) => (
                <tr key={s.hour} className="border-b border-slate-50 last:border-0 hover:bg-indigo-50/40">
                  <td className="py-2 pr-3 font-medium text-slate-700">{hourLabel(s.hour)}</td>
                  <td className="py-2 pr-3"><MiniBar pct={(s.totalCalls / maxCalls) * 100} color="#6366f1" /></td>
                  <td className="py-2 pr-3 text-right text-slate-600">{fmtN(s.connected)}</td>
                  <td className="py-2 pr-3 text-right text-slate-600">{fmtN(s.notConnected)}</td>
                  <td className="py-2 pr-0 text-right font-semibold text-slate-800">{fmtPct(s.connectedPct)}</td>
                  <td className="py-2 pr-0 text-right text-slate-600">{s.avgTalkTimeSec ? secToHms(s.avgTalkTimeSec) : "—"}</td>
                </tr>
              ))}
              {!nonZero && <tr><td colSpan={6} className="py-6 text-center text-slate-400">No data for this period.</td></tr>}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}

/* ============================== TARGET ACHIEVEMENT TAB ========================= */

function TqMqBqAgentsTab({ month, onOpen }: { month: string; onOpen: (name: string) => void }) {
  const [data, setData] = useState<HPTqMqBqAgentsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [expandedWeeks, setExpandedWeeks] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    hrmsApi.get<{ success: boolean; data: HPTqMqBqAgentsData }>(`${HP_API}/tq-mq-bq/agents?month=${month}`)
      .then((res) => { if (!cancelled) setData(res.data); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load Target Achievement."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [month]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = data?.agents ?? [];
    return q ? list.filter((a) => a.name.toLowerCase().includes(q) || a.tlName.toLowerCase().includes(q)) : list;
  }, [data, search]);

  const stageCounts = useMemo(() => {
    const c = { TQ: 0, MQ: 0, BQ: 0, "-": 0 } as Record<HPStage, number>;
    for (const a of data?.agents ?? []) c[a.stage] += 1;
    return c;
  }, [data]);

  if (loading && !data) return <Spinner tone="blue" />;
  if (error) return <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return null;

  const pieData = (["TQ", "MQ", "BQ"] as HPStage[]).map((s) => ({ name: STAGE_LABEL[s], value: stageCounts[s], stage: s })).filter((d) => d.value > 0);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 grid grid-cols-3 gap-3">
          <KpiCard icon={Trophy} label="TQ agents" value={String(stageCounts.TQ)} sub=">80% achieved" tone="emerald" />
          <KpiCard icon={Gauge} label="MQ agents" value={String(stageCounts.MQ)} sub="60-80% achieved" tone="amber" />
          <KpiCard icon={UserX} label="BQ agents" value={String(stageCounts.BQ)} sub="<60% achieved" tone="red" />
        </div>
        <SectionCard icon={ShieldCheck} title="Stage mix" tone="violet">
          <ResponsiveContainer width="100%" height={140}>
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={40} outerRadius={64} paddingAngle={2} stroke="none">
                {pieData.map((d) => <Cell key={d.stage} fill={STAGE_COLORS[d.stage]} />)}
              </Pie>
              <Tooltip {...TOOLTIP_PROPS} />
            </PieChart>
          </ResponsiveContainer>
        </SectionCard>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search agent or TL..."
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs text-slate-700 shadow-sm focus:border-indigo-400 focus:outline-none" />
        </div>
        <button type="button" onClick={() => setExpandedWeeks((v) => !v)} className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200">
          {expandedWeeks ? "Hide weekly columns" : "Show weekly columns"}
        </button>
      </div>

      <SectionCard icon={Trophy} title={`Agent Wise Target Achievement — as of ${fmtDate(data.asOfDate)}`} tone="indigo" footnote="TQ/MQ/BQ thresholds match the reference workbook: TQ above 80% of MTD target, MQ 60-80%, BQ below 60%. Rank is among Active agents only.">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-3 font-semibold">Rank</th><th className="py-2 pr-3 font-semibold">Agent</th><th className="py-2 pr-3 font-semibold">TL</th>
                <th className="py-2 pr-3 text-right font-semibold">Target</th><th className="py-2 pr-3 text-right font-semibold">MTD Target</th>
                <th className="py-2 pr-3 text-right font-semibold">Achieved</th><th className="py-2 pr-3 text-right font-semibold">Sale Count</th>
                <th className="py-2 pr-3 text-right font-semibold">AOV</th><th className="py-2 pr-3 text-right font-semibold">Remaining</th>
                <th className="py-2 pr-3 text-right font-semibold">Ach%</th><th className="py-2 pr-3 font-semibold">Stage</th>
                {expandedWeeks && data.agents[0]?.weeks.map((w) => <th key={w.label} className="py-2 pr-3 text-right font-semibold text-violet-600">{w.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.empId || a.name} role="button" tabIndex={0} onClick={() => onOpen(a.name)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(a.name); } }}
                  className="cursor-pointer border-b border-slate-50 last:border-0 hover:bg-indigo-50/40">
                  <td className="py-2 pr-3 text-slate-500">{a.rank ?? "—"}</td>
                  <td className="py-2 pr-3"><div className="font-medium text-slate-700">{a.name}</div><div className="text-[10px] text-slate-400">{a.status}</div></td>
                  <td className="py-2 pr-3 text-slate-600">{a.tlName}</td>
                  <td className="py-2 pr-3 text-right text-slate-600">{formatINR(a.target)}</td>
                  <td className="py-2 pr-3 text-right text-slate-600">{formatINR(a.mtdTarget)}</td>
                  <td className="py-2 pr-3 text-right font-semibold text-slate-800">{formatINR(a.achieved)}</td>
                  <td className="py-2 pr-3 text-right text-slate-600">{fmtN(a.saleCount)}</td>
                  <td className="py-2 pr-3 text-right text-slate-600">{formatINR(a.aov)}</td>
                  <td className="py-2 pr-3 text-right text-slate-600">{formatINR(a.remaining)}</td>
                  <td className="py-2 pr-3 text-right font-semibold text-indigo-700">{fmtPct(a.achievedPct)}</td>
                  <td className="py-2 pr-3"><StageBadge stage={a.stage} /></td>
                  {expandedWeeks && a.weeks.map((w) => (
                    <td key={w.label} className="py-2 pr-3 text-right text-slate-600">{formatINR(w.achievement)} <span className="text-[10px]" style={{ color: STAGE_COLORS[w.stage] }}>{w.stage}</span></td>
                  ))}
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={11} className="py-6 text-center text-slate-400">No agents match this search.</td></tr>}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}

/* ================================ TL TARGET TAB ================================= */

function TlTargetTab({ month }: { month: string }) {
  const [data, setData] = useState<HPTqMqBqTlData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    hrmsApi.get<{ success: boolean; data: HPTqMqBqTlData }>(`${HP_API}/tq-mq-bq/tl?month=${month}`)
      .then((res) => { if (!cancelled) setData(res.data); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load TL Target."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [month]);

  if (loading && !data) return <Spinner tone="blue" />;
  if (error) return <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return null;

  return (
    <div className="space-y-5">
      <SectionCard icon={Users} title="Target vs Achievement by TL" tone="blue">
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={data.tls.map((t) => ({ tl: t.tlName, target: t.target, achievement: t.achievement }))} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="tl" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip {...TOOLTIP_PROPS} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="target" name="Target" fill="#c7d2fe" radius={[4, 4, 0, 0]} />
            <Bar dataKey="achievement" name="Achievement" fill="#4f46e5" radius={[4, 4, 0, 0]} />
          </ComposedChart>
        </ResponsiveContainer>
      </SectionCard>

      <SectionCard icon={Trophy} title={`TL Wise Target — as of ${fmtDate(data.asOfDate)}`} tone="indigo" footnote="DRR = Target / 30. Current DRR = DRR × day of month reached. Till-Day Ach% compares Achievement to (DRR × day of month), the daily-run-rate expectation so far.">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-3 font-semibold">TL</th><th className="py-2 pr-3 text-right font-semibold">Agents</th>
                <th className="py-2 pr-3 text-right font-semibold">Target</th><th className="py-2 pr-3 text-right font-semibold">Achievement</th>
                <th className="py-2 pr-3 text-right font-semibold">Remaining</th><th className="py-2 pr-3 text-right font-semibold">Sale Count</th>
                <th className="py-2 pr-3 text-right font-semibold">DRR</th><th className="py-2 pr-3 text-right font-semibold">Current DRR</th>
                <th className="py-2 pr-3 text-right font-semibold">Till-Day Ach%</th><th className="py-2 pr-0 font-semibold">Stage</th>
              </tr>
            </thead>
            <tbody>
              {data.tls.map((t) => (
                <tr key={t.tlName} className="border-b border-slate-50 last:border-0 hover:bg-indigo-50/40">
                  <td className="py-2.5 pr-3 font-medium text-slate-700">{t.tlName}</td>
                  <td className="py-2.5 pr-3 text-right text-slate-600">{t.agentCount}</td>
                  <td className="py-2.5 pr-3 text-right text-slate-600">{formatINR(t.target)}</td>
                  <td className="py-2.5 pr-3 text-right font-semibold text-slate-800">{formatINR(t.achievement)}</td>
                  <td className="py-2.5 pr-3 text-right text-slate-600">{formatINR(t.remaining)}</td>
                  <td className="py-2.5 pr-3 text-right text-slate-600">{fmtN(t.saleCount)}</td>
                  <td className="py-2.5 pr-3 text-right text-slate-600">{formatINR(t.drr)}</td>
                  <td className="py-2.5 pr-3 text-right text-slate-600">{formatINR(t.currentDrr)}</td>
                  <td className="py-2.5 pr-3 text-right font-semibold text-indigo-700">{fmtPct(t.tillDayAchievedPct)}</td>
                  <td className="py-2.5 pr-0"><StageBadge stage={t.stage} /></td>
                </tr>
              ))}
              {data.tls.length === 0 && <tr><td colSpan={10} className="py-6 text-center text-slate-400">No data.</td></tr>}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}

/* ================================ TEAM DETAILS TAB ============================== */

function TeamDetailsTab({ onOpen }: { onOpen: (name: string) => void }) {
  const [data, setData] = useState<HPTeamDetailsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    hrmsApi.get<{ success: boolean; data: HPTeamDetailsData }>(`${HP_API}/team-details`)
      .then((res) => { if (!cancelled) setData(res.data); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load Team Details."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = data?.rows ?? [];
    return q ? list.filter((r) => r.name.toLowerCase().includes(q) || r.tlName.toLowerCase().includes(q) || r.empId.toLowerCase().includes(q)) : list;
  }, [data, search]);

  if (loading && !data) return <Spinner tone="blue" />;
  if (error) return <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, id or TL..."
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs text-slate-700 shadow-sm focus:border-indigo-400 focus:outline-none" />
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-500"><ListFilter className="h-3 w-3" />{rows.length} of {data.rows.length}</span>
      </div>

      <SectionCard icon={Users} title="Team Details" tone="indigo" footnote="Computed Revenue is a live SUM of this agent's Sale rows, checked against the achievement figure uploaded with the roster. A mismatch means the roster wasn't refreshed after the sales it should reflect.">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-3 font-semibold">Emp ID</th><th className="py-2 pr-3 font-semibold">Name</th><th className="py-2 pr-3 font-semibold">TL</th>
                <th className="py-2 pr-3 font-semibold">Center</th><th className="py-2 pr-3 font-semibold">DOJ</th><th className="py-2 pr-3 font-semibold">Bucket</th>
                <th className="py-2 pr-3 font-semibold">Status</th><th className="py-2 pr-3 text-right font-semibold">Target</th>
                <th className="py-2 pr-3 text-right font-semibold">Roster Achv.</th><th className="py-2 pr-3 text-right font-semibold">Computed Rev.</th>
                <th className="py-2 pr-0 font-semibold">Match</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.empId || r.name} role="button" tabIndex={0} onClick={() => onOpen(r.name)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(r.name); } }}
                  className={`cursor-pointer border-b border-slate-50 last:border-0 hover:bg-indigo-50/40 ${r.achievementMismatch ? "bg-amber-50/50" : ""}`}>
                  <td className="py-2 pr-3 text-slate-500">{r.empId || "—"}</td>
                  <td className="py-2 pr-3 font-medium text-slate-700">{r.name}</td>
                  <td className="py-2 pr-3 text-slate-600">{r.tlName}</td>
                  <td className="py-2 pr-3 text-slate-600">{r.center}</td>
                  <td className="py-2 pr-3 text-slate-600">{fmtMdy(r.doj)}</td>
                  <td className="py-2 pr-3 text-slate-600">{r.bucket}</td>
                  <td className="py-2 pr-3"><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${r.status === "Active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{r.status}</span></td>
                  <td className="py-2 pr-3 text-right text-slate-600">{formatINR(r.target)}</td>
                  <td className="py-2 pr-3 text-right text-slate-600">{formatINR(r.uploadedAchievement)}</td>
                  <td className="py-2 pr-3 text-right font-semibold text-slate-800">{formatINR(r.computedRevenue)}</td>
                  <td className="py-2 pr-0">
                    {r.achievementMismatch
                      ? <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700"><AlertTriangle className="h-3 w-3" />{formatINR(r.mismatchAmount)}</span>
                      : <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700"><ShieldCheck className="h-3 w-3" />Match</span>}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={11} className="py-6 text-center text-slate-400">No agents match this search.</td></tr>}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}

/* =================================== ROOT =================================== */

export function HousingPremiumSaleDashboard() {
  const defaultRange = currentMonthRange();
  const [from, setFrom] = useState(defaultRange.from);
  const [to, setTo] = useState(defaultRange.to);
  const [tab, setTab] = useState<TabKey>("overview");
  const [drawerAgent, setDrawerAgent] = useState<string | null>(null);
  const [agentNames, setAgentNames] = useState<string[]>([]);

  const fetchAgentNames = useCallback(() => {
    hrmsApi.get<{ success: boolean; data: HPAgentWiseData }>(`${HP_API}/agent-wise?from=${from}&to=${to}`)
      .then((res) => setAgentNames(res.data.agents.map((a) => a.name).sort()))
      .catch(() => { /* non-critical -- the agent dropdown just stays "Overall" only */ });
  }, [from, to]);
  useEffect(() => { fetchAgentNames(); }, [fetchAgentNames]);

  const month = from.slice(0, 7);
  const eyebrow = "Housing Premium · Process Performance";

  return (
    <div className="space-y-5">
      <DashboardHero<TabKey>
        icon={ListChecks} eyebrow={eyebrow} title="Housing Premium MIS Dashboard"
        tabs={TABS} activeTab={tab} onTabChange={setTab}
        gradient="from-indigo-700 via-blue-700 to-indigo-800"
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] text-slate-400">Rebuilt from the reference Housing Premium MIS Excel workbook — every metric and formula is documented in the backend service.</span>
        <DateRangeToolbar
          from={from} to={to} onFrom={setFrom} onTo={setTo}
          onReset={() => { const r = currentMonthRange(); setFrom(r.from); setTo(r.to); }}
          accentFocus="focus:border-indigo-400"
        />
      </div>

      {tab === "overview" && <OverviewTab from={from} to={to} />}
      {tab === "daywise" && <DayWiseTab from={from} to={to} agents={agentNames} />}
      {tab === "agentwise" && <AgentWiseTab from={from} to={to} onOpen={setDrawerAgent} />}
      {tab === "slotwise" && <SlotWiseTab from={from} to={to} agents={agentNames} />}
      {tab === "tqmqbq" && <TqMqBqAgentsTab month={month} onOpen={setDrawerAgent} />}
      {tab === "tlTarget" && <TlTargetTab month={month} />}
      {tab === "team" && <TeamDetailsTab onOpen={setDrawerAgent} />}

      {drawerAgent && <HousingPremiumAgentDrawer agent={drawerAgent} from={from} to={to} onClose={() => setDrawerAgent(null)} />}
    </div>
  );
}
