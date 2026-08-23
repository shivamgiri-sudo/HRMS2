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
import { useWfmScopeFilter, filterByScope } from "@/hooks/useWfmScopeFilter";
import {
  Calendar,
  RefreshCw,
  Send,
  Lock,
  Users,
  AlertTriangle,
  Zap,
  CheckCircle2,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Process {
  id: string;
  name: string;
}

// Fields returned by GET /api/wfm/auto-roster/plans (listPlans JOIN plan_control)
interface RosterPlan {
  id: string;
  plan_name: string | null;
  process_id: string | null;
  branch_id: string | null;
  plan_status: string;
  from_date: string;
  to_date: string;
  created_at: string;
  // from wfm_roster_plan_control JOIN:
  approval_status: string | null;
  last_coverage_score: number | null;
  publish_lock_status: string | null;
}

// Fields returned by GET /api/wfm/auto-roster/plans/:id/assignments
interface AutoRosterAssignment {
  id: string;
  employee_id: string;
  employee_code: string;
  employee_name: string;        // auto-roster uses employee_name (not full_name)
  roster_date: string;          // auto-roster uses roster_date (not work_date)
  shift_code: string | null;
  shift_name: string | null;
  shift_start_time: string | null;
  shift_end_time: string | null;
  roster_status: string;
  publish_status: string;
  acknowledgement_status: string | null; // from wfm_roster_assignment_control
  branch_name: string | null;
  process_name: string | null;
}

interface ProcessListResponse { data: { id: string; name: string }[] }
interface PlanListResponse    { data: RosterPlan[] }
interface AssignmentResponse  { data: AutoRosterAssignment[] }

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

// approval_status lifecycle: draft → generated → submitted → approved → published
const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  draft:          { label: "Draft",      cls: "bg-slate-100 text-slate-600"   },
  generated:      { label: "Generated",  cls: "bg-sky-100 text-sky-700"       },
  submitted:      { label: "Submitted",  cls: "bg-amber-100 text-amber-700"   },
  approved:       { label: "Approved",   cls: "bg-emerald-100 text-emerald-700" },
  published:      { label: "Published",  cls: "bg-blue-100 text-blue-700"     },
  rejected:       { label: "Rejected",   cls: "bg-red-100 text-red-700"       },
};

const SHIFT_COLORS: Record<string, string> = {
  "Week Off": "bg-slate-100 text-slate-500",
  "default":  "bg-indigo-50 text-indigo-800 border border-indigo-200",
};

function ShiftCell({ assignment }: { assignment: AutoRosterAssignment | undefined }) {
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
      {assignment.acknowledgement_status === "acknowledged" && (
        <span className="block text-[9px] text-emerald-500 mt-0.5">✓ ack</span>
      )}
    </td>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function RosterWorkspace() {
  const qc = useQueryClient();
  const { roleKeys } = useWorkforceAccess();
  const { processIds: scopedProcessIds, hasAllAccess: hasAllProcessAccess, scopeDescription } = useWfmScopeFilter();

  const canGenerate = roleKeys.some((r) => ["admin", "wfm", "super_admin"].includes(r));
  const canApprove  = roleKeys.some((r) => ["process_manager", "admin", "super_admin"].includes(r));
  const canPublish  = roleKeys.some((r) => ["process_manager", "admin", "super_admin"].includes(r));

  const [weekOf, setWeekOf] = useState<Date>(() => weekStart(new Date()));
  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => toYMD(addDays(weekOf, i))), [weekOf]);
  const fromDate  = weekDates[0];
  const toDate    = weekDates[6];

  const [processId, setProcessId] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // ── Queries ──────────────────────────────────────────────────────────────

  const { data: procResp } = useQuery<ProcessListResponse>({
    queryKey: ["processes"],
    queryFn: () => hrmsApi.get<ProcessListResponse>("/api/processes"),
    staleTime: 10 * 60 * 1000,
  });
  const allProcesses: Process[] = (procResp?.data ?? []).map((p) => ({ id: p.id, name: p.name }));
  // Filter processes based on user's assigned scope (branch_head/process_manager/operations_manager)
  const processes: Process[] = filterByScope(allProcesses, scopedProcessIds, hasAllProcessAccess);

  // auto-roster namespace: snake_case query params, returns approval_status from plan_control JOIN
  const { data: planResp, isLoading: plansLoading, refetch: refetchPlans } = useQuery<PlanListResponse>({
    queryKey: ["roster-plans", fromDate, toDate, processId],
    queryFn: () =>
      hrmsApi.get<PlanListResponse>(
        `/api/wfm/auto-roster/plans?from_date=${fromDate}&to_date=${toDate}${processId ? `&process_id=${processId}` : ""}`
      ),
    staleTime: 2 * 60 * 1000,
  });
  const plans: RosterPlan[] = planResp?.data ?? [];

  const filteredPlans = useMemo(() => {
    if (statusFilter === "all") return plans;
    // Filter on approval_status (from plan_control), not plan_status
    return plans.filter((p) => (p.approval_status ?? p.plan_status) === statusFilter);
  }, [plans, statusFilter]);

  // Per-plan assignment fetch (auto-roster has per-plan endpoints, not a flat list)
  const { data: assignData, isLoading: assignLoading } = useQuery<AutoRosterAssignment[]>({
    queryKey: ["roster-actual", fromDate, toDate, processId, filteredPlans.map((p) => p.id).join(",")],
    queryFn: async () => {
      const results = await Promise.all(
        filteredPlans.slice(0, 10).map((p) =>
          hrmsApi.get<AssignmentResponse>(`/api/wfm/auto-roster/plans/${p.id}/assignments`)
            .then((r) => r.data ?? [])
            .catch(() => [] as AutoRosterAssignment[])
        )
      );
      return results.flat();
    },
    enabled: filteredPlans.length > 0,
    staleTime: 2 * 60 * 1000,
  });
  const assignments: AutoRosterAssignment[] = assignData ?? [];

  // ── Mutations ────────────────────────────────────────────────────────────

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["roster-plans"] });
    qc.invalidateQueries({ queryKey: ["roster-actual"] });
  };

  const generateMutation = useMutation({
    mutationFn: (planId: string) =>
      hrmsApi.post<{ success: boolean }>(`/api/wfm/auto-roster/plans/${planId}/generate`, {}),
    onSuccess: invalidate,
  });
  const submitMutation = useMutation({
    mutationFn: (planId: string) =>
      hrmsApi.post<{ success: boolean }>(`/api/wfm/auto-roster/plans/${planId}/submit`, {}),
    onSuccess: invalidate,
  });
  const approveMutation = useMutation({
    mutationFn: (planId: string) =>
      hrmsApi.post<{ success: boolean }>(`/api/wfm/auto-roster/plans/${planId}/approve`, {}),
    onSuccess: invalidate,
  });
  const publishMutation = useMutation({
    mutationFn: (planId: string) =>
      hrmsApi.post<{ success: boolean }>(`/api/wfm/auto-roster/plans/${planId}/publish`, {}),
    onSuccess: invalidate,
  });

  const anyPending =
    generateMutation.isPending || submitMutation.isPending ||
    approveMutation.isPending  || publishMutation.isPending;

  // ── Grid builder ─────────────────────────────────────────────────────────

  type EmployeeRow = {
    employee_id: string;
    employee_code: string;
    employee_name: string;
    branch_name: string | null;
    process_name: string | null;
    days: Record<string, AutoRosterAssignment>;
  };

  const grid = useMemo<EmployeeRow[]>(() => {
    const map = new Map<string, EmployeeRow>();
    for (const a of assignments) {
      if (!map.has(a.employee_id)) {
        map.set(a.employee_id, {
          employee_id: a.employee_id,
          employee_code: a.employee_code,
          employee_name: a.employee_name,
          branch_name: a.branch_name,
          process_name: a.process_name,
          days: {},
        });
      }
      map.get(a.employee_id)!.days[a.roster_date] = a;
    }
    return Array.from(map.values()).sort((a, b) =>
      a.employee_code.localeCompare(b.employee_code)
    );
  }, [assignments]);

  const ackedCount   = assignments.filter((a) => a.acknowledgement_status === "acknowledged").length;
  const pendingCount = assignments.filter(
    (a) => a.publish_status === "published" && a.acknowledgement_status !== "acknowledged"
  ).length;

  const isLoading = plansLoading || assignLoading;

  // ── Render ────────────────────────────────────────────────────────────────

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
                Weekly shift assignment grid — generate, approve, publish and track acknowledgements
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

        {/* Filters + status tabs */}
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
            {(["all", "draft", "generated", "submitted", "approved", "published"] as const).map((s) => (
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
              const status = plan.approval_status ?? plan.plan_status;
              const badge = STATUS_BADGE[status] ?? { label: status, cls: "bg-slate-100 text-slate-600" };
              const isLocked = plan.publish_lock_status === "locked" || status === "published";

              return (
                <div key={plan.id} className="flex flex-wrap items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm shadow-sm">
                  <span className="font-mono text-xs text-slate-400">{plan.id.substring(0, 8)}</span>
                  {plan.plan_name && <span className="text-slate-700 font-medium">{plan.plan_name}</span>}
                  <span className="text-slate-500">{plan.from_date} → {plan.to_date}</span>
                  <Badge className={badge.cls}>{badge.label}</Badge>
                  {plan.last_coverage_score !== null && (
                    <Badge className={plan.last_coverage_score >= 80 ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-amber-50 text-amber-700 border border-amber-200"}>
                      {plan.last_coverage_score}% cov
                    </Badge>
                  )}

                  {/* Generate: draft plans */}
                  {canGenerate && status === "draft" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-xs border-sky-400 text-sky-700 hover:bg-sky-50"
                      disabled={anyPending}
                      onClick={() => generateMutation.mutate(plan.id)}
                    >
                      <Zap className="h-3 w-3 mr-1" />
                      Generate
                    </Button>
                  )}

                  {/* Submit: generated plans */}
                  {canGenerate && status === "generated" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-xs border-amber-400 text-amber-700 hover:bg-amber-50"
                      disabled={anyPending}
                      onClick={() => submitMutation.mutate(plan.id)}
                    >
                      <Send className="h-3 w-3 mr-1" />
                      Submit
                    </Button>
                  )}

                  {/* Approve: submitted plans */}
                  {canApprove && status === "submitted" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-xs border-emerald-400 text-emerald-700 hover:bg-emerald-50"
                      disabled={anyPending}
                      onClick={() => approveMutation.mutate(plan.id)}
                    >
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      Approve
                    </Button>
                  )}

                  {/* Publish: approved plans */}
                  {canPublish && status === "approved" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-xs border-teal-400 text-teal-700 hover:bg-teal-50"
                      disabled={anyPending}
                      onClick={() => publishMutation.mutate(plan.id)}
                    >
                      <Send className="h-3 w-3 mr-1" />
                      Publish + Lock
                    </Button>
                  )}

                  {isLocked && (
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
                ? "No plans exist for this week. Use Roster Pipeline to create and generate one."
                : "Generate a draft in the plan card above, or check the process filter."}
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
                      <div className="font-medium text-slate-800">{emp.employee_name}</div>
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
