import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { hrmsApi } from "@/lib/hrmsApi";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import {
  Calendar,
  RefreshCw,
  Send,
  Lock,
  Users,
  AlertTriangle,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Process {
  id: string;
  name: string;
}

interface RosterPlan {
  id: string;
  process_id: string | null;
  branch_id: string | null;
  plan_status: string;
  from_date: string;
  to_date: string;
  created_at: string;
}

interface ActualAssignment {
  id: string;
  employee_id: string;
  employee_code: string;
  full_name: string;
  work_date: string;
  shift_code: string | null;
  shift_name: string | null;
  shift_start_time: string | null;
  shift_end_time: string | null;
  roster_status: string;
  publish_status: string;
  final_roster_status: string | null;
  branch_name: string | null;
  process_name: string | null;
}

interface ProcessListResponse { data: { id: string; name: string }[] }
interface PlanListResponse    { data: RosterPlan[] }
interface AssignmentListResponse { data: ActualAssignment[] }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function weekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function toYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  draft:          { label: "Draft",     cls: "bg-slate-100 text-slate-600" },
  published:      { label: "Published", cls: "bg-blue-100 text-blue-700"  },
  approved_final: { label: "Approved",  cls: "bg-emerald-100 text-emerald-700" },
};

const SHIFT_COLORS: Record<string, string> = {
  "Week Off": "bg-slate-100 text-slate-500",
  "default":  "bg-indigo-50 text-indigo-800 border border-indigo-200",
};

function ShiftCell({ assignment }: { assignment: ActualAssignment | undefined }) {
  if (!assignment) {
    return <td className="border border-slate-100 px-1 py-1 text-center text-slate-300 text-xs">—</td>;
  }
  const isWO  = assignment.roster_status === "Week Off";
  const cls   = isWO ? SHIFT_COLORS["Week Off"] : SHIFT_COLORS["default"];
  const label = isWO
    ? "WO"
    : (assignment.shift_code ?? assignment.shift_name ?? assignment.roster_status ?? "?");
  const title = isWO
    ? "Week Off"
    : [assignment.shift_name, assignment.shift_start_time, assignment.shift_end_time]
        .filter(Boolean).join(" | ");
  return (
    <td className="border border-slate-100 px-1 py-1 text-center" title={title}>
      <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>
        {label}
      </span>
      {assignment.final_roster_status === "acknowledged" && (
        <span className="block text-[9px] text-emerald-500 mt-0.5">✓ ack</span>
      )}
    </td>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function RosterWorkspace() {
  const qc = useQueryClient();
  const { roleKeys } = useWorkforceAccess();
  const canPublish = roleKeys.some((r) => ["admin", "wfm", "process_manager", "super_admin"].includes(r));

  const [weekOf, setWeekOf] = useState<Date>(() => weekStart(new Date()));
  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => toYMD(addDays(weekOf, i))), [weekOf]);
  const fromDate  = weekDates[0];
  const toDate    = weekDates[6];

  const [processId, setProcessId] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data: procResp } = useQuery<ProcessListResponse>({
    queryKey: ["processes"],
    queryFn: () => hrmsApi.get<ProcessListResponse>("/api/processes"),
    staleTime: 10 * 60 * 1000,
  });
  const processes: Process[] = (procResp?.data ?? []).map((p) => ({ id: p.id, name: p.name }));

  const { data: planResp, isLoading: plansLoading, refetch: refetchPlans } = useQuery<PlanListResponse>({
    queryKey: ["roster-plans", fromDate, toDate, processId],
    queryFn: () =>
      hrmsApi.get<PlanListResponse>(
        `/api/wfm/roster/plans?fromDate=${fromDate}&toDate=${toDate}${processId ? `&processId=${processId}` : ""}`
      ),
    staleTime: 2 * 60 * 1000,
  });
  const plans: RosterPlan[] = planResp?.data ?? [];

  const filteredPlans = useMemo(() => {
    if (statusFilter === "all") return plans;
    return plans.filter((p) => p.plan_status === statusFilter);
  }, [plans, statusFilter]);

  const planIds = filteredPlans.map((p) => p.id);
  const { data: assignResp, isLoading: assignLoading } = useQuery<AssignmentListResponse>({
    queryKey: ["roster-actual", fromDate, toDate, processId],
    queryFn: () =>
      hrmsApi.get<AssignmentListResponse>(
        `/api/wfm/roster/actual-assignments?fromDate=${fromDate}&toDate=${toDate}${processId ? `&processId=${processId}` : ""}&limit=2000`
      ),
    enabled: filteredPlans.length > 0,
    staleTime: 2 * 60 * 1000,
  });
  const assignments: ActualAssignment[] = assignResp?.data ?? [];

  type EmployeeRow = {
    employee_id: string;
    employee_code: string;
    full_name: string;
    branch_name: string | null;
    process_name: string | null;
    days: Record<string, ActualAssignment>;
  };
  const grid = useMemo<EmployeeRow[]>(() => {
    const map = new Map<string, EmployeeRow>();
    for (const a of assignments) {
      if (!map.has(a.employee_id)) {
        map.set(a.employee_id, {
          employee_id: a.employee_id,
          employee_code: a.employee_code,
          full_name: a.full_name,
          branch_name: a.branch_name,
          process_name: a.process_name,
          days: {},
        });
      }
      map.get(a.employee_id)!.days[a.work_date] = a;
    }
    return Array.from(map.values()).sort((a, b) =>
      a.employee_code.localeCompare(b.employee_code)
    );
  }, [assignments]);

  const publishMutation = useMutation({
    mutationFn: (planId: string) =>
      hrmsApi.patch<{ success: boolean }>(`/api/wfm/roster/plans/${planId}/publish`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["roster-plans"] });
      qc.invalidateQueries({ queryKey: ["roster-actual"] });
    },
  });

  const isLoading = plansLoading || assignLoading;

  const ackedCount   = assignments.filter((a) => a.final_roster_status === "acknowledged").length;
  const pendingCount = assignments.filter(
    (a) => a.publish_status === "published" && a.final_roster_status !== "acknowledged"
  ).length;

  return (
    <DashboardLayout>
      <div className="max-w-full mx-auto px-4 py-6 space-y-5">

        {/* Header */}
        <div className="rounded-2xl bg-gradient-to-br from-teal-600 to-cyan-800 text-white px-6 py-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Calendar className="h-6 w-6" />
                Roster Workspace
              </h1>
              <p className="text-teal-200 text-sm mt-0.5">
                Weekly shift assignment grid — manage, publish and track acknowledgements
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="bg-white/10 border-white/30 text-white hover:bg-white/20"
              onClick={() => { refetchPlans(); qc.invalidateQueries({ queryKey: ["roster-actual"] }); }}
            >
              <RefreshCw className="h-4 w-4 mr-1.5" /> Refresh
            </Button>
          </div>

          {/* Week navigation */}
          <div className="mt-4 flex items-center gap-3 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              className="bg-white/10 border-white/30 text-white hover:bg-white/20"
              onClick={() => setWeekOf((w) => addDays(w, -7))}
            >
              ← Prev Week
            </Button>
            <span className="text-sm font-medium text-white">
              {weekDates[0]} — {weekDates[6]}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="bg-white/10 border-white/30 text-white hover:bg-white/20"
              onClick={() => setWeekOf((w) => addDays(w, 7))}
            >
              Next Week →
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="bg-white/10 border-white/30 text-white hover:bg-white/20"
              onClick={() => setWeekOf(weekStart(new Date()))}
            >
              This Week
            </Button>
          </div>
        </div>

        {/* Summary tiles */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Plans",        val: plans.length,   color: "text-slate-700",   bg: "bg-slate-50 border-slate-200"     },
            { label: "Employees",    val: grid.length,    color: "text-teal-700",    bg: "bg-teal-50 border-teal-200"       },
            { label: "Acknowledged", val: ackedCount,     color: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200" },
            { label: "Pending Ack",  val: pendingCount,   color: "text-amber-700",   bg: "bg-amber-50 border-amber-200"     },
          ].map(({ label, val, color, bg }) => (
            <div key={label} className={`rounded-xl border ${bg} px-4 py-3`}>
              <div className={`text-2xl font-bold ${color}`}>{val}</div>
              <div className="text-sm text-slate-500 mt-0.5">{label}</div>
            </div>
          ))}
        </div>

        {/* Filters + Plan status tabs */}
        <div className="flex flex-wrap gap-3 items-center">
          {processes.length > 0 && (
            <Select value={processId || "__all__"} onValueChange={(v) => setProcessId(v === "__all__" ? "" : v)}>
              <SelectTrigger className="w-52">
                <SelectValue placeholder="All processes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All processes</SelectItem>
                {processes.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="flex rounded-lg border overflow-hidden text-sm">
            {(["all", "draft", "published", "approved_final"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 capitalize transition-colors ${
                  statusFilter === s
                    ? "bg-teal-600 text-white"
                    : "bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {s === "all" ? "All" : (STATUS_BADGE[s]?.label ?? s)}
              </button>
            ))}
          </div>
        </div>

        {/* Plan cards */}
        {filteredPlans.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {filteredPlans.map((plan) => {
              const badge = STATUS_BADGE[plan.plan_status] ?? { label: plan.plan_status, cls: "bg-slate-100 text-slate-600" };
              return (
                <div key={plan.id} className="flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm shadow-sm">
                  <span className="font-mono text-xs text-slate-400">{plan.id.substring(0, 8)}</span>
                  <span className="text-slate-600">{plan.from_date} → {plan.to_date}</span>
                  <Badge className={badge.cls}>{badge.label}</Badge>
                  {canPublish && plan.plan_status === "draft" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-xs border-teal-400 text-teal-700 hover:bg-teal-50"
                      disabled={publishMutation.isPending}
                      onClick={() => publishMutation.mutate(plan.id)}
                    >
                      <Send className="h-3 w-3 mr-1" />
                      Publish
                    </Button>
                  )}
                  {plan.plan_status === "approved_final" && (
                    <span className="flex items-center gap-1 text-xs text-slate-400">
                      <Lock className="h-3 w-3" /> Locked
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Weekly grid */}
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(8)].map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : grid.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 py-12 text-center text-slate-500">
            <Users className="h-10 w-10 mx-auto mb-3 text-slate-300" />
            <p className="font-medium">No roster assignments found for this week.</p>
            <p className="text-sm mt-1">
              {filteredPlans.length === 0
                ? "No plans exist for this week. Create a plan in Roster Planning first."
                : "No employees are assigned in the visible plans."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="bg-slate-50">
                  <th className="sticky left-0 z-10 bg-slate-50 border border-slate-200 px-3 py-2 text-left font-semibold text-slate-600 min-w-[160px]">
                    Employee
                  </th>
                  <th className="border border-slate-200 px-2 py-2 text-left font-semibold text-slate-500 min-w-[100px]">
                    Process
                  </th>
                  {weekDates.map((d, i) => (
                    <th key={d} className="border border-slate-200 px-2 py-2 text-center font-semibold text-slate-600 min-w-[70px]">
                      <div>{DAY_LABELS[i]}</div>
                      <div className="text-slate-400 font-normal">{d.substring(5)}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.map((emp) => (
                  <tr key={emp.employee_id} className="hover:bg-teal-50/30 transition-colors">
                    <td className="sticky left-0 z-10 bg-white border border-slate-100 px-3 py-1.5">
                      <div className="font-medium text-slate-800">{emp.full_name}</div>
                      <div className="text-slate-400">{emp.employee_code}</div>
                    </td>
                    <td className="border border-slate-100 px-2 py-1.5 text-slate-500">
                      {emp.process_name ?? <span className="text-slate-300">—</span>}
                    </td>
                    {weekDates.map((d) => (
                      <ShiftCell key={d} assignment={emp.days[d]} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pending ack warning */}
        {pendingCount > 0 && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
            <p>
              <span className="font-semibold">{pendingCount} assignments</span> are published but not yet acknowledged by employees.
              Employees can acknowledge via their <span className="font-medium">My Roster</span> page.
            </p>
          </div>
        )}

      </div>
    </DashboardLayout>
  );
}
