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
  formatINR, currentMonthRange, DrawerExcelButton, type DrawerSheet,
} from "./DashboardKit";
import { HousingPremiumAgentDrawer } from "./HousingPremiumAgentDrawer";
import { HousingPremiumOutboundDashboard } from "./HousingPremiumOutboundDashboard";
import { useSortableRows } from "./useSortableRows";
import { SortTh } from "./SortTh";
import { FilterSortTh, useColumnFilters, type FilterColumn } from "./ColumnFilterHeader";
import {
  type HPOverviewData, type HPDayWiseData, type HPAgentWiseData,
  type HPTqMqBqAgentsData, type HPTqMqBqTlData, type HPTeamDetailsData, type HPValidation, type HPStage,
  HP_API, STAGE_COLORS, STAGE_LABEL, fmtN, fmtPct, fmtDate, fmtShortDay, fmtMdy,
  secToHms, secToShort,
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

type TabKey = "dashboard" | "overview" | "daywise" | "agentwise" | "tqmqbq" | "tlTarget" | "team";
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "dashboard", label: "Dashboard" },
  { key: "agentwise", label: "Agent Wise" },
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
  const [tlMetric, setTlMetric] = useState<string>("revenue");

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
  type TlRevenueRow = { tlName: string; agentCount: number; revenue: number; aov: number; rpa: number };
  const tlRevenueColGetter = (t: TlRevenueRow, key: string) => {
    switch (key) {
      case "tlName": return t.tlName;
      case "agentCount": return t.agentCount;
      case "revenue": return t.revenue;
      case "aov": return t.aov;
      case "rpa": return t.rpa;
      default: return null;
    }
  };
  const TL_REVENUE_FILTER_COLS: Array<FilterColumn<TlRevenueRow>> = [
    { key: "tlName", get: (t) => t.tlName }, { key: "agentCount", get: (t) => t.agentCount },
    { key: "revenue", get: (t) => t.revenue }, { key: "aov", get: (t) => t.aov }, { key: "rpa", get: (t) => t.rpa },
  ];
  const tlRevenueFilters = useColumnFilters(tlRevenueRows, TL_REVENUE_FILTER_COLS);
  const tlRevenueSort = useSortableRows<TlRevenueRow>(tlRevenueFilters.filtered, tlRevenueColGetter);

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

      <SectionCard
        icon={Users} title="TL Wise — Date Wise Performance" tone="violet"
        footnote="One row per TL plus Overall, one column per week and day of the selected range. Click a TL row to open that TL's full metric matrix above."
        action={
          <select value={tlMetric} onChange={(e) => setTlMetric(e.target.value)} aria-label="Metric" className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm focus:border-indigo-400 focus:outline-none">
            {OVERVIEW_ROWS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
        }
      >
        {(() => {
          const row = OVERVIEW_ROWS.find((r) => r.key === tlMetric) ?? OVERVIEW_ROWS[0];
          const lines = [{ name: "Overall", scopeKey: "__overall__", values: data.overall }, ...data.byTl.map((t) => ({ name: t.tlName, scopeKey: t.tlName, values: t.values }))];
          return (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="border-collapse text-center text-[13px] tabular-nums">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 min-w-[160px] border-b border-[#0f1a44] bg-[#1c2a5e] px-4 py-3 text-left text-sm font-bold text-white">TL — {row.label}</th>
                    {data.columns.map((c) => <th key={c.key} className="min-w-[86px] border-b border-l border-[#0f1a44] bg-[#1c2a5e] px-3 py-3 text-sm font-bold text-white">{c.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.scopeKey} role="button" tabIndex={0} onClick={() => { setScope(l.scopeKey); window.scrollTo({ top: 0, behavior: "smooth" }); }} onKeyDown={(e) => { if (e.key === "Enter") setScope(l.scopeKey); }} className="cursor-pointer hover:brightness-95">
                      <td className="sticky left-0 z-10 border-b border-[#e7d6ad] bg-[#fff2cc] px-4 py-2.5 text-left font-semibold text-slate-800">{l.name}</td>
                      {data.columns.map((c) => (
                        <td key={c.key} className={`border-b border-l border-[#e7d6ad] px-3 py-2.5 ${c.kind === "mtd" ? "bg-[#f4b183] font-bold text-slate-900" : "bg-[#f8cbad]/60 text-slate-800"}`}>
                          {formatVal((l.values[c.key] as HPOverviewData["overall"][string] | undefined)?.[row.key], row.fmt)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })()}
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

      <SectionCard
        icon={Users} title="TL-wise Revenue, AOV & RPA (MTD)" tone="indigo"
        action={tlRevenueFilters.activeCount > 0 ? (
          <button type="button" onClick={tlRevenueFilters.clearAll} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-200">
            Clear {tlRevenueFilters.activeCount} filter{tlRevenueFilters.activeCount > 1 ? "s" : ""}
          </button>
        ) : undefined}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                <FilterSortTh label="TL" columnKey="tlName" sortKey={tlRevenueSort.sortKey} sortDir={tlRevenueSort.sortDir} onSort={tlRevenueSort.toggleSort} filters={tlRevenueFilters} className="py-2 pr-3 font-semibold" />
                <FilterSortTh label="Agents" columnKey="agentCount" sortKey={tlRevenueSort.sortKey} sortDir={tlRevenueSort.sortDir} onSort={tlRevenueSort.toggleSort} filters={tlRevenueFilters} className="py-2 pr-3 text-right font-semibold" />
                <FilterSortTh label="Revenue" columnKey="revenue" sortKey={tlRevenueSort.sortKey} sortDir={tlRevenueSort.sortDir} onSort={tlRevenueSort.toggleSort} filters={tlRevenueFilters} className="py-2 pr-3 text-right font-semibold" />
                <FilterSortTh label="AOV" columnKey="aov" sortKey={tlRevenueSort.sortKey} sortDir={tlRevenueSort.sortDir} onSort={tlRevenueSort.toggleSort} filters={tlRevenueFilters} className="py-2 pr-3 text-right font-semibold" />
                <FilterSortTh label="RPA" columnKey="rpa" sortKey={tlRevenueSort.sortKey} sortDir={tlRevenueSort.sortDir} onSort={tlRevenueSort.toggleSort} filters={tlRevenueFilters} className="py-2 pr-0 text-right font-semibold" />
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
              {tlRevenueSort.sorted.length === 0 && (
                <tr><td colSpan={5} className="py-6 text-center text-slate-400">{data.byTl.length === 0 ? "No data." : "No TLs match the current filters."}</td></tr>
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

  type DayRow = HPDayWiseData["days"][number];
  const DAY_FILTER_COLS: Array<FilterColumn<DayRow>> = [
    { key: "dayName", get: (d) => d.dayName }, { key: "date", get: (d) => d.date }, { key: "target", get: (d) => d.target },
    { key: "totalCalls", get: (d) => d.totalCalls }, { key: "connected", get: (d) => d.connected }, { key: "notConnected", get: (d) => d.notConnected },
    { key: "uniqueConnected", get: (d) => d.uniqueConnected }, { key: "connectedPct", get: (d) => d.connectedPct },
    { key: "avgTalkTimeSec", get: (d) => d.avgTalkTimeSec }, { key: "saleCount", get: (d) => d.saleCount }, { key: "revenue", get: (d) => d.revenue },
    { key: "aov", get: (d) => d.aov }, { key: "presentCount", get: (d) => d.presentCount }, { key: "avgSalePerAgent", get: (d) => d.avgSalePerAgent },
  ];
  const dayColGetter = (d: DayRow, key: string) => DAY_FILTER_COLS.find((c) => c.key === key)?.get(d);
  const dayFilters = useColumnFilters(data?.days ?? [], DAY_FILTER_COLS);
  const { sorted: sortedDays, sortKey: daySortKey, sortDir: daySortDir, toggleSort: toggleDaySort } = useSortableRows(dayFilters.filtered, dayColGetter);

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

      <SectionCard
        icon={Clock} title="Day Wise Performance" tone="blue" footnote="Matches the reference workbook's Day Wise Agent Performance / Date Wise Performance sheets, combined into one agent-selectable table."
        action={dayFilters.activeCount > 0 ? (
          <button type="button" onClick={dayFilters.clearAll} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-200">
            Clear {dayFilters.activeCount} filter{dayFilters.activeCount > 1 ? "s" : ""}
          </button>
        ) : undefined}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                <FilterSortTh label="Day" columnKey="dayName" sortKey={daySortKey} sortDir={daySortDir} onSort={toggleDaySort} filters={dayFilters} className="py-2 pr-3 font-semibold" />
                <FilterSortTh label="Date" columnKey="date" sortKey={daySortKey} sortDir={daySortDir} onSort={toggleDaySort} filters={dayFilters} className="py-2 pr-3 font-semibold" />
                <FilterSortTh label="Target" columnKey="target" sortKey={daySortKey} sortDir={daySortDir} onSort={toggleDaySort} filters={dayFilters} className="py-2 pr-3 text-right font-semibold" />
                <FilterSortTh label="Total Calls" columnKey="totalCalls" sortKey={daySortKey} sortDir={daySortDir} onSort={toggleDaySort} filters={dayFilters} className="py-2 pr-3 text-right font-semibold" />
                <FilterSortTh label="Connected" columnKey="connected" sortKey={daySortKey} sortDir={daySortDir} onSort={toggleDaySort} filters={dayFilters} className="py-2 pr-3 text-right font-semibold" />
                <FilterSortTh label="Not Connected" columnKey="notConnected" sortKey={daySortKey} sortDir={daySortDir} onSort={toggleDaySort} filters={dayFilters} className="py-2 pr-3 text-right font-semibold" />
                <FilterSortTh label="Unique Conn." columnKey="uniqueConnected" sortKey={daySortKey} sortDir={daySortDir} onSort={toggleDaySort} filters={dayFilters} className="py-2 pr-3 text-right font-semibold" />
                <FilterSortTh label="Cont%" columnKey="connectedPct" sortKey={daySortKey} sortDir={daySortDir} onSort={toggleDaySort} filters={dayFilters} className="py-2 pr-3 text-right font-semibold" />
                <FilterSortTh label="Avg Talk" columnKey="avgTalkTimeSec" sortKey={daySortKey} sortDir={daySortDir} onSort={toggleDaySort} filters={dayFilters} className="py-2 pr-3 text-right font-semibold" />
                <FilterSortTh label="Sale Count" columnKey="saleCount" sortKey={daySortKey} sortDir={daySortDir} onSort={toggleDaySort} filters={dayFilters} className="py-2 pr-3 text-right font-semibold" />
                <FilterSortTh label="Revenue" columnKey="revenue" sortKey={daySortKey} sortDir={daySortDir} onSort={toggleDaySort} filters={dayFilters} className="py-2 pr-3 text-right font-semibold" />
                <FilterSortTh label="AOV" columnKey="aov" sortKey={daySortKey} sortDir={daySortDir} onSort={toggleDaySort} filters={dayFilters} className="py-2 pr-3 text-right font-semibold" />
                <FilterSortTh label="Present" columnKey="presentCount" sortKey={daySortKey} sortDir={daySortDir} onSort={toggleDaySort} filters={dayFilters} className="py-2 pr-3 text-right font-semibold" />
                <FilterSortTh label="Avg Sale/Agent" columnKey="avgSalePerAgent" sortKey={daySortKey} sortDir={daySortDir} onSort={toggleDaySort} filters={dayFilters} className="py-2 pr-0 text-right font-semibold" />
              </tr>
            </thead>
            <tbody>
              {sortedDays.map((d) => (
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
              {sortedDays.length === 0 && <tr><td colSpan={14} className="py-6 text-center text-slate-400">{data.days.length === 0 ? "No data for this period." : "No dates match the current filters."}</td></tr>}
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

  type AgentRow = HPAgentWiseData["agents"][number];
  const AGENT_FILTER_COLS: Array<FilterColumn<AgentRow>> = [
    { key: "name", get: (a) => a.name }, { key: "tlName", get: (a) => a.tlName }, { key: "bucket", get: (a) => a.bucket }, { key: "status", get: (a) => a.status },
    { key: "target", get: (a) => a.target }, { key: "totalCalls", get: (a) => a.totalCalls }, { key: "connected", get: (a) => a.connected },
    { key: "connectedPct", get: (a) => a.connectedPct }, { key: "avgTalkTimeSec", get: (a) => a.avgTalkTimeSec }, { key: "saleCount", get: (a) => a.saleCount },
    { key: "revenue", get: (a) => a.revenue }, { key: "aov", get: (a) => a.aov }, { key: "achievedPct", get: (a) => a.achievedPct },
  ];
  const agentColGetter = (a: AgentRow, key: string) => AGENT_FILTER_COLS.find((c) => c.key === key)?.get(a);
  const agentFilters = useColumnFilters(rows, AGENT_FILTER_COLS);
  const { sorted: sortedAgents, sortKey: agentSortKey, sortDir: agentSortDir, toggleSort: toggleAgentSort } = useSortableRows(agentFilters.filtered, agentColGetter);

  const getSheets = (): DrawerSheet[] => [{
    name: "Agent Wise Performance",
    columns: [
      "Agent", "Emp ID", "TL", "DOJ", "Tenure", "Bucket", "Status", "Target", "Total Calls", "Unique Calls",
      "Connected", "Not Connected", "Connected %", "Avg Talk", "Sale Count", "Revenue", "AOV", "Present Count", "Avg Sale/Day", "Achieved %",
    ],
    rows: (data?.agents ?? []).map((a) => [
      a.name, a.empId, a.tlName, a.doj ? fmtDate(a.doj) : "—", a.tenureDays ?? "—", a.bucket, a.status,
      a.target, a.totalCalls, a.uniqueCalls, a.connected, a.notConnected, fmtPct(a.connectedPct),
      a.avgTalkTimeSec ? secToHms(a.avgTalkTimeSec) : "—", a.saleCount, a.revenue, a.aov, a.presentCount, a.avgSalePerDay, fmtPct(a.achievedPct),
    ]),
  }];

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
          <DrawerExcelButton fileBase="Housing_Premium_Agent_Wise_Performance" getSheets={getSheets} disabled={!data || data.agents.length === 0} />
          <HintChip />
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-500"><ListFilter className="h-3 w-3" />{rows.length} of {data.agents.length}</span>
        </div>
      </div>

      <SectionCard
        icon={Users} title="Agent Wise Performance" tone="indigo"
        action={agentFilters.activeCount > 0 ? (
          <button type="button" onClick={agentFilters.clearAll} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-200">
            Clear {agentFilters.activeCount} filter{agentFilters.activeCount > 1 ? "s" : ""}
          </button>
        ) : undefined}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                <FilterSortTh label="Agent" columnKey="name" sortKey={agentSortKey} sortDir={agentSortDir} onSort={toggleAgentSort} filters={agentFilters} className="py-2 pr-3 font-semibold" />
                <FilterSortTh label="TL" columnKey="tlName" sortKey={agentSortKey} sortDir={agentSortDir} onSort={toggleAgentSort} filters={agentFilters} className="py-2 pr-3 font-semibold" />
                <FilterSortTh label="Bucket" columnKey="bucket" sortKey={agentSortKey} sortDir={agentSortDir} onSort={toggleAgentSort} filters={agentFilters} className="py-2 pr-3 font-semibold" />
                <FilterSortTh label="Status" columnKey="status" sortKey={agentSortKey} sortDir={agentSortDir} onSort={toggleAgentSort} filters={agentFilters} className="py-2 pr-3 font-semibold" />
                <FilterSortTh label="Target" columnKey="target" sortKey={agentSortKey} sortDir={agentSortDir} onSort={toggleAgentSort} filters={agentFilters} className="py-2 pr-3 text-right font-semibold" />
                <FilterSortTh label="Calls" columnKey="totalCalls" sortKey={agentSortKey} sortDir={agentSortDir} onSort={toggleAgentSort} filters={agentFilters} className="py-2 pr-3 text-right font-semibold" />
                <FilterSortTh label="Connected" columnKey="connected" sortKey={agentSortKey} sortDir={agentSortDir} onSort={toggleAgentSort} filters={agentFilters} className="py-2 pr-3 text-right font-semibold" />
                <FilterSortTh label="Cont%" columnKey="connectedPct" sortKey={agentSortKey} sortDir={agentSortDir} onSort={toggleAgentSort} filters={agentFilters} className="py-2 pr-3 text-right font-semibold" />
                <FilterSortTh label="Avg Talk" columnKey="avgTalkTimeSec" sortKey={agentSortKey} sortDir={agentSortDir} onSort={toggleAgentSort} filters={agentFilters} className="py-2 pr-3 text-right font-semibold" />
                <FilterSortTh label="Sale Count" columnKey="saleCount" sortKey={agentSortKey} sortDir={agentSortDir} onSort={toggleAgentSort} filters={agentFilters} className="py-2 pr-3 text-right font-semibold" />
                <FilterSortTh label="Revenue" columnKey="revenue" sortKey={agentSortKey} sortDir={agentSortDir} onSort={toggleAgentSort} filters={agentFilters} className="py-2 pr-3 text-right font-semibold" />
                <FilterSortTh label="AOV" columnKey="aov" sortKey={agentSortKey} sortDir={agentSortDir} onSort={toggleAgentSort} filters={agentFilters} className="py-2 pr-3 text-right font-semibold" />
                <FilterSortTh label="Ach%" columnKey="achievedPct" sortKey={agentSortKey} sortDir={agentSortDir} onSort={toggleAgentSort} filters={agentFilters} className="py-2 pr-0 text-right font-semibold" />
              </tr>
            </thead>
            <tbody>
              {sortedAgents.map((a) => (
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
              {sortedAgents.length === 0 && <tr><td colSpan={13} className="py-6 text-center text-slate-400">{rows.length === 0 ? "No agents match this search." : "No agents match the current filters."}</td></tr>}
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

  // Excel-style sort + filter for the fixed columns of the Agent Wise Target Achievement table. The week columns
  // (shown only when "Show weekly columns" is on) are per-agent, variable-length and stay plain -- not worth the
  // added complexity for a toggle-only view.
  type TqRow = HPTqMqBqAgentsData["agents"][number];
  const TQ_FILTER_COLS: Array<FilterColumn<TqRow>> = [
    { key: "rank", get: (a) => a.rank }, { key: "name", get: (a) => a.name }, { key: "tlName", get: (a) => a.tlName },
    { key: "target", get: (a) => a.target }, { key: "mtdTarget", get: (a) => a.mtdTarget }, { key: "achieved", get: (a) => a.achieved },
    { key: "saleCount", get: (a) => a.saleCount }, { key: "aov", get: (a) => a.aov }, { key: "remaining", get: (a) => a.remaining },
    { key: "achievedPct", get: (a) => a.achievedPct }, { key: "stage", get: (a) => a.stage },
  ];
  const tqColGetter = (a: TqRow, key: string) => TQ_FILTER_COLS.find((c) => c.key === key)?.get(a);
  const tqFilters = useColumnFilters(rows, TQ_FILTER_COLS);
  const { sorted: sortedTqRows, sortKey: tqSortKey, sortDir: tqSortDir, toggleSort: toggleTqSort } = useSortableRows(tqFilters.filtered, tqColGetter);

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

      <SectionCard
        icon={Trophy} title={`Agent Wise Target Achievement — as of ${fmtDate(data.asOfDate)}`} tone="indigo"
        footnote="TQ/MQ/BQ thresholds match the reference workbook: TQ above 80% of MTD target, MQ 60-80%, BQ below 60%. Rank is among Active agents only."
        action={tqFilters.activeCount > 0 ? (
          <button type="button" onClick={tqFilters.clearAll} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-200">
            Clear {tqFilters.activeCount} filter{tqFilters.activeCount > 1 ? "s" : ""}
          </button>
        ) : undefined}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                <FilterSortTh label="Rank" columnKey="rank" sortKey={tqSortKey} sortDir={tqSortDir} onSort={toggleTqSort} filters={tqFilters} className="py-2 pr-3 font-semibold" />
                <FilterSortTh label="Agent" columnKey="name" sortKey={tqSortKey} sortDir={tqSortDir} onSort={toggleTqSort} filters={tqFilters} className="py-2 pr-3 font-semibold" />
                <FilterSortTh label="TL" columnKey="tlName" sortKey={tqSortKey} sortDir={tqSortDir} onSort={toggleTqSort} filters={tqFilters} className="py-2 pr-3 font-semibold" />
                <FilterSortTh label="Target" columnKey="target" sortKey={tqSortKey} sortDir={tqSortDir} onSort={toggleTqSort} filters={tqFilters} className="py-2 pr-3 text-right font-semibold" />
                <FilterSortTh label="MTD Target" columnKey="mtdTarget" sortKey={tqSortKey} sortDir={tqSortDir} onSort={toggleTqSort} filters={tqFilters} className="py-2 pr-3 text-right font-semibold" />
                <FilterSortTh label="Achieved" columnKey="achieved" sortKey={tqSortKey} sortDir={tqSortDir} onSort={toggleTqSort} filters={tqFilters} className="py-2 pr-3 text-right font-semibold" />
                <FilterSortTh label="Sale Count" columnKey="saleCount" sortKey={tqSortKey} sortDir={tqSortDir} onSort={toggleTqSort} filters={tqFilters} className="py-2 pr-3 text-right font-semibold" />
                <FilterSortTh label="AOV" columnKey="aov" sortKey={tqSortKey} sortDir={tqSortDir} onSort={toggleTqSort} filters={tqFilters} className="py-2 pr-3 text-right font-semibold" />
                <FilterSortTh label="Remaining" columnKey="remaining" sortKey={tqSortKey} sortDir={tqSortDir} onSort={toggleTqSort} filters={tqFilters} className="py-2 pr-3 text-right font-semibold" />
                <FilterSortTh label="Ach%" columnKey="achievedPct" sortKey={tqSortKey} sortDir={tqSortDir} onSort={toggleTqSort} filters={tqFilters} className="py-2 pr-3 text-right font-semibold" />
                <FilterSortTh label="Stage" columnKey="stage" sortKey={tqSortKey} sortDir={tqSortDir} onSort={toggleTqSort} filters={tqFilters} className="py-2 pr-3 font-semibold" />
                {expandedWeeks && data.agents[0]?.weeks.map((w) => <th key={w.label} className="py-2 pr-3 text-right font-semibold text-violet-600">{w.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {sortedTqRows.map((a) => (
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
              {sortedTqRows.length === 0 && <tr><td colSpan={11} className="py-6 text-center text-slate-400">{rows.length === 0 ? "No agents match this search." : "No agents match the current filters."}</td></tr>}
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

  type TlTargetRow = HPTqMqBqTlData["tls"][number];
  const TL_TARGET_FILTER_COLS: Array<FilterColumn<TlTargetRow>> = [
    { key: "tlName", get: (t) => t.tlName }, { key: "agentCount", get: (t) => t.agentCount }, { key: "target", get: (t) => t.target },
    { key: "achievement", get: (t) => t.achievement }, { key: "remaining", get: (t) => t.remaining }, { key: "saleCount", get: (t) => t.saleCount },
    { key: "drr", get: (t) => t.drr }, { key: "currentDrr", get: (t) => t.currentDrr }, { key: "tillDayAchievedPct", get: (t) => t.tillDayAchievedPct },
    { key: "stage", get: (t) => t.stage },
  ];
  const tlTargetColGetter = (t: TlTargetRow, key: string) => TL_TARGET_FILTER_COLS.find((c) => c.key === key)?.get(t);
  const tlTargetFilters = useColumnFilters(data?.tls ?? [], TL_TARGET_FILTER_COLS);
  const { sorted: sortedTlTargets, sortKey: tlTargetSortKey, sortDir: tlTargetSortDir, toggleSort: toggleTlTargetSort } = useSortableRows(tlTargetFilters.filtered, tlTargetColGetter);

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

      <SectionCard
        icon={Trophy} title={`TL Wise Target — as of ${fmtDate(data.asOfDate)}`} tone="indigo"
        footnote="DRR = Target / 30. Current DRR = DRR × day of month reached. Till-Day Ach% compares Achievement to (DRR × day of month), the daily-run-rate expectation so far."
        action={tlTargetFilters.activeCount > 0 ? (
          <button type="button" onClick={tlTargetFilters.clearAll} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-200">
            Clear {tlTargetFilters.activeCount} filter{tlTargetFilters.activeCount > 1 ? "s" : ""}
          </button>
        ) : undefined}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                <FilterSortTh label="TL" columnKey="tlName" sortKey={tlTargetSortKey} sortDir={tlTargetSortDir} onSort={toggleTlTargetSort} filters={tlTargetFilters} className="py-2 pr-3 font-semibold" />
                <FilterSortTh label="Agents" columnKey="agentCount" sortKey={tlTargetSortKey} sortDir={tlTargetSortDir} onSort={toggleTlTargetSort} filters={tlTargetFilters} className="py-2 pr-3 text-right font-semibold" />
                <FilterSortTh label="Target" columnKey="target" sortKey={tlTargetSortKey} sortDir={tlTargetSortDir} onSort={toggleTlTargetSort} filters={tlTargetFilters} className="py-2 pr-3 text-right font-semibold" />
                <FilterSortTh label="Achievement" columnKey="achievement" sortKey={tlTargetSortKey} sortDir={tlTargetSortDir} onSort={toggleTlTargetSort} filters={tlTargetFilters} className="py-2 pr-3 text-right font-semibold" />
                <FilterSortTh label="Remaining" columnKey="remaining" sortKey={tlTargetSortKey} sortDir={tlTargetSortDir} onSort={toggleTlTargetSort} filters={tlTargetFilters} className="py-2 pr-3 text-right font-semibold" />
                <FilterSortTh label="Sale Count" columnKey="saleCount" sortKey={tlTargetSortKey} sortDir={tlTargetSortDir} onSort={toggleTlTargetSort} filters={tlTargetFilters} className="py-2 pr-3 text-right font-semibold" />
                <FilterSortTh label="DRR" columnKey="drr" sortKey={tlTargetSortKey} sortDir={tlTargetSortDir} onSort={toggleTlTargetSort} filters={tlTargetFilters} className="py-2 pr-3 text-right font-semibold" />
                <FilterSortTh label="Current DRR" columnKey="currentDrr" sortKey={tlTargetSortKey} sortDir={tlTargetSortDir} onSort={toggleTlTargetSort} filters={tlTargetFilters} className="py-2 pr-3 text-right font-semibold" />
                <FilterSortTh label="Till-Day Ach%" columnKey="tillDayAchievedPct" sortKey={tlTargetSortKey} sortDir={tlTargetSortDir} onSort={toggleTlTargetSort} filters={tlTargetFilters} className="py-2 pr-3 text-right font-semibold" />
                <FilterSortTh label="Stage" columnKey="stage" sortKey={tlTargetSortKey} sortDir={tlTargetSortDir} onSort={toggleTlTargetSort} filters={tlTargetFilters} className="py-2 pr-0 font-semibold" />
              </tr>
            </thead>
            <tbody>
              {sortedTlTargets.map((t) => (
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
              {sortedTlTargets.length === 0 && <tr><td colSpan={10} className="py-6 text-center text-slate-400">{data.tls.length === 0 ? "No data." : "No TLs match the current filters."}</td></tr>}
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

  type TeamRow = HPTeamDetailsData["rows"][number];
  const TEAM_FILTER_COLS: Array<FilterColumn<TeamRow>> = [
    { key: "empId", get: (r) => r.empId }, { key: "name", get: (r) => r.name }, { key: "tlName", get: (r) => r.tlName },
    { key: "center", get: (r) => r.center }, { key: "doj", get: (r) => r.doj }, { key: "bucket", get: (r) => r.bucket }, { key: "status", get: (r) => r.status },
    { key: "target", get: (r) => r.target }, { key: "uploadedAchievement", get: (r) => r.uploadedAchievement }, { key: "computedRevenue", get: (r) => r.computedRevenue },
    { key: "match", get: (r) => (r.achievementMismatch ? "Mismatch" : "Match") },
  ];
  const teamColGetter = (r: TeamRow, key: string) => TEAM_FILTER_COLS.find((c) => c.key === key)?.get(r);
  const teamFilters = useColumnFilters(rows, TEAM_FILTER_COLS);
  const { sorted: sortedTeam, sortKey: teamSortKey, sortDir: teamSortDir, toggleSort: toggleTeamSort } = useSortableRows(teamFilters.filtered, teamColGetter);

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

      <SectionCard
        icon={Users} title="Team Details" tone="indigo"
        footnote="Computed Revenue is a live SUM of this agent's Sale rows, checked against the achievement figure uploaded with the roster. A mismatch means the roster wasn't refreshed after the sales it should reflect."
        action={teamFilters.activeCount > 0 ? (
          <button type="button" onClick={teamFilters.clearAll} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-200">
            Clear {teamFilters.activeCount} filter{teamFilters.activeCount > 1 ? "s" : ""}
          </button>
        ) : undefined}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                <FilterSortTh label="Emp ID" columnKey="empId" sortKey={teamSortKey} sortDir={teamSortDir} onSort={toggleTeamSort} filters={teamFilters} className="py-2 pr-3 font-semibold" />
                <FilterSortTh label="Name" columnKey="name" sortKey={teamSortKey} sortDir={teamSortDir} onSort={toggleTeamSort} filters={teamFilters} className="py-2 pr-3 font-semibold" />
                <FilterSortTh label="TL" columnKey="tlName" sortKey={teamSortKey} sortDir={teamSortDir} onSort={toggleTeamSort} filters={teamFilters} className="py-2 pr-3 font-semibold" />
                <FilterSortTh label="Center" columnKey="center" sortKey={teamSortKey} sortDir={teamSortDir} onSort={toggleTeamSort} filters={teamFilters} className="py-2 pr-3 font-semibold" />
                <FilterSortTh label="DOJ" columnKey="doj" sortKey={teamSortKey} sortDir={teamSortDir} onSort={toggleTeamSort} filters={teamFilters} className="py-2 pr-3 font-semibold" />
                <FilterSortTh label="Bucket" columnKey="bucket" sortKey={teamSortKey} sortDir={teamSortDir} onSort={toggleTeamSort} filters={teamFilters} className="py-2 pr-3 font-semibold" />
                <FilterSortTh label="Status" columnKey="status" sortKey={teamSortKey} sortDir={teamSortDir} onSort={toggleTeamSort} filters={teamFilters} className="py-2 pr-3 font-semibold" />
                <FilterSortTh label="Target" columnKey="target" sortKey={teamSortKey} sortDir={teamSortDir} onSort={toggleTeamSort} filters={teamFilters} className="py-2 pr-3 text-right font-semibold" />
                <FilterSortTh label="Roster Achv." columnKey="uploadedAchievement" sortKey={teamSortKey} sortDir={teamSortDir} onSort={toggleTeamSort} filters={teamFilters} className="py-2 pr-3 text-right font-semibold" />
                <FilterSortTh label="Computed Rev." columnKey="computedRevenue" sortKey={teamSortKey} sortDir={teamSortDir} onSort={toggleTeamSort} filters={teamFilters} className="py-2 pr-3 text-right font-semibold" />
                <FilterSortTh label="Match" columnKey="match" sortKey={teamSortKey} sortDir={teamSortDir} onSort={toggleTeamSort} filters={teamFilters} className="py-2 pr-0 font-semibold" />
              </tr>
            </thead>
            <tbody>
              {sortedTeam.map((r) => (
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
              {sortedTeam.length === 0 && <tr><td colSpan={11} className="py-6 text-center text-slate-400">{rows.length === 0 ? "No agents match this search." : "No agents match the current filters."}</td></tr>}
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
  const [tab, setTab] = useState<TabKey>("dashboard");
  const [drawerAgent, setDrawerAgent] = useState<string | null>(null);
  const [agentNames, setAgentNames] = useState<string[]>([]);
  const [filterSlot, setFilterSlot] = useState<HTMLElement | null>(null);

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

      <div className="flex flex-wrap items-center justify-end gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {/* The Outbound dashboard portals its TL / Agent / Week / Refresh controls in here, so they share this row with the date range. */}
          <div ref={setFilterSlot} className="flex flex-wrap items-center gap-2" />
          <DateRangeToolbar
            from={from} to={to} onFrom={setFrom} onTo={setTo}
            onReset={() => { const r = currentMonthRange(); setFrom(r.from); setTo(r.to); }}
            accentFocus="focus:border-indigo-400"
          />
        </div>
      </div>

      {tab === "dashboard" && (
        <HousingPremiumOutboundDashboard from={from} to={to} agents={agentNames} onOpenAgent={setDrawerAgent} onNavigate={setTab} toolbarSlot={filterSlot} />
      )}
      {tab === "overview" && <OverviewTab from={from} to={to} />}
      {tab === "daywise" && <DayWiseTab from={from} to={to} agents={agentNames} />}
      {tab === "agentwise" && <AgentWiseTab from={from} to={to} onOpen={setDrawerAgent} />}
      {tab === "tqmqbq" && <TqMqBqAgentsTab month={month} onOpen={setDrawerAgent} />}
      {tab === "tlTarget" && <TlTargetTab month={month} />}
      {tab === "team" && <TeamDetailsTab onOpen={setDrawerAgent} />}

      {drawerAgent && <HousingPremiumAgentDrawer agent={drawerAgent} from={from} to={to} onClose={() => setDrawerAgent(null)} />}
    </div>
  );
}
