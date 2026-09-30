/**
 * Roster Compliance (tab=compliance).
 *
 * One domain throughout: roster-rule compliance (rest, consecutive days, week-off fairness,
 * weekly hours, night shifts). Summary, violations feed, trend and every drill-down read the
 * same server-side incident list, so their numbers cannot disagree. Attendance adherence is
 * shown as a separate, labelled measure. Split into ./compliance/* to stay under 500 lines.
 */
import { Suspense, lazy, useMemo, useState } from "react";
import { Activity, AlertTriangle, ChevronLeft, ChevronRight, RefreshCw, ShieldCheck, Users, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChartCard } from "@/components/wfm/console/ChartCard";
import { ConsoleCard } from "@/components/wfm/console/ConsoleCard";
import { KpiTile } from "@/components/wfm/console/KpiTile";
import { PanelHeader } from "@/components/wfm/console/PanelHeader";
import { StatusPill } from "@/components/wfm/console/StatusPill";
import { scopeParams } from "./filterState";
import { UpdatedStamp, useRefreshFlags } from "./heavyQuery";
import { useRosterConsoleFilters } from "./RosterConsoleFilterContext";
import { ComplianceAlertStrip, buildAlerts } from "./compliance/ComplianceAlerts";
import { ComplianceDrawer } from "./compliance/ComplianceDrawer";
import { ViolationsTable } from "./compliance/ViolationsTable";
import { ALL, FEED_PAGE_SIZE, useComplianceData } from "./compliance/useComplianceData";
import { currentMonthIst, fmtInt, fmtMonth, fmtPct, fmtPoints, pctChange, recentMonths, scoreBand } from "./compliance/format";
import { ATTENDANCE_OPTIONS, RULE_OPTIONS, type DrawerTarget, type FeedKind } from "./compliance/types";

const TrendChart = lazy(() => import("./compliance/ComplianceCharts").then((m) => ({ default: m.TrendChart })));
const RuleBars = lazy(() => import("./compliance/ComplianceCharts").then((m) => ({ default: m.RuleBars })));
const BranchBars = lazy(() => import("./compliance/ComplianceCharts").then((m) => ({ default: m.BranchBars })));

const ChartFallback = () => <div className="h-full animate-pulse rounded-md bg-slate-100" role="status" aria-label="Loading chart" />;

export default function CompliancePanel() {
  const { filters } = useRosterConsoleFilters();
  const scopeQs = useMemo(() => scopeParams({ branchId: filters.branchId, processId: filters.processId, lobId: filters.lobId }).toString(), [filters.branchId, filters.processId, filters.lobId]);
  const [month, setMonth] = useState(currentMonthIst);
  const [kind, setKind] = useState<FeedKind>("roster");
  const [ruleId, setRuleId] = useState(ALL);
  const [severity, setSeverity] = useState(ALL);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [drawer, setDrawer] = useState<DrawerTarget | null>(null);
  const [tab, setTab] = useState("overview");
  const { mark, consume } = useRefreshFlags();

  const feedFilters = useMemo(() => ({ kind, ruleId, severity, q, page }), [kind, ruleId, severity, q, page]);
  const { summary: sq, trend: tq, violations: vq } = useComplianceData(scopeQs, month, feedFilters, consume);
  const summary = sq.data;
  const anyFetching = sq.isFetching || tq.isFetching || vq.isFetching;

  const months = useMemo(() => recentMonths(currentMonthIst(), 6), []);
  const alerts = useMemo(() => buildAlerts(summary, {
    filterRule: (id, k) => { setKind(k); setRuleId(id); setSeverity(ALL); setQ(""); setPage(1); setTab("violations"); },
    open: setDrawer,
  }), [summary]);

  const refresh = () => { mark("summary", "trend", "violations"); void sq.refetch(); void tq.refetch(); void vq.refetch(); };
  const resetPage = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };
  const changeKind = (k: string) => { setKind(k as FeedKind); setRuleId(ALL); setPage(1); };

  const band = scoreBand(summary?.compliancePct ?? null);
  const prev = summary?.previous ?? null;
  const spark = summary?.history.map((h) => h.compliancePct ?? 0) ?? [];
  const violSpark = summary?.history.map((h) => h.violations) ?? [];
  const noData = !!summary && !summary.hasData;
  const ruleOptions = kind === "roster" ? RULE_OPTIONS : ATTENDANCE_OPTIONS;
  const feed = vq.data;
  const totalPages = feed ? Math.max(1, Math.ceil(feed.totalCount / FEED_PAGE_SIZE)) : 1;

  return (
    <div>
      <PanelHeader
        icon={ShieldCheck}
        title="Roster Compliance"
        description="Rest policy, consecutive days, week-off fairness, weekly hours and night-shift limits, measured on the published roster"
        actions={
          <>
            <UpdatedStamp updatedAt={sq.dataUpdatedAt} fetching={anyFetching} />
            <Select value={month} onValueChange={(v) => { setMonth(v); setPage(1); }}>
              <SelectTrigger className="h-9 w-[140px]" aria-label="Compliance month"><SelectValue /></SelectTrigger>
              <SelectContent>{months.map((m) => <SelectItem key={m} value={m}>{fmtMonth(m)}</SelectItem>)}</SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={refresh} className="min-h-[44px] cursor-pointer sm:min-h-9" aria-label="Refresh compliance data">
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden />Refresh
            </Button>
          </>
        }
      />

      {sq.isError && (
        <div role="alert" className="mb-3 rounded-lg border border-red-300 bg-red-50 p-3">
          <p className="text-sm font-semibold text-red-900">Compliance data could not be loaded</p>
          <p className="mt-1 text-sm text-red-800">No roster rules were evaluated, so no score is shown. This is not a clean bill of health.</p>
          <Button variant="outline" size="sm" onClick={refresh} className="mt-2 min-h-[44px] cursor-pointer border-red-300 bg-white text-red-900 sm:min-h-9">Retry</Button>
        </div>
      )}
      {noData && (
        <div role="status" className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          No published roster rows were found for {fmtMonth(month)} with the current filters, so compliance cannot be scored.
        </div>
      )}

      <ComplianceAlertStrip alerts={alerts} />

      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-5" aria-busy={sq.isPending}>
        {sq.isPending ? Array.from({ length: 5 }, (_, i) => <div key={i} className="h-[108px] animate-pulse rounded-lg bg-slate-100" />) : (
          <>
            <KpiTile label="Compliance" value={fmtPct(summary?.compliancePct)} sub={[band.label, fmtPoints(summary?.trend) && `${fmtPoints(summary?.trend)} vs ${prev ? fmtMonth(prev.period) : "prior"}`].filter(Boolean).join(" - ")} tone={band.tone === "neutral" ? "neutral" : band.tone} icon={ShieldCheck} spark={spark} progress={summary?.compliancePct ?? undefined} onClick={() => setDrawer({ type: "overview" })} />
            <KpiTile label="Violations" value={fmtInt(summary?.totalViolations)} sub="Rule incidents this month" tone={summary?.totalViolations ? "amber" : "green"} icon={AlertTriangle} delta={summary ? pctChange(summary.totalViolations, prev?.totalViolations) : undefined} deltaBad="up" spark={violSpark} onClick={() => setDrawer({ type: "overview" })} />
            <KpiTile label="Employees affected" value={fmtInt(summary?.employeesWithViolations)} sub={`of ${fmtInt(summary?.totalEmployees)} rostered`} tone={summary?.employeesWithViolations ? "red" : "green"} icon={UserX} progress={summary && summary.totalEmployees > 0 ? (summary.employeesWithViolations / summary.totalEmployees) * 100 : undefined} onClick={() => setDrawer({ type: "overview" })} />
            <KpiTile label="Rostered employees" value={fmtInt(summary?.totalEmployees)} sub={`${fmtInt(summary?.byBranch.length)} branches`} tone="blue" icon={Users} onClick={() => setDrawer({ type: "overview" })} />
            <KpiTile label="Attendance rate" value={fmtPct(summary?.attendance?.adherencePct)} sub={summary?.attendance ? `${fmtInt(summary.attendance.unreconciled)} not reconciled` : "No elapsed days yet"} tone="neutral" icon={Activity} onClick={() => { setKind("attendance"); setRuleId(ALL); setPage(1); setTab("violations"); }} />
          </>
        )}
      </div>

      <Tabs value={tab} onValueChange={setTab} className="space-y-3">
        <TabsList aria-label="Compliance views">
          <TabsTrigger value="overview" className="min-h-[36px]">Overview</TabsTrigger>
          <TabsTrigger value="violations" className="min-h-[36px]">Violations</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-3">
          <ChartCard title="Compliance trend" subtitle="Compliance % (line) and rule incidents (bars), last 6 months. Select a month to switch." height={260} loading={tq.isPending} error={tq.isError} onRetry={() => void tq.refetch()} empty={!tq.data?.some((t) => t.rostered > 0)}>
            <Suspense fallback={<ChartFallback />}><TrendChart data={tq.data ?? []} selected={month} onSelect={setMonth} /></Suspense>
          </ChartCard>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <ChartCard title="Incidents by rule" subtitle="Select a bar for the rule detail" height={240} loading={sq.isPending} error={sq.isError} empty={!summary?.totalViolations} emptyLabel="No rule incidents this month">
              <Suspense fallback={<ChartFallback />}><RuleBars rules={summary?.rules ?? []} onSelect={(id) => setDrawer({ type: "rule", id })} /></Suspense>
            </ChartCard>
            <ChartCard title="Branch compliance" subtitle="Lowest ten branches; select a bar for the branch detail" height={240} loading={sq.isPending} error={sq.isError} empty={!summary?.byBranch.length}>
              <Suspense fallback={<ChartFallback />}><BranchBars branches={summary?.byBranch ?? []} onSelect={(id) => setDrawer({ type: "branch", id })} /></Suspense>
            </ChartCard>
          </div>
          <ConsoleCard>
            <div className="border-b border-border p-3"><h3 className="text-sm font-semibold text-slate-900">Rules</h3><p className="text-xs text-slate-600">Each row opens the rule detail</p></div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="bg-muted"><tr>{["Rule", "Threshold", "Severity", "Incidents", "Employees"].map((h, i) => <th key={h} scope="col" className={`px-3 py-2 text-xs font-semibold text-slate-700 ${i < 3 ? "text-left" : "text-right"}`}>{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-border">
                  {(summary?.rules ?? []).map((r) => (
                    <tr key={r.ruleId} tabIndex={0} onClick={() => setDrawer({ type: "rule", id: r.ruleId })} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDrawer({ type: "rule", id: r.ruleId }); } }} aria-label={`Open ${r.ruleName} detail`} className="cursor-pointer hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                      <td className="px-3 py-2"><span className="font-medium text-slate-900">{r.ruleName}</span><span className="block text-xs text-slate-600">{r.description}</span></td>
                      <td className="px-3 py-2 text-slate-700">{r.threshold}</td>
                      <td className="px-3 py-2"><StatusPill tone={r.severity === "high" ? "red" : "amber"}>{r.severity === "high" ? "High" : "Medium"}</StatusPill></td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtInt(r.violationCount)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtInt(r.employeesAffected)}</td>
                    </tr>
                  ))}
                  {sq.isPending && <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-500">Loading rules</td></tr>}
                </tbody>
              </table>
            </div>
          </ConsoleCard>
          <ConsoleCard>
            <div className="border-b border-border p-3"><h3 className="text-sm font-semibold text-slate-900">Branch ranking</h3><p className="text-xs text-slate-600">Lowest compliance first; each row opens the branch detail</p></div>
            <div className="max-h-[420px] overflow-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="sticky top-0 bg-muted"><tr>{["Branch", "Status", "Compliance", "Change", "Violations", "Rostered"].map((h, i) => <th key={h} scope="col" className={`px-3 py-2 text-xs font-semibold text-slate-700 ${i < 2 ? "text-left" : "text-right"}`}>{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-border">
                  {(summary?.byBranch ?? []).map((b) => {
                    const bb = scoreBand(b.score);
                    return (
                      <tr key={b.branchId} tabIndex={0} onClick={() => setDrawer({ type: "branch", id: b.branchId })} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDrawer({ type: "branch", id: b.branchId }); } }} aria-label={`Open ${b.branchName} detail`} className="cursor-pointer hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                        <td className="px-3 py-2 font-medium text-slate-900">{b.branchName}</td>
                        <td className="px-3 py-2"><StatusPill tone={bb.tone}>{bb.label}</StatusPill></td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtPct(b.score)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtPoints(b.trend) ?? "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtInt(b.violations)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtInt(b.rostered)}</td>
                      </tr>
                    );
                  })}
                  {!sq.isPending && !summary?.byBranch.length && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">No branch data for these filters</td></tr>}
                </tbody>
              </table>
            </div>
          </ConsoleCard>
        </TabsContent>

        <TabsContent value="violations" className="space-y-3">
          <ConsoleCard className="p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Select value={kind} onValueChange={changeKind}>
                <SelectTrigger className="h-9 w-[210px]" aria-label="Violation source"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="roster">Roster rule violations</SelectItem>
                  <SelectItem value="attendance">Attendance exceptions</SelectItem>
                </SelectContent>
              </Select>
              <Select value={ruleId} onValueChange={resetPage(setRuleId)}>
                <SelectTrigger className="h-9 w-[190px]" aria-label="Rule filter"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value={ALL}>{kind === "roster" ? "All rules" : "All exception types"}</SelectItem>{ruleOptions.map((o) => <SelectItem key={o.id} value={o.id}>{o.label}{feed?.counts.byRule[o.id] !== undefined ? ` (${feed.counts.byRule[o.id]})` : ""}</SelectItem>)}</SelectContent>
              </Select>
              {kind === "roster" && (
                <Select value={severity} onValueChange={resetPage(setSeverity)}>
                  <SelectTrigger className="h-9 w-[150px]" aria-label="Severity filter"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value={ALL}>All severities</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="low">Low</SelectItem></SelectContent>
                </Select>
              )}
              {kind === "roster" && <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search name or code" aria-label="Search employee" className="h-9 w-[200px]" />}
              <span className="ml-auto text-xs text-slate-600 tabular-nums" aria-live="polite">{feed ? `${fmtInt(feed.totalCount)} ${kind === "roster" ? "incidents" : "exceptions"} in ${fmtMonth(month)}` : ""}</span>
            </div>
            {kind === "attendance" && <p className="mt-2 text-xs text-slate-600">Attendance exceptions cover elapsed rostered working days only; leave, holidays and week-offs are excluded. This is a separate measure from the roster-rule score.</p>}
          </ConsoleCard>
          <ConsoleCard className="p-3">
            {vq.isPending ? <div className="h-[260px] animate-pulse rounded-md bg-slate-100" role="status" aria-label="Loading violations" />
              : vq.isError ? <p role="alert" className="py-8 text-center text-sm text-red-800">Violations could not be loaded. <button type="button" className="cursor-pointer underline" onClick={() => void vq.refetch()}>Retry</button></p>
              : !feed?.violations.length ? <p className="py-10 text-center text-sm text-slate-600">No {kind === "roster" ? "rule violations" : "attendance exceptions"} match these filters.</p>
              : <ViolationsTable rows={feed.violations} onOpen={setDrawer} />}
            {feed && feed.totalCount > FEED_PAGE_SIZE && (
              <div className="mt-2 flex items-center justify-between text-xs text-slate-700">
                <span className="tabular-nums">Page {page} of {totalPages}</span>
                <span className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="min-h-[44px] cursor-pointer sm:min-h-8" aria-label="Previous page"><ChevronLeft className="h-4 w-4" aria-hidden /></Button>
                  <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="min-h-[44px] cursor-pointer sm:min-h-8" aria-label="Next page"><ChevronRight className="h-4 w-4" aria-hidden /></Button>
                </span>
              </div>
            )}
          </ConsoleCard>
        </TabsContent>
      </Tabs>

      <ComplianceDrawer target={drawer} onClose={() => setDrawer(null)} onOpen={setDrawer} scopeQs={scopeQs} month={month} summary={summary} />
    </div>
  );
}
