/**
 * Branch Cost-Centre Attendance — /payroll/readiness/cost-centres
 *
 * The branch-specific, cost-centre-granular attendance sign-off behind the Payroll Readiness
 * page's "Attendance Data Ready" item. Branch Payroll HR (payroll_hr) and the Branch WFM person
 * (wfm) open their branch, see every cost centre under it, drill into one to check each
 * employee's month, and finalize it. It then goes to the Branch Head, and from there to the HO
 * Payroll Head. After HO approval a late correction needs an unlock only the Payroll Head can
 * grant, and granting it sends the cost centre back through all three stages.
 *
 * ONE component for all three roles, deliberately: the Branch Head and the Payroll Head must see
 * exactly what the branch signed off on, in the same layout, or they are approving something
 * other than what was submitted. Only the action bar changes with role and stage.
 *
 * The day counts are read-only. A correction is made upstream in Regularization / Leave and the
 * grid then reflects it — there is no override box, because a number typed over the top of the
 * attendance engine is a number nothing else in payroll agrees with.
 */
import { useState, useMemo, useEffect } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Search,
  CheckCircle2,
  Clock,
  Lock,
  Unlock,
  Download,
  RefreshCw,
  AlertTriangle,
  History,
  ChevronRight,
  Building2,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { hrmsApi, getAuthToken } from "@/lib/hrmsApi";

// ─── Types ────────────────────────────────────────────────────────────────────

type CcStatus =
  | "unprocessed"
  | "hr_finalized"
  | "branch_head_approved"
  | "ho_approved"
  | "unlock_requested";

type CostCentreRow = {
  cost_centre_id: string;
  cost_centre_code: string | null;
  cost_centre_name: string;
  total_employees: number;
  status: CcStatus;
  cycle_no: number;
  finalization_id: string | null;
  hr_finalized_at: string | null;
  branch_head_approved_at: string | null;
  ho_approved_at: string | null;
  last_rejected_stage: string | null;
  last_rejected_reason: string | null;
  pending_unlock_request_id: string | null;
};

type EmployeeRow = {
  employee_id: string;
  employee_code: string | null;
  employee_name: string;
  emp_location: string;
  total_days: number;
  absent_days: number;
  present_days: number;
  od_days: number;
  half_days: number;
  leave_days: number;
  holiday_days: number;
  weekoff_days: number;
  sal_days: number;
};

type CcDetail = {
  month: string;
  branch_id: string;
  cost_centre_id: string;
  status: CcStatus;
  cycle_no: number;
  rows: EmployeeRow[];
  snapshot: EmployeeRow[];
  drifted_employee_codes: string[];
  finalization: Record<string, unknown> | null;
  pending_unlock_request_id: string | null;
};

type ApprovalEvent = {
  id: string;
  action: string;
  from_status: string | null;
  to_status: string;
  decision: string | null;
  actor_name: string | null;
  actor_role: string;
  remarks: string | null;
  created_at: string;
};

// ─── Status presentation ──────────────────────────────────────────────────────

const STATUS_META: Record<CcStatus, { label: string; className: string; step: number }> = {
  unprocessed:          { label: "UNPROCESSED",      className: "bg-slate-100 text-slate-700 border-slate-200", step: 0 },
  hr_finalized:         { label: "HR FINALIZED",     className: "bg-blue-50 text-blue-700 border-blue-200",     step: 1 },
  branch_head_approved: { label: "BRANCH APPROVED",  className: "bg-amber-50 text-amber-700 border-amber-200",  step: 2 },
  ho_approved:          { label: "HO APPROVED",      className: "bg-emerald-50 text-emerald-700 border-emerald-200", step: 3 },
  unlock_requested:     { label: "UNLOCK REQUESTED", className: "bg-rose-50 text-rose-700 border-rose-200",     step: 3 },
};

const STAGE_LABELS = ["Payroll HR", "Branch Head", "Payroll Head"];

function StatusBadge({ status }: { status: CcStatus }) {
  const meta = STATUS_META[status];
  return (
    <Badge variant="outline" className={`font-semibold tracking-wide ${meta.className}`}>
      {meta.label}
    </Badge>
  );
}

/** Where a cost centre sits in the three-stage chain, at a glance. */
function StageStepper({ status }: { status: CcStatus }) {
  const current = STATUS_META[status].step;
  return (
    <div className="flex items-center gap-1.5" aria-label={`Stage ${current} of 3`}>
      {STAGE_LABELS.map((label, i) => {
        const done = current > i;
        const active = current === i;
        return (
          <div key={label} className="flex items-center gap-1.5">
            <div
              className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors duration-200 ${
                done
                  ? "bg-emerald-100 text-emerald-800"
                  : active
                    ? "bg-blue-100 text-blue-800"
                    : "bg-slate-100 text-slate-500"
              }`}
            >
              {done ? <CheckCircle2 className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
              {label}
            </div>
            {i < STAGE_LABELS.length - 1 && <ChevronRight className="h-3 w-3 text-slate-300" />}
          </div>
        );
      })}
    </div>
  );
}

// ─── Month options ────────────────────────────────────────────────────────────

/**
 * A closed set, so it is a dropdown and never a text box: process_month is VARCHAR 'YYYY-MM' and
 * a typo silently addresses a month that does not exist rather than failing loudly.
 */
function useMonthOptions(count = 15) {
  return useMemo(() => {
    const out: Array<{ value: string; label: string }> = [];
    const now = new Date();
    for (let i = 0; i < count; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      out.push({
        value,
        label: d.toLocaleDateString("en-IN", { month: "long", year: "numeric" }),
      });
    }
    return out;
  }, [count]);
}

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BranchCostCentreAttendance() {
  const { roleKeys, scopes } = useWorkforceAccess();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const monthOptions = useMonthOptions();

  // Component state is the source of truth, seeded from the URL; the URL is then kept in sync for
  // deep-linking. Driving the selection straight off the search params instead looked tidier and
  // was wrong: the effect that auto-selects the first branch wrote the param, the write was
  // reverted on the next render, and branchId fell back to "" — which disables the query. The
  // screen showed "Select branch" and an empty table while the API had already returned its rows.
  const [month, setMonth] = useState<string>(params.get("month") ?? currentMonth());
  const [branchId, setBranchId] = useState<string>(params.get("branchId") ?? "");
  const [selectedCc, setSelectedCc] = useState<CostCentreRow | null>(null);

  const roles = roleKeys ?? [];
  const isHo = roles.some((r) => ["payroll_head", "super_admin", "admin", "payroll", "finance", "hr"].includes(r));
  const canFinalize = roles.some((r) => ["payroll_hr", "wfm", "payroll_branch", "super_admin"].includes(r));
  const canBranchApprove = roles.some((r) => ["branch_head", "super_admin"].includes(r));
  const canHoApprove = roles.some((r) => ["payroll_head", "super_admin"].includes(r));
  const canRequestUnlock = roles.some((r) =>
    ["payroll_hr", "wfm", "payroll_branch", "branch_head", "super_admin"].includes(r)
  );
  // Only the HO Payroll Head can grant an unlock — the whole point of the escalation.
  const canReviewUnlock = roles.some((r) => ["payroll_head", "super_admin"].includes(r));

  // Branch options: everything for HO, the caller's own assignment scopes otherwise — the same
  // rule BranchScopeOwnView uses, so this can only address a branch requireScopedRole allows.
  const scopedBranchIds = useMemo(
    () => Array.from(new Set((scopes ?? []).map((s) => s.branch_id).filter((b): b is string => !!b))),
    [scopes]
  );

  const branchesQuery = useQuery({
    queryKey: ["cc-attendance", "branches"],
    queryFn: () =>
      hrmsApi
        .get<any>("/api/org/branches?active_status=1")
        .then((d: any) => (Array.isArray(d) ? d : (d.data ?? []))),
    staleTime: 5 * 60_000,
  });

  const branchOptions = useMemo(() => {
    const all: Array<{ id: string; branch_name: string }> = branchesQuery.data ?? [];
    const visible = isHo ? all : all.filter((b) => scopedBranchIds.includes(b.id));
    return visible.map((b) => ({ value: b.id, label: b.branch_name }));
  }, [branchesQuery.data, isHo, scopedBranchIds]);

  // Auto-select the first branch the caller can see, once the list arrives.
  useEffect(() => {
    if (!branchId && branchOptions.length > 0) setBranchId(branchOptions[0].value);
  }, [branchOptions, branchId]);

  // Mirror the selection into the URL so the page can be linked and reloaded, without the URL
  // ever being what the queries read.
  useEffect(() => {
    if (!branchId) return;
    if (params.get("branchId") === branchId && params.get("month") === month) return;
    const next = new URLSearchParams(params);
    next.set("branchId", branchId);
    next.set("month", month);
    setParams(next, { replace: true });
    // params/setParams are deliberately omitted: including them re-runs this on every URL change
    // and reintroduces exactly the write-then-revert loop this replaced.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, month]);

  const listQuery = useQuery<{ data: CostCentreRow[] }>({
    queryKey: ["cc-attendance", "list", branchId, month],
    queryFn: () => hrmsApi.get(`/api/payroll/cc-attendance/${branchId}/cost-centres?month=${month}`),
    enabled: !!branchId,
    staleTime: 30_000,
  });

  const costCentres = listQuery.data?.data ?? [];
  const totals = useMemo(() => {
    const approved = costCentres.filter((c) => c.status === "ho_approved").length;
    return {
      approved,
      total: costCentres.length,
      employees: costCentres.reduce((sum, c) => sum + c.total_employees, 0),
      pct: costCentres.length ? Math.round((approved / costCentres.length) * 100) : 0,
    };
  }, [costCentres]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["cc-attendance"] });
  };

  const branchName = branchOptions.find((b) => b.value === branchId)?.label ?? "";

  return (
    <DashboardLayout>
      <div className="space-y-5 p-4 md:p-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <Link
              to="/payroll/readiness?scope=branch"
              className="inline-flex cursor-pointer items-center gap-1 text-sm text-slate-500 transition-colors duration-200 hover:text-slate-900"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back to Payroll Readiness
            </Link>
            <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
              <Building2 className="h-5 w-5 text-slate-400" />
              Cost-Centre Attendance Sign-Off
            </h1>
            <p className="text-sm text-slate-500">
              Verify each cost centre's attendance, finalize it, and route it through Branch Head
              and HO Payroll Head approval.
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-500">Branch</label>
              <Select
                value={branchId}
                onValueChange={(v) => {
                  setBranchId(v);
                  setSelectedCc(null);
                }}
              >
                <SelectTrigger className="w-[220px] cursor-pointer">
                  <SelectValue placeholder="Select branch" />
                </SelectTrigger>
                <SelectContent>
                  {branchOptions.map((b) => (
                    <SelectItem key={b.value} value={b.value} className="cursor-pointer">
                      {b.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-500">Payroll Month</label>
              <Select
                value={month}
                onValueChange={(v) => {
                  setMonth(v);
                  setSelectedCc(null);
                }}
              >
                <SelectTrigger className="w-[180px] cursor-pointer">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {monthOptions.map((m) => (
                    <SelectItem key={m.value} value={m.value} className="cursor-pointer">
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="cursor-pointer"
              onClick={() => listQuery.refetch()}
              disabled={listQuery.isFetching}
            >
              <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${listQuery.isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>

        {/* Summary strip */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <SummaryTile label="Cost Centres" value={String(totals.total)} icon={<Building2 className="h-4 w-4" />} />
          <SummaryTile label="Employees" value={String(totals.employees)} icon={<Users className="h-4 w-4" />} />
          <SummaryTile
            label="HO Approved"
            value={`${totals.approved} / ${totals.total}`}
            icon={<CheckCircle2 className="h-4 w-4" />}
            tone={totals.total > 0 && totals.approved === totals.total ? "good" : "neutral"}
          />
          <SummaryTile
            label="Month Progress"
            value={`${totals.pct}%`}
            icon={<Clock className="h-4 w-4" />}
            tone={totals.pct === 100 ? "good" : totals.pct > 0 ? "warn" : "neutral"}
          />
        </div>

        {/* Cost centre table */}
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-3 w-14">SNo</th>
                    <th className="px-4 py-3">Cost Centre</th>
                    <th className="px-4 py-3 w-32 text-center">Total Employee</th>
                    <th className="px-4 py-3 w-44">Status</th>
                    <th className="px-4 py-3 w-64">Stage</th>
                    <th className="px-4 py-3 w-20 text-center">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {listQuery.isLoading && (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                        Loading cost centres…
                      </td>
                    </tr>
                  )}
                  {!listQuery.isLoading && costCentres.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                        No cost centres with employees in this branch for {month}.
                      </td>
                    </tr>
                  )}
                  {costCentres.map((cc, i) => (
                    <tr
                      key={cc.cost_centre_id}
                      onClick={() => setSelectedCc(cc)}
                      className="cursor-pointer border-b transition-colors duration-150 hover:bg-slate-50"
                    >
                      <td className="px-4 py-3 text-slate-500">{i + 1}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{cc.cost_centre_name}</div>
                        {cc.cost_centre_code && (
                          <div className="text-xs text-slate-400">{cc.cost_centre_code}</div>
                        )}
                        {cc.last_rejected_reason && cc.status === "unprocessed" && (
                          <div className="mt-1 flex items-start gap-1 text-xs text-rose-600">
                            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                            Sent back: {cc.last_rejected_reason}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center font-semibold text-slate-700">
                        {cc.total_employees}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={cc.status} />
                        {cc.cycle_no > 1 && (
                          <div className="mt-1 text-[11px] text-slate-400">Pass {cc.cycle_no}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <StageStepper status={cc.status} />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Button
                          variant="outline"
                          size="sm"
                          className="cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedCc(cc);
                          }}
                          aria-label={`View ${cc.cost_centre_name}`}
                        >
                          <Search className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      {selectedCc && branchId && (
        <CostCentreDrawer
          key={`${selectedCc.cost_centre_id}-${month}`}
          costCentre={selectedCc}
          branchId={branchId}
          branchName={branchName}
          month={month}
          onClose={() => setSelectedCc(null)}
          onChanged={invalidate}
          caps={{ canFinalize, canBranchApprove, canHoApprove, canRequestUnlock, canReviewUnlock }}
        />
      )}
    </DashboardLayout>
  );
}

function SummaryTile({
  label,
  value,
  icon,
  tone = "neutral",
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone?: "neutral" | "good" | "warn";
}) {
  const toneClass =
    tone === "good" ? "text-emerald-600" : tone === "warn" ? "text-amber-600" : "text-slate-700";
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-4">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
          <div className={`mt-1 text-2xl font-bold ${toneClass}`}>{value}</div>
        </div>
        <div className="text-slate-300">{icon}</div>
      </CardContent>
    </Card>
  );
}

// ─── Drill-down drawer ────────────────────────────────────────────────────────

function CostCentreDrawer({
  costCentre,
  branchId,
  branchName,
  month,
  onClose,
  onChanged,
  caps,
}: {
  costCentre: CostCentreRow;
  branchId: string;
  branchName: string;
  month: string;
  onClose: () => void;
  onChanged: () => void;
  caps: {
    canFinalize: boolean;
    canBranchApprove: boolean;
    canHoApprove: boolean;
    canRequestUnlock: boolean;
    canReviewUnlock: boolean;
  };
}) {
  const ccId = costCentre.cost_centre_id;
  const base = `/api/payroll/cc-attendance/${branchId}/${encodeURIComponent(ccId)}`;

  const [search, setSearch] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [dialog, setDialog] = useState<null | "send_back" | "unlock" | "refuse_unlock">(null);
  const [reason, setReason] = useState("");

  const detailQuery = useQuery<{ data: CcDetail }>({
    queryKey: ["cc-attendance", "detail", branchId, ccId, month],
    queryFn: () => hrmsApi.get(`${base}/employees?month=${month}`),
    staleTime: 15_000,
  });

  const historyQuery = useQuery<{ data: { events: ApprovalEvent[] } }>({
    queryKey: ["cc-attendance", "history", branchId, ccId, month],
    queryFn: () => hrmsApi.get(`${base}/history?month=${month}`),
    enabled: showHistory,
  });

  const detail = detailQuery.data?.data;
  const status = detail?.status ?? costCentre.status;

  /**
   * Send-back reason, preferring the freshly fetched finalization over the list row.
   *
   * The list row is a snapshot taken when the drawer opened, so after sending a packet back
   * from inside the drawer it still says "not rejected" and the banner never appeared — the
   * row behind the drawer showed the reason while the drawer itself did not.
   */
  const rejection = {
    reason:
      (detail?.finalization?.last_rejected_reason as string | null | undefined) ??
      costCentre.last_rejected_reason,
    stage:
      (detail?.finalization?.last_rejected_stage as string | null | undefined) ??
      costCentre.last_rejected_stage,
  };
  const rows = detail?.rows ?? [];
  const drifted = detail?.drifted_employee_codes ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        (r.employee_code ?? "").toLowerCase().includes(q) ||
        r.employee_name.toLowerCase().includes(q)
    );
  }, [rows, search]);

  const act = useMutation({
    mutationFn: async (input: { path: string; body?: Record<string, unknown> }) =>
      hrmsApi.post(`${base}/${input.path}?month=${month}`, input.body ?? {}),
    onSuccess: () => {
      toast.success("Done");
      setDialog(null);
      setReason("");
      detailQuery.refetch();
      onChanged();
    },
    onError: (e: any) => toast.error(e?.message ?? "Action failed"),
  });

  /** The Payroll Head's decision on a pending unlock request — a different endpoint, keyed by
   *  request id rather than by cost centre, so it does not go through `act`. */
  const reviewUnlock = useMutation({
    mutationFn: async (input: { decision: "approve" | "reject"; notes?: string }) =>
      hrmsApi.post(
        `/api/payroll/cc-attendance/unlock-requests/${detail?.pending_unlock_request_id}/review`,
        input
      ),
    onSuccess: (_res, input) => {
      toast.success(input.decision === "approve" ? "Unlock granted" : "Unlock refused");
      setDialog(null);
      setReason("");
      detailQuery.refetch();
      onChanged();
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not record the decision"),
  });

  const busy = act.isPending || reviewUnlock.isPending;

  const downloadCsv = async () => {
    try {
      // getAuthToken() from hrmsApi, not a hand-read localStorage key: the token lives under
      // "hrms_access_token" (with a demo-session fallback), and reading the wrong key here
      // sent the request with a Bearer of "null" — the export 401'd every time while every
      // other call on the page succeeded.
      const token = getAuthToken();
      const res = await fetch(`${base}/export?month=${month}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cc-attendance-${ccId}-${month}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Export failed");
    }
  };

  return (
    <>
      <Sheet open onOpenChange={(v) => !v && onClose()}>
        <SheetContent side="right" className="flex w-full max-w-5xl flex-col p-0 sm:max-w-5xl">
          <SheetHeader className="border-b px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <SheetTitle className="truncate text-base">{costCentre.cost_centre_name}</SheetTitle>
                <SheetDescription className="text-xs">
                  {branchName} · {month} · {costCentre.total_employees} employees
                  {(detail?.cycle_no ?? 1) > 1 && ` · pass ${detail?.cycle_no}`}
                </SheetDescription>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <StatusBadge status={status} />
                <Button variant="ghost" size="sm" className="cursor-pointer" onClick={onClose}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="pt-2">
              <StageStepper status={status} />
            </div>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {/* Drift warning — the live data no longer matches what was finalized. */}
            {drifted.length > 0 && status !== "unprocessed" && (
              <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <div className="font-semibold">Attendance changed since this was finalized</div>
                  <div className="text-xs">
                    {drifted.length} employee{drifted.length === 1 ? "" : "s"} ({drifted.slice(0, 5).join(", ")}
                    {drifted.length > 5 ? "…" : ""}) now differ from the finalized figures. Send it back so
                    Payroll HR can finalize the corrected month.
                  </div>
                </div>
              </div>
            )}

            {rejection.reason && status === "unprocessed" && (
              <div className="mb-4 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <div className="font-semibold">
                    Sent back by {rejection.stage?.replace(/_/g, " ")}
                  </div>
                  <div className="text-xs">{rejection.reason}</div>
                </div>
              </div>
            )}

            <div className="mb-3 flex items-center justify-between gap-3">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search employee code or name…"
                className="h-9 max-w-xs"
              />
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="cursor-pointer"
                  onClick={() => setShowHistory((v) => !v)}
                >
                  <History className="mr-1.5 h-3.5 w-3.5" />
                  {showHistory ? "Hide" : "History"}
                </Button>
                <Button variant="outline" size="sm" className="cursor-pointer" onClick={downloadCsv}>
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  Export
                </Button>
              </div>
            </div>

            {showHistory && (
              <div className="mb-4 rounded-md border bg-slate-50 p-3">
                <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">
                  Approval Timeline
                </div>
                {historyQuery.isLoading && <div className="text-sm text-slate-400">Loading…</div>}
                {(historyQuery.data?.data.events ?? []).length === 0 && !historyQuery.isLoading && (
                  <div className="text-sm text-slate-400">None yet.</div>
                )}
                <ol className="space-y-2">
                  {(historyQuery.data?.data.events ?? []).map((ev) => (
                    <li key={ev.id} className="flex gap-2 text-sm">
                      <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
                      <div>
                        <span className="font-medium text-slate-800">
                          {ev.action.replace(/_/g, " ")}
                        </span>
                        <span className="text-slate-500">
                          {" "}
                          by {ev.actor_name ?? "unknown"} ({ev.actor_role}) ·{" "}
                          {new Date(ev.created_at).toLocaleString("en-IN")}
                        </span>
                        {ev.remarks && (
                          <div className="text-xs text-slate-500">“{ev.remarks}”</div>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {/* Employee day grid — read-only by design. */}
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-100">
                  <tr className="text-left text-xs font-bold uppercase tracking-wide text-slate-600">
                    <th className="px-2 py-2">SNo</th>
                    <th className="px-2 py-2">EmpCode</th>
                    <th className="px-2 py-2">EmpName</th>
                    <th className="px-2 py-2">EmpLocation</th>
                    <th className="px-2 py-2 text-center">TotalDays</th>
                    <th className="px-2 py-2 text-center">A</th>
                    <th className="px-2 py-2 text-center">P</th>
                    <th className="px-2 py-2 text-center">OD</th>
                    <th className="px-2 py-2 text-center">HD/DH/FTP</th>
                    <th className="px-2 py-2 text-center">L</th>
                    <th className="px-2 py-2 text-center">H</th>
                    <th className="px-2 py-2 text-center">W</th>
                    <th className="px-2 py-2 text-center">SalDays</th>
                  </tr>
                </thead>
                <tbody>
                  {detailQuery.isLoading && (
                    <tr>
                      <td colSpan={13} className="px-2 py-8 text-center text-slate-400">
                        Loading employees…
                      </td>
                    </tr>
                  )}
                  {!detailQuery.isLoading && filtered.length === 0 && (
                    <tr>
                      <td colSpan={13} className="px-2 py-8 text-center text-slate-400">
                        No employees match.
                      </td>
                    </tr>
                  )}
                  {filtered.map((r, i) => (
                    <tr key={r.employee_id} className="border-t hover:bg-slate-50">
                      <td className="px-2 py-1.5 text-slate-400">{i + 1}</td>
                      <td className="px-2 py-1.5 font-mono text-xs">{r.employee_code}</td>
                      <td className="px-2 py-1.5">{r.employee_name}</td>
                      <td className="px-2 py-1.5 text-slate-500">{r.emp_location}</td>
                      <td className="px-2 py-1.5 text-center">{r.total_days}</td>
                      <td className="px-2 py-1.5 text-center text-rose-600">{r.absent_days}</td>
                      <td className="px-2 py-1.5 text-center text-emerald-700">{r.present_days}</td>
                      <td className="px-2 py-1.5 text-center">{r.od_days}</td>
                      <td className="px-2 py-1.5 text-center">{r.half_days}</td>
                      <td className="px-2 py-1.5 text-center">{r.leave_days}</td>
                      <td className="px-2 py-1.5 text-center">{r.holiday_days}</td>
                      <td className="px-2 py-1.5 text-center">{r.weekoff_days}</td>
                      <td className="px-2 py-1.5 text-center font-semibold">{r.sal_days}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="mt-2 text-xs text-slate-400">
              These figures are computed from attendance records and cannot be edited here. To change
              them, resolve the employee's regularization or leave first — the grid updates
              automatically.
            </p>
          </div>

          {/* Sticky action bar — role and stage decide what is offered. */}
          <div className="flex flex-wrap items-center justify-end gap-2 border-t bg-white px-5 py-3">
            {status === "unprocessed" && caps.canFinalize && (
              <Button
                className="cursor-pointer"
                disabled={busy || rows.length === 0}
                onClick={() => act.mutate({ path: "finalize" })}
              >
                <CheckCircle2 className="mr-1.5 h-4 w-4" /> Finalize Attendance
              </Button>
            )}

            {status === "hr_finalized" && caps.canBranchApprove && (
              <>
                <Button
                  variant="outline"
                  className="cursor-pointer"
                  disabled={busy}
                  onClick={() => setDialog("send_back")}
                >
                  Send Back
                </Button>
                <Button
                  className="cursor-pointer"
                  disabled={busy}
                  onClick={() => act.mutate({ path: "branch-approve" })}
                >
                  <CheckCircle2 className="mr-1.5 h-4 w-4" /> Approve as Branch Head
                </Button>
              </>
            )}

            {status === "branch_head_approved" && caps.canHoApprove && (
              <>
                <Button
                  variant="outline"
                  className="cursor-pointer"
                  disabled={busy}
                  onClick={() => setDialog("send_back")}
                >
                  Send Back
                </Button>
                <Button
                  className="cursor-pointer"
                  disabled={busy}
                  onClick={() => act.mutate({ path: "ho-approve" })}
                >
                  <Lock className="mr-1.5 h-4 w-4" /> Give Final HO Approval
                </Button>
              </>
            )}

            {status === "ho_approved" && caps.canRequestUnlock && (
              <Button
                variant="outline"
                className="cursor-pointer"
                disabled={busy}
                onClick={() => setDialog("unlock")}
              >
                <Unlock className="mr-1.5 h-4 w-4" /> Request Unlock
              </Button>
            )}

            {status === "unlock_requested" && caps.canReviewUnlock && detail?.pending_unlock_request_id && (
              <>
                <span className="mr-auto text-sm text-rose-600">
                  Granting this reopens the cost centre — it must clear all three stages again.
                </span>
                <Button
                  variant="outline"
                  className="cursor-pointer"
                  disabled={busy}
                  onClick={() => setDialog("refuse_unlock")}
                >
                  Refuse
                </Button>
                <Button
                  className="cursor-pointer"
                  disabled={busy}
                  onClick={() => reviewUnlock.mutate({ decision: "approve" })}
                >
                  <Unlock className="mr-1.5 h-4 w-4" /> Grant Unlock
                </Button>
              </>
            )}

            {status === "unlock_requested" && !caps.canReviewUnlock && (
              <span className="text-sm text-rose-600">
                Unlock requested — awaiting the Payroll Head's decision.
              </span>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Reason dialogs — both actions refuse to proceed without one. */}
      <Dialog open={dialog !== null} onOpenChange={(v) => !v && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog === "unlock"
                ? "Request unlock"
                : dialog === "refuse_unlock"
                  ? "Refuse the unlock request"
                  : "Send back to Payroll HR"}
            </DialogTitle>
            <DialogDescription>
              {dialog === "unlock"
                ? "The Payroll Head must approve this. Granting it reopens the cost centre and it goes through all three approval stages again."
                : dialog === "refuse_unlock"
                  ? "The cost centre stays approved. Your reason is recorded on the request and visible to whoever raised it."
                  : "The cost centre returns to Payroll HR with your reason attached."}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={
              dialog === "unlock"
                ? "What correction is still pending? (at least 10 characters)"
                : dialog === "refuse_unlock"
                  ? "Why is the unlock being refused?"
                  : "What needs fixing before this can be approved?"
            }
            rows={4}
          />
          <DialogFooter>
            <Button variant="outline" className="cursor-pointer" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              className="cursor-pointer"
              disabled={
                busy || (dialog === "unlock" ? reason.trim().length < 10 : !reason.trim())
              }
              onClick={() => {
                if (dialog === "refuse_unlock") {
                  reviewUnlock.mutate({ decision: "reject", notes: reason });
                  return;
                }
                act.mutate(
                  dialog === "unlock"
                    ? { path: "request-unlock", body: { reason } }
                    : {
                        path: "send-back",
                        body: {
                          reason,
                          stage: status === "branch_head_approved" ? "ho" : "branch",
                        },
                      }
                );
              }}
            >
              {dialog === "unlock"
                ? "Submit request"
                : dialog === "refuse_unlock"
                  ? "Refuse unlock"
                  : "Send back"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
