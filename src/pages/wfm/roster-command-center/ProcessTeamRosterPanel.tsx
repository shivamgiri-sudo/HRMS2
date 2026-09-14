/**
 * Process Team Roster — WFM Roster Console merge Phase C (new feature)
 *
 * Color-coded "who's on my team right now" view for a selected process, requested by
 * the owner: Green (on time), Amber (late), Red (absent), Blue (on leave) — plus 2
 * additional neutral states resolved during planning so real data isn't forced into
 * one of the 4: WEEK_OFF_HOLIDAY (grey) and UPCOMING (slate — today, shift not yet
 * due). Backed by GET /api/roster-analytics/process-roster, which reuses the shared
 * isShiftDueYet guard (see shift-due.util.ts) so "not yet due" is computed exactly
 * the same way here as in the Analytics/Live Monitoring tabs.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Users,
  RefreshCw,
  Search,
  Clock,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  TreePalm,
  CalendarOff,
  Hourglass,
} from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { useRosterConsoleFilters } from "./RosterConsoleFilterContext";

type Status = "ON_TIME" | "LATE" | "ABSENT" | "ON_LEAVE" | "WEEK_OFF_HOLIDAY" | "UPCOMING";

interface Member {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  branchId: string | null;
  branchName: string | null;
  status: Status;
  shiftName: string | null;
  shiftTime: string | null;
  clockInTime: string | null;
  clockOutTime: string | null;
  minutesLate: number | null;
  leaveType: string | null;
}

interface RosterView {
  processId: string;
  processName: string | null;
  date: string;
  members: Member[];
  counts: {
    onTime: number; late: number; absent: number;
    onLeave: number; weekOffHoliday: number; upcoming: number; total: number;
  };
}

// Exact 4 owner-requested colors, plus 2 neutral states kept visually distinct from
// them so they don't get mistaken for "good" or "bad".
const STATUS_CONFIG: Record<Status, { label: string; dot: string; badge: string; icon: typeof CheckCircle2 }> = {
  ON_TIME: { label: "On Time", dot: "bg-emerald-500", badge: "bg-emerald-100 text-emerald-700 border-emerald-200", icon: CheckCircle2 },
  LATE: { label: "Late", dot: "bg-amber-500", badge: "bg-amber-100 text-amber-700 border-amber-200", icon: AlertTriangle },
  ABSENT: { label: "Absent", dot: "bg-red-500", badge: "bg-red-100 text-red-700 border-red-200", icon: XCircle },
  ON_LEAVE: { label: "On Leave", dot: "bg-blue-500", badge: "bg-blue-100 text-blue-700 border-blue-200", icon: TreePalm },
  WEEK_OFF_HOLIDAY: { label: "Week Off / Holiday", dot: "bg-slate-400", badge: "bg-slate-100 text-slate-600 border-slate-200", icon: CalendarOff },
  UPCOMING: { label: "Upcoming", dot: "bg-violet-400", badge: "bg-violet-100 text-violet-600 border-violet-200", icon: Hourglass },
};

const STATUS_ORDER: Status[] = ["ON_TIME", "LATE", "ABSENT", "ON_LEAVE", "WEEK_OFF_HOLIDAY", "UPCOMING"];

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface EmployeeProfileDetail {
  employee: {
    id: string; employeeCode: string; fullName: string; designation: string;
    processName: string; branchName: string; managerName: string | null;
    dateOfJoining: string; aonDays: number;
  };
  currentPeriod: { month: string; planned: number; present: number; adherencePct: number; onTime: number; late: number; absent: number };
  trend: Array<{ month: string; adherencePct: number }>;
  comparison: { teamAvg: number; branchAvg: number; employeePct: number };
  riskSignals: { tier: string | null; signals: string[] };
}

export default function ProcessTeamRosterPanel() {
  const { filters } = useRosterConsoleFilters();
  const [date, setDate] = useState(todayISO());
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<Status | null>(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["process-team-roster", filters.processId, date],
    queryFn: () => hrmsApi.get<RosterView>(`/api/roster-analytics/process-roster?processId=${filters.processId}&date=${date}`),
    enabled: !!filters.processId,
  });

  const { data: employeeProfile, isLoading: profileLoading } = useQuery({
    queryKey: ["process-team-roster", "employee-profile", selectedEmployeeId],
    queryFn: () => hrmsApi.get<EmployeeProfileDetail>(`/api/roster-analytics/employee-profile/${selectedEmployeeId}`),
    enabled: !!selectedEmployeeId,
  });

  const members = data?.members ?? [];

  const filteredMembers = useMemo(() => {
    let list = members;
    if (statusFilter) list = list.filter((m) => m.status === statusFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((m) => m.employeeName.toLowerCase().includes(q) || m.employeeCode.toLowerCase().includes(q));
    }
    return list;
  }, [members, statusFilter, search]);

  if (!filters.processId) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 py-16 text-center">
        <Users className="mx-auto h-10 w-10 text-slate-300" />
        <p className="mt-3 font-medium text-slate-600">Select a process above to see its team roster</p>
        <p className="mt-1 text-sm text-slate-400">Pick a process from the Process filter in the header to load this view.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-800">
            {data?.processName ?? "Team Roster"}
          </h2>
          <p className="text-sm text-slate-500">Live status for every team member scheduled on this date</p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={date}
            max={todayISO()}
            onChange={(e) => setDate(e.target.value)}
            className="h-9 w-[150px]"
          />
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="py-16 text-center text-slate-500 animate-pulse">Loading team roster...</div>
      ) : isError ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-red-700">
          Failed to load team roster{error instanceof Error ? `: ${error.message}` : ""}.
        </div>
      ) : (
        <>
          {/* Summary tiles — click one to filter the table below; click again to clear. */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {STATUS_ORDER.map((status) => {
              const cfg = STATUS_CONFIG[status];
              const Icon = cfg.icon;
              const count = data ? (
                status === "ON_TIME" ? data.counts.onTime :
                status === "LATE" ? data.counts.late :
                status === "ABSENT" ? data.counts.absent :
                status === "ON_LEAVE" ? data.counts.onLeave :
                status === "WEEK_OFF_HOLIDAY" ? data.counts.weekOffHoliday :
                data.counts.upcoming
              ) : 0;
              const active = statusFilter === status;
              return (
                <button
                  key={status}
                  onClick={() => setStatusFilter(active ? null : status)}
                  className={`rounded-xl border p-3 text-left transition-all ${cfg.badge} ${active ? "ring-2 ring-offset-1 ring-slate-400" : "opacity-90 hover:opacity-100"}`}
                >
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4" />
                    <span className="text-xs font-semibold uppercase tracking-wide">{cfg.label}</span>
                  </div>
                  <div className="mt-1 text-2xl font-bold">{count}</div>
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search name or code..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 pl-8"
              />
            </div>
            <div className="text-sm text-slate-500">
              {filteredMembers.length} of {members.length} team members
            </div>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Employee</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Shift</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase">Clock In</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredMembers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                      No team members match the current filters
                    </td>
                  </tr>
                ) : (
                  filteredMembers.map((m) => {
                    const cfg = STATUS_CONFIG[m.status];
                    return (
                      <tr
                        key={m.employeeId}
                        className="hover:bg-slate-50 cursor-pointer"
                        onClick={() => setSelectedEmployeeId(m.employeeId)}
                      >
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-800">{m.employeeName}</div>
                          <div className="text-xs text-slate-500">{m.employeeCode}{m.branchName ? ` · ${m.branchName}` : ""}</div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className={cfg.badge}>
                            <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
                            {cfg.label}
                            {m.status === "LATE" && m.minutesLate ? ` · +${m.minutesLate}m` : ""}
                            {m.status === "ON_LEAVE" && m.leaveType ? ` · ${m.leaveType}` : ""}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{m.shiftTime ?? "—"}</td>
                        <td className="px-4 py-3 text-center text-slate-600">{m.clockInTime?.slice(0, 5) ?? "—"}</td>
                        <td className="px-4 py-3 text-center">
                          <Clock className="h-4 w-4 text-slate-300 inline" />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Row drill-down (Drill-Down Mandate), reusing the existing dedicated
          employee-profile endpoint — same pattern as Shift Effectiveness's Break
          Policy Violators drawer. */}
      <Sheet open={!!selectedEmployeeId} onOpenChange={(open) => !open && setSelectedEmployeeId(null)}>
        <SheetContent className="w-[400px] sm:w-[520px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{employeeProfile?.employee.fullName ?? "Employee Detail"}</SheetTitle>
          </SheetHeader>
          {profileLoading ? (
            <div className="py-12 text-center text-slate-500 animate-pulse">Loading...</div>
          ) : employeeProfile ? (
            <div className="space-y-6 mt-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">Employee</p>
                <p className="text-sm">{employeeProfile.employee.employeeCode} · {employeeProfile.employee.designation || "—"}</p>
                <p className="text-xs text-slate-500">{employeeProfile.employee.processName} · {employeeProfile.employee.branchName}</p>
                <p className="text-xs text-slate-500">Manager: {employeeProfile.employee.managerName || "—"}</p>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">
                  This Month ({employeeProfile.currentPeriod.month})
                </p>
                <div className="grid grid-cols-4 gap-2 text-center text-sm">
                  <div className="rounded-lg bg-slate-50 p-2"><div className="font-bold">{employeeProfile.currentPeriod.adherencePct}%</div><div className="text-xs text-slate-500">Adherence</div></div>
                  <div className="rounded-lg bg-emerald-50 p-2"><div className="font-bold text-emerald-700">{employeeProfile.currentPeriod.onTime}</div><div className="text-xs text-slate-500">On Time</div></div>
                  <div className="rounded-lg bg-amber-50 p-2"><div className="font-bold text-amber-700">{employeeProfile.currentPeriod.late}</div><div className="text-xs text-slate-500">Late</div></div>
                  <div className="rounded-lg bg-red-50 p-2"><div className="font-bold text-red-700">{employeeProfile.currentPeriod.absent}</div><div className="text-xs text-slate-500">Absent</div></div>
                </div>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">Team / Branch Comparison</p>
                <p className="text-sm text-slate-600">
                  This employee: {employeeProfile.comparison.employeePct}% · Team avg: {employeeProfile.comparison.teamAvg}% · Branch avg: {employeeProfile.comparison.branchAvg}%
                </p>
              </div>
              {employeeProfile.riskSignals.signals.length > 0 && (
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">Risk Signals</p>
                  <Badge variant={employeeProfile.riskSignals.tier === "HIGH" ? "destructive" : "secondary"}>
                    {employeeProfile.riskSignals.tier} risk
                  </Badge>
                  <ul className="text-sm text-slate-600 list-disc pl-5 mt-1">
                    {employeeProfile.riskSignals.signals.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                </div>
              )}
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
