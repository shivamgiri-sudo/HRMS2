/**
 * Roster View — see who is working what, with adherence color-coding.
 *
 * Color legend:
 * - GREEN: Followed (on-time, within 5-min grace)
 * - AMBER: Late (attended but > 5 min late)
 * - RED: Unplanned absence (rostered but no attendance)
 * - BROWN: Incomplete shift (worked < 80% of required)
 * - GREY: Off day (WO/Leave/Holiday)
 *
 * Shows adherence % at employee, process, and branch levels.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { hrmsApi } from "@/lib/hrmsApi";
import { RefreshCw, Users, TrendingUp, Building2, Briefcase, ChevronRight, Eye, EyeOff, Activity, History, ShieldCheck, Trophy } from "lucide-react";
import { Link } from "react-router-dom";

type AdherenceStatus = 'GREEN' | 'AMBER' | 'RED' | 'BROWN' | 'GREY' | 'FUTURE';

interface DayCell {
  label: string;
  adherence?: AdherenceStatus;
  lateMinutes?: number;
  workedPct?: number;
}

interface ViewRow {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  reportingManager: string | null;
  processName: string | null;
  branchName: string | null;
  costCentre: string | null;
  days: Record<string, string>;
  dayCells?: Record<string, DayCell>;
  adherencePct?: number;
}

interface Analytics {
  overall: { adherencePct: number | null; totalShifts: number; onTimeShifts: number };
  byProcess: Array<{ processId: string; processName: string; adherencePct: number | null; totalShifts: number }>;
  byBranch: Array<{ branchId: string; branchName: string; adherencePct: number | null; totalShifts: number }>;
}

interface TrendMonth {
  month: string;
  adherencePct: number | null;
  totalShifts: number;
  onTimeShifts: number;
  lateShifts: number;
  absentShifts: number;
  incompleteShifts: number;
}

/** Monday of the current week */
function weekStart(): string {
  const d = new Date();
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d.toISOString().slice(0, 10);
}
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

const ALL = "__all__";

/** Adherence color mapping */
const ADHERENCE_COLORS: Record<AdherenceStatus, { bg: string; text: string; border: string }> = {
  GREEN: { bg: 'bg-emerald-100', text: 'text-emerald-800', border: 'border-emerald-300' },
  AMBER: { bg: 'bg-amber-100', text: 'text-amber-800', border: 'border-amber-300' },
  RED: { bg: 'bg-red-100', text: 'text-red-800', border: 'border-red-300' },
  BROWN: { bg: 'bg-orange-100', text: 'text-orange-900', border: 'border-orange-300' },
  GREY: { bg: 'bg-slate-100', text: 'text-slate-400', border: 'border-slate-200' },
  FUTURE: { bg: 'bg-white', text: 'text-slate-600', border: 'border-slate-200' },
};

const ADHERENCE_LABELS: Record<AdherenceStatus, string> = {
  GREEN: 'On-time',
  AMBER: 'Late',
  RED: 'Absent',
  BROWN: 'Incomplete',
  GREY: 'Off',
  FUTURE: 'Upcoming',
};

export default function RosterViewPage() {
  const [fromDate, setFromDate] = useState(weekStart());
  const [toDate, setToDate] = useState(addDays(weekStart(), 6));
  const [branchId, setBranchId] = useState(ALL);
  const [processId, setProcessId] = useState(ALL);
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState(0);
  const [showAdherence, setShowAdherence] = useState(true);
  const [selectedEmployee, setSelectedEmployee] = useState<ViewRow | null>(null);

  const { data: branchData } = useQuery({
    queryKey: ["roster-view", "branches"],
    queryFn: () => hrmsApi.get<{ data: Array<{ id: string; branch_name: string }> }>("/api/org/branches"),
  });
  const { data: processData } = useQuery({
    queryKey: ["roster-view", "processes"],
    queryFn: () => hrmsApi.get<{ data: Array<{ id: string; process_name: string }> }>("/api/processes?limit=300"),
  });

  const { data, isFetching, isError, error } = useQuery({
    queryKey: ["roster-view", "table", fromDate, toDate, branchId, processId, search, applied, showAdherence],
    queryFn: () => {
      const p = new URLSearchParams({ fromDate, toDate, limit: "200" });
      if (branchId !== ALL) p.set("branchId", branchId);
      if (processId !== ALL) p.set("processId", processId);
      if (search.trim()) p.set("search", search.trim());
      if (showAdherence) p.set("includeAdherence", "true");
      return hrmsApi.get<{ rows: ViewRow[]; dates: string[]; total: number; analytics?: Analytics }>(
        `/api/wfm/roster-imports/view/table?${p.toString()}`,
      );
    },
  });

  // Employee trend query
  const { data: trendData, isFetching: trendLoading } = useQuery({
    queryKey: ["roster-adherence-trend", selectedEmployee?.employeeId],
    queryFn: () => hrmsApi.get<{ employeeId: string; months: TrendMonth[] }>(
      `/api/wfm/roster-imports/adherence-trend/${selectedEmployee?.employeeId}?months=6`
    ),
    enabled: !!selectedEmployee,
  });

  const rows = data?.rows ?? [];
  const dates = data?.dates ?? [];
  const analytics = data?.analytics;

  return (
    <DashboardLayout>
      <div className="space-y-5 p-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Roster Adherence View</h1>
            <p className="mt-1 text-sm text-slate-500">
              Who is working what, with color-coded adherence tracking.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/wfm/roster-command-center">
              <Button variant="outline" size="sm" className="text-xs">
                <Activity className="w-3.5 h-3.5 mr-1" /> Command Center
              </Button>
            </Link>
            <Link to="/wfm/team-comparison">
              <Button variant="outline" size="sm" className="text-xs">
                <Trophy className="w-3.5 h-3.5 mr-1" /> Team Rankings
              </Button>
            </Link>
            <Link to="/wfm/roster-compliance">
              <Button variant="outline" size="sm" className="text-xs">
                <ShieldCheck className="w-3.5 h-3.5 mr-1" /> Compliance
              </Button>
            </Link>
            <Link to="/wfm/roster-audit">
              <Button variant="outline" size="sm" className="text-xs">
                <History className="w-3.5 h-3.5 mr-1" /> Audit Trail
              </Button>
            </Link>
          </div>
        </div>

        {/* Analytics Cards */}
        {showAdherence && analytics && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Overall */}
            <Card className="bg-gradient-to-br from-indigo-50 to-white border-indigo-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-indigo-600 flex items-center gap-2">
                  <TrendingUp className="h-4 w-4" /> Overall Adherence
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-indigo-700">
                  {analytics.overall.adherencePct !== null ? `${analytics.overall.adherencePct}%` : '—'}
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  {analytics.overall.onTimeShifts} / {analytics.overall.totalShifts} on-time shifts
                </p>
              </CardContent>
            </Card>

            {/* Top Process */}
            <Card className="bg-gradient-to-br from-emerald-50 to-white border-emerald-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-emerald-600 flex items-center gap-2">
                  <Briefcase className="h-4 w-4" /> Process Adherence
                </CardTitle>
              </CardHeader>
              <CardContent>
                {analytics.byProcess.length > 0 ? (
                  <div className="space-y-2">
                    {analytics.byProcess.slice(0, 3).map((p) => (
                      <div key={p.processId} className="flex items-center justify-between text-sm">
                        <span className="text-slate-700 truncate max-w-[140px]">{p.processName}</span>
                        <Badge variant={p.adherencePct !== null && p.adherencePct >= 80 ? "default" : "secondary"}>
                          {p.adherencePct !== null ? `${p.adherencePct}%` : '—'}
                        </Badge>
                      </div>
                    ))}
                    {analytics.byProcess.length > 3 && (
                      <p className="text-xs text-slate-400">+{analytics.byProcess.length - 3} more</p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-slate-400">No process data</p>
                )}
              </CardContent>
            </Card>

            {/* Top Branch */}
            <Card className="bg-gradient-to-br from-amber-50 to-white border-amber-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-amber-600 flex items-center gap-2">
                  <Building2 className="h-4 w-4" /> Branch Adherence
                </CardTitle>
              </CardHeader>
              <CardContent>
                {analytics.byBranch.length > 0 ? (
                  <div className="space-y-2">
                    {analytics.byBranch.slice(0, 3).map((b) => (
                      <div key={b.branchId} className="flex items-center justify-between text-sm">
                        <span className="text-slate-700 truncate max-w-[140px]">{b.branchName}</span>
                        <Badge variant={b.adherencePct !== null && b.adherencePct >= 80 ? "default" : "secondary"}>
                          {b.adherencePct !== null ? `${b.adherencePct}%` : '—'}
                        </Badge>
                      </div>
                    ))}
                    {analytics.byBranch.length > 3 && (
                      <p className="text-xs text-slate-400">+{analytics.byBranch.length - 3} more</p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-slate-400">No branch data</p>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Color Legend */}
        {showAdherence && (
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="text-slate-500 font-medium">Legend:</span>
            {(['GREEN', 'AMBER', 'RED', 'BROWN', 'GREY'] as AdherenceStatus[]).map((status) => (
              <div key={status} className="flex items-center gap-1">
                <span className={`w-4 h-4 rounded ${ADHERENCE_COLORS[status].bg} ${ADHERENCE_COLORS[status].border} border`} />
                <span className="text-slate-600">{ADHERENCE_LABELS[status]}</span>
              </div>
            ))}
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-white p-4 shadow-sm">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">FROM</label>
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-40" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">TO</label>
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-40" />
          </div>
          <div className="min-w-[170px]">
            <label className="mb-1 block text-xs font-semibold text-slate-500">BRANCH</label>
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger><SelectValue placeholder="All branches" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All branches</SelectItem>
                {(branchData?.data ?? []).map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.branch_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[190px]">
            <label className="mb-1 block text-xs font-semibold text-slate-500">PROCESS</label>
            <Select value={processId} onValueChange={setProcessId}>
              <SelectTrigger><SelectValue placeholder="All processes" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All processes</SelectItem>
                {(processData?.data ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.process_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[190px] flex-1">
            <label className="mb-1 block text-xs font-semibold text-slate-500">EMPLOYEE</label>
            <Input
              placeholder="Code or name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && setApplied((n) => n + 1)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={showAdherence} onCheckedChange={setShowAdherence} id="adherence-toggle" />
            <label htmlFor="adherence-toggle" className="text-xs text-slate-600 cursor-pointer flex items-center gap-1">
              {showAdherence ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
              Adherence
            </label>
          </div>
          <Button onClick={() => setApplied((n) => n + 1)} disabled={isFetching}>
            {isFetching ? <RefreshCw className="h-4 w-4 animate-spin" /> : "Show"}
          </Button>
        </div>

        {isError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {(error as Error).message}
          </div>
        )}

        {!isError && (
          <div className="rounded-xl border bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b px-4 py-3 text-sm text-slate-600">
              <Users className="h-4 w-4 text-slate-400" />
              <span className="font-semibold">{data?.total ?? 0}</span> employees
              {rows.length < (data?.total ?? 0) && (
                <span className="text-slate-400">showing first {rows.length}</span>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2 text-left">Code</th>
                    <th className="px-3 py-2 text-left">Employee</th>
                    {showAdherence && <th className="px-3 py-2 text-center">Adh %</th>}
                    <th className="px-3 py-2 text-left">Process</th>
                    <th className="px-3 py-2 text-left">Branch</th>
                    {dates.map((d) => (
                      <th key={d} className="whitespace-nowrap px-2 py-2 text-center min-w-[70px]">
                        {new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                        <div className="font-normal normal-case text-slate-400">
                          {new Date(`${d}T00:00:00`).toLocaleDateString("en", { weekday: "short" })}
                        </div>
                      </th>
                    ))}
                    {showAdherence && <th className="px-2 py-2 text-center">Trend</th>}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((r) => (
                    <tr key={r.employeeId} className="hover:bg-slate-50">
                      <td className="sticky left-0 z-10 bg-white px-3 py-2 font-mono text-xs">{r.employeeCode}</td>
                      <td className="px-3 py-2 font-medium text-slate-800">{r.employeeName}</td>
                      {showAdherence && (
                        <td className="px-3 py-2 text-center">
                          {r.adherencePct !== undefined ? (
                            <Badge variant={r.adherencePct >= 80 ? "default" : r.adherencePct >= 60 ? "secondary" : "destructive"}>
                              {r.adherencePct}%
                            </Badge>
                          ) : '—'}
                        </td>
                      )}
                      <td className="px-3 py-2 text-slate-600 truncate max-w-[120px]">{r.processName ?? "—"}</td>
                      <td className="px-3 py-2 text-slate-600">{r.branchName ?? "—"}</td>
                      {dates.map((d) => {
                        const cell = showAdherence && r.dayCells ? r.dayCells[d] : null;
                        const label = cell?.label ?? r.days[d] ?? "·";
                        const adherence = cell?.adherence ?? 'FUTURE';
                        const colors = ADHERENCE_COLORS[adherence];

                        return (
                          <td
                            key={d}
                            className={`whitespace-nowrap px-2 py-1.5 text-center text-xs border ${
                              showAdherence ? `${colors.bg} ${colors.text} ${colors.border}` : 'text-slate-700'
                            }`}
                            title={showAdherence ? `${ADHERENCE_LABELS[adherence]}${cell?.lateMinutes ? ` (+${cell.lateMinutes}m)` : ''}${cell?.workedPct !== undefined ? ` ${cell.workedPct}%` : ''}` : undefined}
                          >
                            {label}
                          </td>
                        );
                      })}
                      {showAdherence && (
                        <td className="px-2 py-2 text-center">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => setSelectedEmployee(r)}
                          >
                            <ChevronRight className="h-4 w-4" />
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {rows.length === 0 && !isFetching && (
                    <tr>
                      <td colSpan={showAdherence ? 7 + dates.length : 5 + dates.length} className="px-4 py-10 text-center text-slate-400">
                        No roster found for these dates and filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Employee Trend Drawer */}
      <Sheet open={!!selectedEmployee} onOpenChange={(open) => !open && setSelectedEmployee(null)}>
        <SheetContent className="w-[400px] sm:w-[540px]">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-indigo-600" />
              {selectedEmployee?.employeeName} — Adherence Trend
            </SheetTitle>
          </SheetHeader>
          <div className="mt-6">
            {trendLoading ? (
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="h-6 w-6 animate-spin text-slate-400" />
              </div>
            ) : trendData?.months ? (
              <div className="space-y-4">
                <p className="text-sm text-slate-600">Past 6 months adherence trend</p>
                <div className="space-y-3">
                  {trendData.months.map((m) => (
                    <div key={m.month} className="rounded-lg border p-3 bg-slate-50">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-slate-800">{m.month}</span>
                        <Badge variant={m.adherencePct !== null && m.adherencePct >= 80 ? "default" : "secondary"}>
                          {m.adherencePct !== null ? `${m.adherencePct}%` : '—'}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-4 gap-2 text-xs">
                        <div className="text-center">
                          <div className={`font-semibold ${ADHERENCE_COLORS.GREEN.text}`}>{m.onTimeShifts}</div>
                          <div className="text-slate-500">On-time</div>
                        </div>
                        <div className="text-center">
                          <div className={`font-semibold ${ADHERENCE_COLORS.AMBER.text}`}>{m.lateShifts}</div>
                          <div className="text-slate-500">Late</div>
                        </div>
                        <div className="text-center">
                          <div className={`font-semibold ${ADHERENCE_COLORS.RED.text}`}>{m.absentShifts}</div>
                          <div className="text-slate-500">Absent</div>
                        </div>
                        <div className="text-center">
                          <div className={`font-semibold ${ADHERENCE_COLORS.BROWN.text}`}>{m.incompleteShifts}</div>
                          <div className="text-slate-500">Incomplete</div>
                        </div>
                      </div>
                      {/* Progress bar */}
                      <div className="mt-2 h-2 rounded-full overflow-hidden bg-slate-200 flex">
                        {m.totalShifts > 0 && (
                          <>
                            <div
                              className="bg-emerald-500 h-full"
                              style={{ width: `${(m.onTimeShifts / m.totalShifts) * 100}%` }}
                            />
                            <div
                              className="bg-amber-500 h-full"
                              style={{ width: `${(m.lateShifts / m.totalShifts) * 100}%` }}
                            />
                            <div
                              className="bg-red-500 h-full"
                              style={{ width: `${(m.absentShifts / m.totalShifts) * 100}%` }}
                            />
                            <div
                              className="bg-orange-600 h-full"
                              style={{ width: `${(m.incompleteShifts / m.totalShifts) * 100}%` }}
                            />
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-center text-slate-400 py-8">No trend data available</p>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </DashboardLayout>
  );
}
