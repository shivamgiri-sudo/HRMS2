/**
 * Process Team Roster — colour-coded "who is on my team" grid for a process/LOB on a date.
 * Backed by GET /api/roster-analytics/process-roster (server-side branch/LOB scope) and the
 * member drill-down GET /api/roster-analytics/process-roster/member/:employeeId.
 * Status logic lives in the backend (process-team-roster.util.ts); pure UI maths in
 * process-team-roster/rosterModel.ts.
 */
import { Suspense, lazy, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarOff, CheckCircle2, Clock, Hourglass, Info, RefreshCw, Search, TreePalm, Users, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { hrmsApi } from "@/lib/hrmsApi";
import { PanelHeader } from "@/components/wfm/console/PanelHeader";
import { ConsoleCard } from "@/components/wfm/console/ConsoleCard";
import { ChartCard } from "@/components/wfm/console/ChartCard";
import { KpiTile } from "@/components/wfm/console/KpiTile";
import { scopeParams } from "./filterState";
import { useRosterConsoleFilters } from "./RosterConsoleFilterContext";
import { RosterTable } from "./process-team-roster/RosterTable";
import { MemberDrawer } from "./process-team-roster/MemberDrawer";
import {
  STATUS_LABEL, STATUS_ORDER, breakdownBy, buildAlerts, countMembers, deltaPoints, fmtDate, fmtPct, prevDayISO, presentRate,
  punctualityRate, sortMembers, todayISO, type RosterView, type SortDir, type SortKey, type Status,
} from "./process-team-roster/rosterModel";

const StatusDonut = lazy(() => import("./process-team-roster/RosterCharts").then((m) => ({ default: m.StatusDonut })));
const StackedBreakdown = lazy(() => import("./process-team-roster/RosterCharts").then((m) => ({ default: m.StackedBreakdown })));

const CHART_FALLBACK = <div className="h-full animate-pulse rounded-md bg-slate-100" role="status" aria-label="Loading chart" />;
const TILE: Record<Status, { icon: typeof Users; tone: "green" | "amber" | "red" | "blue" | "neutral" | "violet" }> = {
  ON_TIME: { icon: CheckCircle2, tone: "green" }, LATE: { icon: AlertTriangle, tone: "amber" }, ABSENT: { icon: XCircle, tone: "red" },
  ON_LEAVE: { icon: TreePalm, tone: "blue" }, WEEK_OFF_HOLIDAY: { icon: CalendarOff, tone: "neutral" }, UPCOMING: { icon: Hourglass, tone: "violet" },
};
const COUNT_KEY = { ON_TIME: "onTime", LATE: "late", ABSENT: "absent", ON_LEAVE: "onLeave", WEEK_OFF_HOLIDAY: "weekOffHoliday", UPCOMING: "upcoming" } as const;
const SEV_CLS = {
  critical: "border-red-200 bg-red-50 text-red-800",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  info: "border-blue-200 bg-blue-50 text-blue-900",
} as const;

export default function ProcessTeamRosterPanel() {
  const { filters, setProcessId } = useRosterConsoleFilters();
  const [date, setDate] = useState(todayISO());
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<Status | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "status", dir: "asc" });
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);

  const rosterUrl = (d: string) =>
    `/api/roster-analytics/process-roster?${scopeParams({ branchId: filters.branchId, processId: filters.processId, lobId: filters.lobId }, { date: d })}`;
  const scopeKey = [filters.processId, filters.branchId, filters.lobId];
  const QOPTS = { staleTime: 60_000, placeholderData: keepPreviousData, refetchOnWindowFocus: false } as const;

  const cur = useQuery({ queryKey: ["process-team-roster", ...scopeKey, date], queryFn: () => hrmsApi.get<RosterView>(rosterUrl(date)), enabled: !!filters.processId, ...QOPTS });
  // Previous day, in parallel, only to show a delta on the attendance tile.
  const prevDate = prevDayISO(date);
  const prev = useQuery({ queryKey: ["process-team-roster", ...scopeKey, prevDate], queryFn: () => hrmsApi.get<RosterView>(rosterUrl(prevDate)), enabled: !!filters.processId, ...QOPTS });

  const { data: procData, isLoading: procLoading } = useQuery({
    queryKey: ["roster-console", "processes-list"],
    queryFn: () => hrmsApi.get<{ data: Array<{ id: string; process_name: string }> }>("/api/processes?limit=200"),
    staleTime: 5 * 60_000,
  });
  const processOptions = useMemo(() => (procData?.data ?? []).map((p) => ({ value: p.id, label: p.process_name })), [procData]);

  const members = useMemo(() => cur.data?.members ?? [], [cur.data]);
  const counts = useMemo(() => countMembers(members), [members]);
  const prevCounts = useMemo(() => (prev.data ? countMembers(prev.data.members) : null), [prev.data]);
  const rate = presentRate(counts);
  const alerts = useMemo(() => buildAlerts(counts), [counts]);
  const byShift = useMemo(() => breakdownBy(members, (m) => m.shiftName, "No shift"), [members]);
  const byLob = useMemo(() => breakdownBy(members, (m) => m.lobName ?? m.branchName, "Unassigned"), [members]);

  const rows = useMemo(() => {
    let list = members;
    if (statusFilter) list = list.filter((m) => m.status === statusFilter);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((m) => m.employeeName.toLowerCase().includes(q) || m.employeeCode.toLowerCase().includes(q));
    return sortMembers(list, sort.key, sort.dir);
  }, [members, statusFilter, search, sort]);

  const toggleStatus = (s: Status) => setStatusFilter((p) => (p === s ? null : s));
  const onSort = (key: SortKey) => setSort((p) => (p.key === key ? { key, dir: p.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));

  if (!filters.processId) {
    return (
      <ConsoleCard className="mx-auto max-w-xl p-6 text-center">
        <Users className="mx-auto h-8 w-8 text-slate-600" aria-hidden />
        <h2 className="mt-2 text-base font-semibold text-slate-900">Choose a process</h2>
        <p className="mt-1 text-sm text-slate-600">Pick a process to see its team roster for the day.</p>
        <div className="mt-4 text-left">
          <SearchableSelect options={processOptions} value="" onChange={setProcessId} loading={procLoading} placeholder="Select a process..." searchPlaceholder="Search processes..." aria-label="Process" />
        </div>
        {processOptions.length > 0 && (
          <div className="mt-3 flex flex-wrap justify-center gap-1.5">
            {processOptions.slice(0, 6).map((o) => (
              <button key={o.value} type="button" onClick={() => setProcessId(o.value)}
                className="min-h-[44px] cursor-pointer rounded-full border border-border bg-white px-3 py-1 text-xs font-medium text-slate-700 transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none sm:min-h-0">
                {o.label}
              </button>
            ))}
          </div>
        )}
      </ConsoleCard>
    );
  }

  const loading = cur.isLoading;
  return (
    <div className="space-y-4">
      <PanelHeader
        icon={Users}
        title={cur.data?.processName ?? "Team Roster"}
        description={`Live status for every team member rostered on ${fmtDate(date)}`}
        actions={
          <>
            <Input type="date" value={date} max={todayISO()} onChange={(e) => e.target.value && setDate(e.target.value)} className="h-11 w-[160px] bg-white text-slate-900 sm:h-9" aria-label="Roster date" />
            <Button variant="outline" size="sm" className="min-h-[44px] cursor-pointer sm:min-h-0" onClick={() => { cur.refetch(); prev.refetch(); }} disabled={cur.isFetching} aria-label="Refresh roster">
              <RefreshCw className={`mr-1 h-4 w-4 ${cur.isFetching ? "motion-safe:animate-spin" : ""}`} aria-hidden /> Refresh
            </Button>
          </>
        }
      />

      {cur.isError ? (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-6 text-center text-sm text-red-800">
          Failed to load team roster{cur.error instanceof Error ? `: ${cur.error.message}` : ""}.{" "}
          <button type="button" onClick={() => cur.refetch()} className="cursor-pointer font-semibold underline">Retry</button>
        </div>
      ) : (
        <>
          {alerts.length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label="Roster insights">
              {alerts.map((a) => {
                const Icon = a.severity === "info" ? Info : AlertTriangle;
                return (
                  <li key={a.key}>
                    <button type="button" onClick={() => toggleStatus(a.status)} aria-pressed={statusFilter === a.status}
                      className={`inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-left text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0 ${SEV_CLS[a.severity]} ${statusFilter === a.status ? "ring-2 ring-current" : ""}`}>
                      <Icon className="h-4 w-4 shrink-0" aria-hidden />
                      <span className="font-semibold uppercase tracking-wide">{a.severity}</span>
                      <span>{a.text}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-4 xl:grid-cols-8">
            <KpiTile label="Attendance" value={loading ? "…" : fmtPct(rate)} icon={Users} tone="blue" progress={rate ?? 0}
              delta={deltaPoints(rate, prevCounts ? presentRate(prevCounts) : null)} deltaBad="down"
              sub={`vs ${fmtDate(prevDate)} · of those due`} />
            <KpiTile label="Punctuality" value={loading ? "…" : fmtPct(punctualityRate(counts))} icon={Clock} tone="green" progress={punctualityRate(counts) ?? 0} sub="on time of present" />
            {STATUS_ORDER.map((s) => {
              const t = TILE[s];
              const n = counts[COUNT_KEY[s]];
              const pn = prevCounts ? prevCounts[COUNT_KEY[s]] : null;
              return (
                <KpiTile key={s} label={STATUS_LABEL[s]} value={loading ? "…" : n} icon={t.icon} tone={t.tone}
                  sub={pn === null ? undefined : `${fmtDate(prevDate)}: ${pn}`}
                  onClick={() => toggleStatus(s)} className={statusFilter === s ? "ring-2 ring-primary" : ""} />
              );
            })}
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <ChartCard title="Status mix" subtitle="Click a segment to filter" loading={loading} empty={counts.total === 0} height={240}>
              <Suspense fallback={CHART_FALLBACK}><StatusDonut counts={counts} onPick={toggleStatus} /></Suspense>
            </ChartCard>
            <ChartCard title="By shift" subtitle="Top 8 shifts" loading={loading} empty={byShift.length === 0} height={240}>
              <Suspense fallback={CHART_FALLBACK}><StackedBreakdown data={byShift} onPick={toggleStatus} /></Suspense>
            </ChartCard>
            <ChartCard title="By LOB / branch" subtitle="LOB, else branch" loading={loading} empty={byLob.length === 0} height={240}>
              <Suspense fallback={CHART_FALLBACK}><StackedBreakdown data={byLob} onPick={toggleStatus} /></Suspense>
            </ChartCard>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-2.5 top-3 h-4 w-4 text-slate-500" aria-hidden />
              <Input placeholder="Search name or code..." value={search} onChange={(e) => setSearch(e.target.value)} className="h-11 pl-8 sm:h-9" aria-label="Search team members" />
            </div>
            <div className="flex items-center gap-2 text-sm text-slate-600" aria-live="polite">
              {statusFilter && (
                <button type="button" onClick={() => setStatusFilter(null)} className="cursor-pointer rounded-full border border-border px-2 py-0.5 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {STATUS_LABEL[statusFilter]} (clear)
                </button>
              )}
              <span className="tabular-nums">{rows.length} of {members.length} team members</span>
            </div>
          </div>

          {loading ? (
            <div className="space-y-2" role="status" aria-label="Loading team roster">
              {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-12 animate-pulse rounded-md bg-slate-100" />)}
            </div>
          ) : (
            <RosterTable rows={rows} sortKey={sort.key} sortDir={sort.dir} onSort={onSort} onOpen={setSelectedEmployeeId} />
          )}
        </>
      )}

      <MemberDrawer employeeId={selectedEmployeeId} date={date} onClose={() => setSelectedEmployeeId(null)} />
    </div>
  );
}
