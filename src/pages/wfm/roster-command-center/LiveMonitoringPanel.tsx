/**
 * Live Monitoring — real-time attendance intelligence (tab=live).
 *
 * Data: /api/roster-intelligence/unplanned-absences (alerts) + /manager-digests (team roll-ups),
 * both scoped server-side by the shared branch/process/LOB filters. Calculations live in
 * live-monitoring/liveMonitoringCalc.ts (pooled, NaN-safe, unit-tested). Every alert row and
 * team row opens a drawer backed by a dedicated detail endpoint (Drill-Down Mandate).
 */
import { Suspense, lazy, useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, ArrowDown, ArrowUp, Bell, CheckCircle2, Clock, MessageSquare, RefreshCw, Target, TrendingDown, UserCheck, UserX, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { hrmsApi } from "@/lib/hrmsApi";
import { ConsoleCard } from "@/components/wfm/console/ConsoleCard";
import { ChartCard } from "@/components/wfm/console/ChartCard";
import { KpiTile } from "@/components/wfm/console/KpiTile";
import { TabToolbar } from "@/components/wfm/console/TabToolbar";
import { pickOne, useTabParams } from "./useTabParams";
import { PanelHeader } from "@/components/wfm/console/PanelHeader";
import { StatusPill } from "@/components/wfm/console/StatusPill";
import { useRosterConsoleFilters } from "./RosterConsoleFilterContext";
import { scopeParams } from "./filterState";
import { formatUpdatedAt } from "./heavyQuery";
import { EmployeeDrawer, ManagerDrawer } from "./live-monitoring/LiveDrawers";
import { ShiftAdherenceSection } from "./live-monitoring/ShiftAdherenceSection";
import {
  SHRINKAGE_TARGET, alertSeverity, effectivenessScore, fmtDuration, scoreTone, severityCounts, summarize,
  type LiveAlert, type ManagerDigest, type Severity,
} from "./live-monitoring/liveMonitoringCalc";

const AttendanceMixDonut = lazy(() => import("./live-monitoring/LiveCharts").then((m) => ({ default: m.AttendanceMixDonut })));
const ShrinkageByBranchBar = lazy(() => import("./live-monitoring/LiveCharts").then((m) => ({ default: m.ShrinkageByBranchBar })));

interface LiveAttendanceData { total: number; alerts: LiveAlert[] }
interface DigestsData { digests: ManagerDigest[]; count: number; date?: string }

const PAGE = 50;
const SEV_LABEL: Record<Severity, string> = { critical: "Critical (1h+)", warning: "Warning (30-59m)", info: "New (<30m)" };
const SEV_TONE: Record<Severity, "red" | "amber" | "neutral"> = { critical: "red", warning: "amber", info: "neutral" };
const chartFallback = <div className="h-full animate-pulse rounded-md bg-slate-100" role="status" aria-label="Loading chart" />;

type SortKey = "managerName" | "teamSize" | "planned" | "present" | "late" | "absent" | "shrinkagePct" | "aprPending" | "score";

function SortHead({ label, k, sort, onSort, right }: { label: string; k: SortKey; sort: { key: SortKey; dir: 1 | -1 }; onSort: (k: SortKey) => void; right?: boolean }) {
  const active = sort.key === k;
  return (
    <th scope="col" aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"} className={`p-2 font-semibold ${right ? "text-right" : "text-left"}`}>
      <button type="button" onClick={() => onSort(k)} className="inline-flex min-h-[44px] cursor-pointer items-center gap-1 sm:min-h-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {label}
        {active && (sort.dir === 1 ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />)}
      </button>
    </th>
  );
}

export default function LiveMonitoringPanel() {
  const { filters } = useRosterConsoleFilters();
  const { processId, lobId, branchId } = filters;
  const { toast } = useToast();
  const [tp, setTp] = useTabParams({ sev: "" });
  const sevFilter: Severity | null = pickOne(tp.sev, ["critical", "warning", "info"] as const, "" as never) || null;
  const setSevFilter = (v: Severity | null) => setTp({ sev: v ?? "" });
  const [alertLimit, setAlertLimit] = useState(PAGE);
  const [teamLimit, setTeamLimit] = useState(PAGE);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "shrinkagePct", dir: -1 });
  const [empId, setEmpId] = useState<string | null>(null);
  const [mgrId, setMgrId] = useState<string | null>(null);
  const scopeKey = [branchId, processId, lobId];

  // Both requests start in parallel; filters are applied server-side (branch/process/LOB narrow
  // the RBAC scope for alerts AND digests). No client-side re-filtering.
  const liveQ = useQuery({
    queryKey: ["command-center", "live", ...scopeKey],
    queryFn: () => hrmsApi.get<LiveAttendanceData>(`/api/roster-intelligence/unplanned-absences?${scopeParams({ branchId, processId, lobId }, { gracePeriod: "15" })}`),
    refetchInterval: 60_000, staleTime: 30_000, placeholderData: keepPreviousData,
  });
  const digestQ = useQuery({
    queryKey: ["command-center", "digests", ...scopeKey],
    queryFn: () => hrmsApi.get<DigestsData>(`/api/roster-intelligence/manager-digests?${scopeParams({ branchId, processId, lobId })}`),
    refetchInterval: 120_000, staleTime: 60_000, placeholderData: keepPreviousData,
  });

  const alerts = liveQ.data?.alerts ?? [];
  const digests = digestQ.data?.digests ?? [];
  const sum = useMemo(() => summarize(digests), [digests]);
  const sev = useMemo(() => severityCounts(alerts), [alerts]);
  const shownAlerts = useMemo(() => (sevFilter ? alerts.filter((a) => alertSeverity(a.minutesSinceShiftStart) === sevFilter) : alerts), [alerts, sevFilter]);

  const rows = useMemo(() => {
    const r = digests.map((d) => ({ d, late: d.lateArrivals.length, absent: d.unplannedAbsences.length, score: effectivenessScore(d) }));
    const val = (x: (typeof r)[number]): number | string => {
      switch (sort.key) {
        case "managerName": return x.d.managerName.toLowerCase();
        case "late": return x.late;
        case "absent": return x.absent;
        case "score": return x.score ?? -1;
        default: return x.d[sort.key];
      }
    };
    return r.sort((a, b) => { const A = val(a), B = val(b); return (A < B ? -1 : A > B ? 1 : 0) * sort.dir; });
  }, [digests, sort]);

  const mix = useMemo(() => [
    { key: "onTime", name: "On time", value: sum.onTime, color: "hsl(var(--chart-2))" },
    { key: "late", name: "Late", value: sum.late, color: "hsl(var(--chart-4))" },
    { key: "incomplete", name: "Incomplete", value: sum.incomplete, color: "hsl(var(--chart-3))" },
    { key: "absent", name: "Absent", value: sum.absent, color: "hsl(var(--chart-8))" },
  ].filter((s) => s.value > 0), [sum]);

  const byBranch = useMemo(() => {
    const m = new Map<string, { planned: number; present: number }>();
    for (const d of digests) {
      const k = d.branchName ?? "No branch";
      const e = m.get(k) ?? { planned: 0, present: 0 };
      e.planned += d.planned; e.present += d.present; m.set(k, e);
    }
    return [...m].filter(([, v]) => v.planned > 0)
      .map(([name, v]) => ({ name, planned: v.planned, shrinkagePct: Math.max(0, Math.round(((v.planned - v.present) / v.planned) * 100)) }))
      .sort((a, b) => b.shrinkagePct - a.shrinkagePct).slice(0, 10);
  }, [digests]);

  const onSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: key === "managerName" ? 1 : -1 }));
  const refresh = () => { void liveQ.refetch(); void digestQ.refetch(); };

  const sendMassAlert = useMutation({
    mutationFn: () => hrmsApi.post<{ sent: number; skipped: number; totalAlerts: number }>("/api/roster-intelligence/send-unplanned-alerts", {}),
    onSuccess: (r) => toast({ title: "Mass alert sent", description: `${r.sent} manager(s) notified, ${r.skipped} skipped (no email on file), ${r.totalAlerts} alert(s) total.` }),
    onError: (e: any) => toast({ title: "Failed to send mass alert", description: e?.message ?? "Unknown error", variant: "destructive" }),
  });
  const notifyAll = useMutation({
    mutationFn: () => hrmsApi.post<{ sent: number; skipped: number; total: number }>("/api/roster-intelligence/send-manager-digests", {}),
    onSuccess: (r) => toast({ title: "Manager digests sent", description: `${r.sent} of ${r.total} manager(s) notified, ${r.skipped} skipped (no email on file).` }),
    onError: (e: any) => toast({ title: "Failed to send manager digests", description: e?.message ?? "Unknown error", variant: "destructive" }),
  });
  const confirmSend = (msg: string, run: () => void) => { if (window.confirm(msg)) run(); };

  const shrinkTone = sum.shrinkagePct === null ? "neutral" : sum.shrinkagePct > SHRINKAGE_TARGET * 2 ? "red" : sum.shrinkagePct > SHRINKAGE_TARGET ? "amber" : "green";
  const err = liveQ.isError || digestQ.isError;

  return (
    <div>
      <PanelHeader
        icon={Activity}
        title="Live Monitoring"
        description="Today so far. Alerts refresh every minute, team roll-ups every 2 minutes."
        live
        updatedLabel={formatUpdatedAt(Math.max(liveQ.dataUpdatedAt, digestQ.dataUpdatedAt)) ? `Updated ${formatUpdatedAt(Math.max(liveQ.dataUpdatedAt, digestQ.dataUpdatedAt))}` : undefined}
        actions={
          <Button variant="outline" size="sm" onClick={refresh} className="min-h-[44px] cursor-pointer sm:min-h-0" aria-label="Refresh live data">
            <RefreshCw className={`mr-2 h-4 w-4 ${liveQ.isFetching || digestQ.isFetching ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden /> Refresh
          </Button>
        }
      />

      {/* Alert filter strip: severity counts, click to filter the alert list */}
      <TabToolbar label="Alert filters" onClear={sevFilter ? () => setSevFilter(null) : undefined}>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter alerts by severity">
        <span className="text-xs font-semibold text-slate-700">Alerts</span>
        {(["critical", "warning", "info"] as Severity[]).map((s) => (
          <button key={s} type="button" aria-pressed={sevFilter === s} onClick={() => { setSevFilter(sevFilter === s ? null : s); setAlertLimit(PAGE); }}
            className={`inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-full border px-3 text-xs font-medium sm:min-h-0 sm:py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${sevFilter === s ? "border-slate-900 bg-slate-900 text-white" : "border-border bg-card text-slate-800 hover:bg-muted"}`}>
            {SEV_LABEL[s]} <span className="tabular-nums font-bold">{sev[s]}</span>
          </button>
        ))}
      </div>
      </TabToolbar>

      {err && (
        <div role="alert" className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          Could not load {liveQ.isError ? "live alerts" : ""}{liveQ.isError && digestQ.isError ? " and " : ""}{digestQ.isError ? "team roll-ups" : ""}. Figures below may be incomplete.
          <button type="button" className="cursor-pointer font-medium underline" onClick={refresh}>Retry</button>
        </div>
      )}

      {/* KPI strip */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiTile label="Present" value={digestQ.isLoading ? "…" : sum.present} sub={`of ${sum.planned} due so far`} tone="green" icon={UserCheck} progress={sum.coveragePct ?? 0} />
        <KpiTile label="Coverage" value={sum.coveragePct === null ? "—" : `${sum.coveragePct}%`} sub="Present / due" tone={sum.coveragePct !== null && sum.coveragePct >= 90 ? "green" : "amber"} icon={Target} progress={sum.coveragePct ?? 0} />
        <KpiTile label="Shrinkage" value={sum.shrinkagePct === null ? "—" : `${sum.shrinkagePct}%`} sub={`Target ${SHRINKAGE_TARGET}% · pooled`} tone={shrinkTone} icon={TrendingDown} progress={sum.shrinkagePct ?? 0} />
        <KpiTile label="Unplanned absent" value={liveQ.isLoading ? "…" : alerts.length} sub={`${sev.critical} critical (1h+)`} tone={sev.critical > 0 ? "red" : alerts.length > 0 ? "amber" : "green"} icon={UserX} onClick={() => setSevFilter(sev.critical > 0 ? "critical" : null)} />
        <KpiTile label="Late arrivals" value={sum.late} sub={`${sum.incomplete} incomplete shifts`} tone={sum.late > 0 ? "amber" : "green"} icon={Clock} />
        <KpiTile label="Teams at risk" value={sum.atRiskManagers} sub={`of ${sum.managers} managers (score <60)`} tone={sum.atRiskManagers > 0 ? "red" : "green"} icon={Users} />
      </div>

      {/* Charts */}
      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title="Attendance mix" subtitle="Today so far, all teams in view" height={220} loading={digestQ.isLoading} empty={mix.length === 0} emptyLabel="No shifts due yet today"
          footer={<span>{sum.planned} planned shifts due · {sum.absent} absent, {sum.late} late, {sum.incomplete} incomplete, {sum.onTime} on time</span>}>
          <Suspense fallback={chartFallback}>
            <AttendanceMixDonut data={mix} />
          </Suspense>
        </ChartCard>
        <ChartCard title="Shrinkage by branch" subtitle={`Top ${Math.min(10, byBranch.length)} by shrinkage · dashed line = ${SHRINKAGE_TARGET}% target`} height={220} loading={digestQ.isLoading} empty={byBranch.length === 0}>
          <Suspense fallback={chartFallback}><ShrinkageByBranchBar data={byBranch} target={SHRINKAGE_TARGET} /></Suspense>
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* Alerts table */}
        <ConsoleCard>
          <div className="flex items-center justify-between border-b border-border p-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Live absence alerts</h2>
              <p className="text-xs text-slate-600">Rostered, shift started 15+ minutes ago, no punch-in. Most overdue first.</p>
            </div>
            <StatusPill tone={alerts.length > 10 ? "red" : alerts.length > 0 ? "amber" : "green"}>{shownAlerts.length} shown</StatusPill>
          </div>
          <div className="max-h-[440px] overflow-auto">
            {liveQ.isLoading ? (
              <div className="space-y-2 p-4" role="status" aria-label="Loading alerts">{[0, 1, 2, 3].map((i) => <div key={i} className="h-10 animate-pulse rounded bg-slate-100" />)}</div>
            ) : liveQ.isError && !liveQ.data ? (
              <div className="py-10 text-center text-sm text-red-800" role="alert">Alerts could not be loaded, so this is not an all-clear. <button type="button" className="cursor-pointer font-medium underline" onClick={refresh}>Retry</button></div>
            ) : shownAlerts.length === 0 ? (
              <div className="py-10 text-center"><CheckCircle2 className="mx-auto mb-2 h-10 w-10 text-emerald-600" aria-hidden /><p className="font-medium text-emerald-800">All clear</p><p className="text-sm text-slate-600">No unplanned absences detected</p></div>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-muted text-xs"><tr><th scope="col" className="p-2 text-left font-semibold">Employee</th><th scope="col" className="p-2 text-left font-semibold">Process</th><th scope="col" className="p-2 text-left font-semibold">Shift</th><th scope="col" className="p-2 text-right font-semibold">Overdue</th><th scope="col" className="p-2 text-left font-semibold">Severity</th></tr></thead>
                <tbody>
                  {shownAlerts.slice(0, alertLimit).map((a) => {
                    const s = alertSeverity(a.minutesSinceShiftStart);
                    return (
                      <tr key={`${a.employeeId}-${a.date}`} tabIndex={0} role="button" aria-label={`Open ${a.employeeName}`} onClick={() => setEmpId(a.employeeId)}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setEmpId(a.employeeId); } }}
                        className="cursor-pointer border-t border-border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                        <td className="p-2"><div className="font-medium text-slate-900">{a.employeeName}</div><div className="text-xs text-slate-600">{a.employeeCode}{a.managerName ? ` · ${a.managerName}` : ""}</div></td>
                        <td className="p-2 text-slate-700">{a.processName ?? "—"}</td>
                        <td className="p-2 tabular-nums text-slate-700">{a.shiftTime}</td>
                        <td className="p-2 text-right tabular-nums font-medium">{fmtDuration(a.minutesSinceShiftStart)}</td>
                        <td className="p-2"><StatusPill tone={SEV_TONE[s]}>{s}</StatusPill></td>
                      </tr>);
                  })}
                </tbody>
              </table>
            )}
            {shownAlerts.length > alertLimit && (
              <div className="p-3 text-center"><Button variant="outline" size="sm" className="cursor-pointer" onClick={() => setAlertLimit((n) => n + PAGE)}>Show {Math.min(PAGE, shownAlerts.length - alertLimit)} more of {shownAlerts.length - alertLimit}</Button></div>
            )}
          </div>
        </ConsoleCard>

        {/* Manager table */}
        <ConsoleCard>
          <div className="border-b border-border p-4">
            <h2 className="text-sm font-semibold text-slate-900">Team effectiveness</h2>
            <p className="text-xs text-slate-600">Score = coverage 40 + on-time 30 + (100-shrinkage) 20 + APR backlog 10. Click a row for detail.</p>
          </div>
          <div className="max-h-[440px] overflow-auto">
            {digestQ.isLoading ? (
              <div className="space-y-2 p-4" role="status" aria-label="Loading teams">{[0, 1, 2, 3].map((i) => <div key={i} className="h-10 animate-pulse rounded bg-slate-100" />)}</div>
            ) : rows.length === 0 ? (
              <p className="py-10 text-center text-sm text-slate-600">No rostered teams for the selected filters</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-muted text-xs"><tr>
                  <SortHead label="Manager" k="managerName" sort={sort} onSort={onSort} />
                  <SortHead label="Planned" k="planned" sort={sort} onSort={onSort} right />
                  <SortHead label="Present" k="present" sort={sort} onSort={onSort} right />
                  <SortHead label="Late" k="late" sort={sort} onSort={onSort} right />
                  <SortHead label="Absent" k="absent" sort={sort} onSort={onSort} right />
                  <SortHead label="Shrink" k="shrinkagePct" sort={sort} onSort={onSort} right />
                  <SortHead label="APR" k="aprPending" sort={sort} onSort={onSort} right />
                  <SortHead label="Score" k="score" sort={sort} onSort={onSort} right />
                </tr></thead>
                <tbody>
                  {rows.slice(0, teamLimit).map(({ d, late, absent, score }) => (
                    <tr key={d.managerId} tabIndex={0} role="button" aria-label={`Open ${d.managerName}'s team`} onClick={() => setMgrId(d.managerId)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setMgrId(d.managerId); } }}
                      className="cursor-pointer border-t border-border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                      <td className="p-2"><div className="font-medium text-slate-900">{d.managerName}</div><div className="text-xs text-slate-600">{d.branchName ?? "No branch"} · {d.teamSize} in team</div></td>
                      <td className="p-2 text-right tabular-nums">{d.planned}</td>
                      <td className="p-2 text-right tabular-nums">{d.present}</td>
                      <td className="p-2 text-right tabular-nums">{late}</td>
                      <td className="p-2 text-right tabular-nums">{absent}</td>
                      <td className="p-2 text-right tabular-nums">{d.planned > 0 ? `${d.shrinkagePct}%` : "—"}</td>
                      <td className="p-2 text-right tabular-nums">{d.aprPending}</td>
                      <td className="p-2 text-right"><StatusPill tone={scoreTone(score)} dot={false}>{score ?? "—"}</StatusPill></td>
                    </tr>))}
                </tbody>
              </table>
            )}
            {rows.length > teamLimit && (
              <div className="p-3 text-center"><Button variant="outline" size="sm" className="cursor-pointer" onClick={() => setTeamLimit((n) => n + PAGE)}>Show more ({rows.length - teamLimit} left)</Button></div>
            )}
          </div>
        </ConsoleCard>
      </div>

      {/* Process-wise shift adherence — process > shift slot > manager, with a drill-down to people. */}
      <ShiftAdherenceSection />

      {/* Bulk actions — operate on everything in the caller's RBAC scope, not on the filtered view. */}
      <ConsoleCard className="mt-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="mr-2 text-sm font-semibold text-slate-900">Notify managers</h3>
          <Button variant="outline" size="sm" className="min-h-[44px] cursor-pointer gap-2 sm:min-h-0" disabled={sendMassAlert.isPending || alerts.length === 0}
            onClick={() => confirmSend(`Email every manager with an open absence alert (${alerts.length} alert(s) in view)? This covers your full access scope, not just the filtered view.`, () => sendMassAlert.mutate())}>
            <Bell className="h-4 w-4" aria-hidden /> {sendMassAlert.isPending ? "Sending…" : `Send absence alerts${alerts.length > 0 ? ` (${alerts.length})` : ""}`}
          </Button>
          <Button variant="outline" size="sm" className="min-h-[44px] cursor-pointer gap-2 sm:min-h-0" disabled={notifyAll.isPending}
            onClick={() => confirmSend("Email the daily attendance summary to all managers in your access scope?", () => notifyAll.mutate())}>
            <MessageSquare className="h-4 w-4" aria-hidden /> {notifyAll.isPending ? "Sending…" : "Send daily summaries"}
          </Button>
        </div>
      </ConsoleCard>

      <EmployeeDrawer employeeId={empId} onClose={() => setEmpId(null)} />
      <ManagerDrawer managerId={mgrId} onClose={() => setMgrId(null)} />
    </div>
  );
}
