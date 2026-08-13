import React, { useState, useEffect } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import WorkforcePageGate from "@/components/security/WorkforcePageGate";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Collapsible, CollapsibleTrigger, CollapsibleContent,
} from "@/components/ui/collapsible";
import {
  CheckCircle2, XCircle, AlertCircle, Clock, ChevronDown, ChevronRight,
  RefreshCw, Download, Bell, Layers, Building2, Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * From payrollGovernanceService.readiness() (payroll-governance.service.ts) — the
 * comprehensive engine that actually gates payroll calculation (409s
 * POST /runs/:id/calculate on any blocker), covering attendance-finalized,
 * missing-punch, attendance-error, leave-sync, PAN/UAN, salary-structure and
 * statutory-config checks this page's own per-process checklist does not.
 * Org-wide for the run, not attributable to an individual branch/process card
 * (see the backend helper's comment in payroll-process-readiness.routes.ts) —
 * surfaced here as read-only, informational: does not affect readiness_score/status.
 */
type OrgWideGovernance =
  | { status: "not_created" }
  | { status: "error"; message: string }
  | {
      status: "checked";
      runId: string;
      canCalculate: boolean;
      blockers: number;
      warnings: number;
      issues: Array<{ code: string; severity: string; count: number; message: string }>;
    };

/**
 * From GET /api/payroll/readiness-categories/month/:month
 * (payroll-readiness-categories.service.ts) — see the identical type doc in
 * BranchPayrollReadiness.tsx. Kept in sync deliberately: both named readiness
 * pages must show the same canonical payment-readiness verdict, not independent
 * interpretations of it.
 */
type PaymentReadinessCategories =
  | { status: "not_created" }
  | { status: "error"; message: string }
  | {
      status: "checked";
      canPay: boolean;
      canPayBlockedBy: string[];
      evaluatedAt: string;
      governanceVersion: string;
      summary: { p0: number; p1: number; p2: number; failed: number; checkErrors: number; sourceMissing: number };
      layers: Array<{ layer: string; state: string; checks: number; failed: number; p0: number; p1: number; affectedEmployees: number }>;
      checks: Array<{ code: string; layer: string; state: string; severity: string; affectedEmployees: number; message: string }>;
    };

interface ProcessReadiness {
  branch_id: string;
  branch_name: string;
  process_month: string;
  process_id: string;
  process_name: string;
  attendance_frozen: number;
  attendance_frozen_at: string | null;
  attendance_data_ready: number;
  attendance_data_ready_at: string | null;
  attendance_data_ready_by: string | null;
  incentives_status: "not_uploaded" | "uploaded" | "approved";
  custom_deductions_uploaded: number;
  overtime_entered: number;
  bank_details_pct: number;
  uan_complete_pct: number;
  noc_resolved: number;
  holiday_work_approved: number;
  branch_head_signoff: number;
  branch_head_signoff_at: string | null;
  process_manager_signoff: number;
  process_manager_signoff_at: string | null;
  process_manager_signoff_by: string | null;
  process_manager_remarks: string | null;
  ho_override_ready: number;
  ho_override_by: string | null;
  ho_override_at: string | null;
  ho_override_reason: string | null;
  salary_verification_done: number;
  salary_verification_at: string | null;
  salary_verification_by: string | null;
  readiness_score: number;
  readiness_status: "not_started" | "in_progress" | "ready" | "blocked";
  employee_count: number;
  employee_count_active: number;
  projected_gross: number | null;
  projected_net: number | null;
  projection_computed_at: string | null;
}

interface BranchGroup {
  branch_id: string;
  branch_name: string;
  processes: ProcessReadiness[];
  stats: { total: number; ready: number; avg_score: number };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function currentMonth(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
}

function fmtDate(v: string | null) {
  if (!v) return "—";
  return new Date(v.replace(" ", "T")).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function fmtMoney(v: number | null) {
  if (v == null) return "—";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v);
}

const STATUS_CONFIG = {
  ready:       { label: "Ready",       color: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  in_progress: { label: "In Progress", color: "bg-amber-100 text-amber-800 border-amber-200" },
  blocked:     { label: "Blocked",     color: "bg-rose-100 text-rose-800 border-rose-200" },
  not_started: { label: "Not Started", color: "bg-slate-100 text-slate-700 border-slate-200" },
};

function StatusBadge({ status }: { status: ProcessReadiness["readiness_status"] }) {
  const { label, color } = STATUS_CONFIG[status] ?? STATUS_CONFIG.not_started;
  return <Badge className={cn("border text-xs font-medium", color)}>{label}</Badge>;
}

function ScoreCircle({ score }: { score: number }) {
  const color = score >= 80 ? "text-emerald-600" : score >= 50 ? "text-amber-600" : "text-rose-600";
  return (
    <div className={cn("text-2xl font-bold tabular-nums", color)}>
      {score}%
    </div>
  );
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

async function apiFetch(url: string, opts?: RequestInit) {
  const token = localStorage.getItem("hrms_token");
  const res = await fetch(url, {
    ...opts,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...opts?.headers },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.message ?? "Request failed");
  return json;
}

// ---------------------------------------------------------------------------
// SignOffDialog (process manager)
// ---------------------------------------------------------------------------

function ProcessSignOffDialog({
  open, onClose, branchId, processId, month,
}: {
  open: boolean; onClose: () => void; branchId: string; processId: string; month: string;
}) {
  const qc = useQueryClient();
  const [remarks, setRemarks] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/payroll/process-readiness/${branchId}/${processId}/signoff`, {
        method: "POST",
        body: JSON.stringify({ month, remarks: remarks.trim() }),
      }),
    onSuccess: () => {
      toast.success("Process sign-off recorded");
      qc.invalidateQueries({ queryKey: ["process-readiness"] });
      setRemarks("");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Process Manager Sign-Off</DialogTitle>
          <DialogDescription>
            Confirm all payroll inputs are complete for this process. This notifies the Payroll Head.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          placeholder="Remarks (required) — confirm all inputs are complete"
          rows={3}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!remarks.trim() || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "Submitting…" : "Confirm Sign-Off"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// HOOverrideDialog
// ---------------------------------------------------------------------------

function HOOverrideDialog({
  open, onClose, branchId, processId, month,
}: {
  open: boolean; onClose: () => void; branchId: string; processId: string; month: string;
}) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/payroll/process-readiness/${branchId}/${processId}/ho-override`, {
        method: "POST",
        body: JSON.stringify({ month, reason: reason.trim() }),
      }),
    onSuccess: () => {
      toast.success("HO override applied");
      qc.invalidateQueries({ queryKey: ["process-readiness"] });
      setReason(""); setConfirmed(false); onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { setConfirmed(false); onClose(); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>HO Override — Force Ready</DialogTitle>
          <DialogDescription>
            This bypasses all checklist requirements. Provide a reason for the audit trail.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Override reason (required)"
          rows={3}
        />
        {!confirmed ? (
          <Button
            variant="destructive"
            disabled={!reason.trim()}
            onClick={() => setConfirmed(true)}
          >
            I understand — continue
          </Button>
        ) : (
          <DialogFooter>
            <Button variant="outline" onClick={() => { setConfirmed(false); onClose(); }}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending ? "Applying…" : "Apply Override"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// ChecklistToggle
// ---------------------------------------------------------------------------

function ChecklistToggle({
  label, checked, onToggle, disabled = false,
}: {
  label: string; checked: boolean; onToggle: (v: number) => void; disabled?: boolean;
}) {
  const [pendingUndo, setPendingUndo] = useState(false);

  const handleClick = () => {
    if (checked && !pendingUndo) {
      setPendingUndo(true);
      return;
    }
    setPendingUndo(false);
    onToggle(checked ? 0 : 1);
  };

  return (
    <div className="flex items-center justify-between gap-2 py-2 border-b last:border-0">
      <div className="flex items-center gap-2 text-sm">
        {checked
          ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
          : <Clock className="h-4 w-4 text-slate-400 shrink-0" />}
        <span className={checked ? "text-slate-700" : "text-slate-500"}>{label}</span>
      </div>
      {!disabled && (
        pendingUndo ? (
          <div className="flex gap-1">
            <Button size="sm" variant="destructive" className="h-6 px-2 text-xs" onClick={handleClick}>
              Undo
            </Button>
            <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => setPendingUndo(false)}>
              Keep
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            variant={checked ? "outline" : "default"}
            className="h-6 px-2 text-xs"
            onClick={handleClick}
          >
            {checked ? "Mark Incomplete" : "Mark Done"}
          </Button>
        )
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// StepItem — collapsible step in the guided stepper
// ---------------------------------------------------------------------------

function StepItem({
  number,
  title,
  done,
  locked = false,
  doneAt,
  doneBy,
  children,
}: {
  number: number;
  title: string;
  done: boolean;
  locked?: boolean;
  doneAt?: string | null;
  doneBy?: string | null;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(!done && !locked);

  return (
    <div
      className={cn(
        "rounded-xl border transition-colors",
        done
          ? "border-emerald-200 bg-emerald-50/40"
          : locked
          ? "border-slate-200 bg-slate-50/60 opacity-60"
          : "border-amber-200 bg-white"
      )}
    >
      <button
        type="button"
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left"
        onClick={() => !locked && setExpanded((v) => !v)}
        disabled={locked}
      >
        {/* Step number / status indicator */}
        <span
          className={cn(
            "flex-shrink-0 h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-bold",
            done
              ? "bg-emerald-500 text-white"
              : locked
              ? "bg-slate-300 text-slate-500"
              : "bg-amber-500 text-white"
          )}
        >
          {done ? "✓" : number}
        </span>

        <div className="min-w-0 flex-1">
          <span
            className={cn(
              "text-sm font-semibold leading-tight",
              done ? "text-emerald-800" : locked ? "text-slate-400" : "text-slate-800"
            )}
          >
            {title}
          </span>
          {done && (doneAt || doneBy) && (
            <p className="text-[10px] text-emerald-600 mt-0.5">
              {doneAt ? `Done ${fmtDate(doneAt)}` : ""}
              {doneBy ? ` by ${doneBy}` : ""}
            </p>
          )}
          {locked && (
            <p className="text-[10px] text-slate-400 mt-0.5">Complete previous step first</p>
          )}
        </div>

        {!locked && (
          <ChevronDown
            className={cn(
              "h-4 w-4 flex-shrink-0 text-slate-400 transition-transform",
              expanded && "rotate-180"
            )}
          />
        )}
      </button>

      {expanded && !locked && (
        <div className="px-4 pb-3 pt-0 space-y-2">
          {children}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProcessDetailDrawer — full checklist + actions for one process
// ---------------------------------------------------------------------------

function ProcessDetailDrawer({
  process, month, open, onClose, roleKeys,
}: {
  process: ProcessReadiness | null;
  month: string;
  open: boolean;
  onClose: () => void;
  roleKeys: string[];
}) {
  const qc = useQueryClient();
  const [signOffOpen, setSignOffOpen] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);

  const isWFM = roleKeys.some(r => ["wfm", "branch_head", "payroll_branch"].includes(r));
  const isPM  = roleKeys.some(r => ["process_manager", "branch_head"].includes(r));
  const isHO  = roleKeys.some(r => ["payroll_head", "super_admin"].includes(r));

  const checklistMutation = useMutation({
    mutationFn: ({ item, value }: { item: string; value: number }) =>
      apiFetch(`/api/payroll/process-readiness/${process!.branch_id}/${process!.process_id}/checklist`, {
        method: "POST",
        body: JSON.stringify({ month, item, value }),
      }),
    onSuccess: () => {
      toast.success("Updated");
      qc.invalidateQueries({ queryKey: ["process-readiness"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const freezeRequestMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/payroll/process-readiness/${process!.branch_id}/${process!.process_id}/request-freeze`, {
        method: "POST",
        body: JSON.stringify({ month }),
      }),
    onSuccess: () => toast.success("Freeze request sent to Payroll Head"),
    onError: (e: Error) => toast.error(e.message),
  });

  if (!process) return null;

  const canToggleAttendance = isWFM;
  const canToggleOther = isPM || isWFM;
  const canSignOff = isPM && process.attendance_frozen === 1 && process.salary_verification_done === 1 && process.process_manager_signoff === 0;

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent className="w-full sm:w-[460px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-indigo-500" />
            {process.process_name}
          </SheetTitle>
          <SheetDescription>{process.branch_name} · {month}</SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          {/* Score + Status */}
          <div className="flex items-center justify-between">
            <div>
              <StatusBadge status={process.readiness_status} />
              {process.ho_override_ready === 1 && (
                <Badge className="ml-2 bg-purple-100 text-purple-800 border-purple-200 border text-xs">
                  Overridden ✓
                </Badge>
              )}
            </div>
            <ScoreCircle score={process.readiness_score} />
          </div>
          <Progress value={process.readiness_score} className="h-2" />

          {/* Employee projection */}
          <div className="rounded-lg bg-slate-50 p-3 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-slate-500">Active Employees</span>
              <span className="font-medium">{process.employee_count_active ?? process.employee_count}</span>
            </div>
            {process.projected_gross != null && (
              <div className="flex justify-between">
                <span className="text-slate-500">Est. Gross</span>
                <span className="font-medium">{fmtMoney(process.projected_gross)}</span>
              </div>
            )}
          </div>

          {/* ── Guided Stepper ── */}
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
              Payroll Prep Steps
            </p>

            {/* Step 1 — Verify Attendance Data */}
            <StepItem
              number={1}
              title="Verify Attendance Data"
              done={process.attendance_data_ready === 1}
              locked={false}
            >
              <p className="text-xs text-slate-500">
                Confirm all punch logs, regularisations, and attendance exceptions for this
                process have been reviewed and resolved for the month.
              </p>
              <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
                <Link to="/attendance/disputes" className="text-xs font-medium text-blue-600 hover:underline">
                  → Disputes
                </Link>
              </div>
              {canToggleAttendance && process.attendance_data_ready === 0 && (
                <Button
                  size="sm"
                  className="mt-3 w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                  disabled={checklistMutation.isPending}
                  onClick={() => checklistMutation.mutate({ item: "attendance_data_ready", value: 1 })}
                >
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                  Mark Attendance Data Ready
                </Button>
              )}
              {canToggleAttendance && process.attendance_data_ready === 1 && (
                <button
                  type="button"
                  className="mt-1 text-xs text-slate-400 hover:text-slate-600"
                  disabled={checklistMutation.isPending}
                  onClick={() => checklistMutation.mutate({ item: "attendance_data_ready", value: 0 })}
                >
                  Undo
                </button>
              )}
            </StepItem>

            {/* Step 2 — Request Attendance Freeze */}
            <StepItem
              number={2}
              title="Request Attendance Freeze"
              done={process.attendance_frozen === 1}
              locked={process.attendance_data_ready === 0}
            >
              <p className="text-xs text-slate-500">
                Signal to the Payroll Head that your attendance data is final. They will freeze it
                before salary calculation begins.
              </p>
              {process.attendance_frozen === 1 ? (
                <p className="mt-1.5 text-xs text-emerald-700 font-medium">
                  ✓ Frozen{process.attendance_frozen_at ? ` on ${fmtDate(process.attendance_frozen_at)}` : ""}
                </p>
              ) : isWFM ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3 w-full border-amber-300 text-amber-800 hover:bg-amber-50"
                  disabled={freezeRequestMutation.isPending || process.attendance_data_ready === 0}
                  onClick={() => freezeRequestMutation.mutate()}
                >
                  <Bell className="h-3.5 w-3.5 mr-1.5" />
                  {freezeRequestMutation.isPending ? "Requesting…" : "Request Attendance Freeze"}
                </Button>
              ) : (
                <p className="mt-1.5 text-xs text-slate-400 italic">
                  Awaiting Payroll Head to freeze attendance
                </p>
              )}
            </StepItem>

            {/* Step 3 — Custom Deductions */}
            <StepItem
              number={3}
              title="Upload Custom Deductions"
              done={process.custom_deductions_uploaded === 1}
              locked={false}
            >
              <p className="text-xs text-slate-500">
                Upload loan recoveries, salary advances, or penalty deductions for employees in
                this process.
              </p>
              <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
                <Link to="/payroll/loans" className="text-xs font-medium text-blue-600 hover:underline">
                  → Loan Management
                </Link>
              </div>
              {canToggleOther && process.custom_deductions_uploaded === 0 && (
                <Button
                  size="sm"
                  className="mt-3 w-full bg-blue-600 hover:bg-blue-700 text-white"
                  disabled={checklistMutation.isPending}
                  onClick={() => checklistMutation.mutate({ item: "custom_deductions_uploaded", value: 1 })}
                >
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                  Mark Custom Deductions Done
                </Button>
              )}
              {canToggleOther && process.custom_deductions_uploaded === 1 && (
                <button
                  type="button"
                  className="mt-1 text-xs text-slate-400 hover:text-slate-600"
                  disabled={checklistMutation.isPending}
                  onClick={() => checklistMutation.mutate({ item: "custom_deductions_uploaded", value: 0 })}
                >
                  Undo
                </button>
              )}
            </StepItem>

            {/* Step 4 — Overtime */}
            <StepItem
              number={4}
              title="Enter Overtime"
              done={process.overtime_entered === 1}
              locked={false}
            >
              <p className="text-xs text-slate-500">
                Enter approved overtime hours for all employees in this process for the month.
              </p>
              {canToggleOther && process.overtime_entered === 0 && (
                <Button
                  size="sm"
                  className="mt-3 w-full bg-indigo-600 hover:bg-indigo-700 text-white"
                  disabled={checklistMutation.isPending}
                  onClick={() => checklistMutation.mutate({ item: "overtime_entered", value: 1 })}
                >
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                  Mark Overtime Done
                </Button>
              )}
              {canToggleOther && process.overtime_entered === 1 && (
                <button
                  type="button"
                  className="mt-1 text-xs text-slate-400 hover:text-slate-600"
                  disabled={checklistMutation.isPending}
                  onClick={() => checklistMutation.mutate({ item: "overtime_entered", value: 0 })}
                >
                  Undo
                </button>
              )}
            </StepItem>

            {/* Step 5 — Compliance checks (read-only) */}
            <StepItem
              number={5}
              title="Compliance Checks"
              done={
                process.bank_details_pct >= 95 &&
                process.uan_complete_pct >= 95 &&
                process.noc_resolved &&
                process.holiday_work_approved &&
                process.incentives_status === "approved"
              }
              locked={false}
            >
              <div className="space-y-1.5 text-xs">
                {[
                  { label: "Bank Details", value: `${process.bank_details_pct}%`, ok: process.bank_details_pct >= 95 },
                  { label: "UAN / PF",     value: `${process.uan_complete_pct}%`, ok: process.uan_complete_pct >= 95 },
                  { label: "NOC Resolved", value: process.noc_resolved ? "Yes" : "No", ok: !!process.noc_resolved },
                  { label: "Holiday Work", value: process.holiday_work_approved ? "Approved" : "Pending", ok: !!process.holiday_work_approved },
                  { label: "Incentives",   value: process.incentives_status.replace("_", " "), ok: process.incentives_status === "approved" },
                ].map(({ label, value, ok }) => (
                  <div key={label} className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      {ok
                        ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                        : <AlertCircle className="h-3.5 w-3.5 text-amber-400 shrink-0" />}
                      <span className={ok ? "text-slate-600" : "text-slate-500"}>{label}</span>
                    </div>
                    <span className={cn("font-medium tabular-nums", ok ? "text-emerald-700" : "text-amber-700")}>
                      {value}
                    </span>
                  </div>
                ))}
              </div>
            </StepItem>

            {/* Step 6 — Salary Verification */}
            <StepItem
              number={6}
              title="Salary Verification"
              done={process.salary_verification_done === 1}
              locked={process.attendance_frozen === 0}
              doneAt={process.salary_verification_at ?? undefined}
              doneBy={process.salary_verification_by ?? undefined}
            >
              <p className="text-xs text-slate-500">
                Review each employee's estimated salary breakdown, flag discrepancies to
                Payroll Head, and mark all clean rows verified before sign-off.
              </p>
              <div className="mt-2">
                <Link
                  to={`/payroll/salary-verification?processId=${process.process_id}&month=${month}`}
                  className="inline-flex items-center gap-1 text-xs font-medium text-violet-600 hover:underline"
                >
                  <ChevronRight className="h-3 w-3" />
                  Open Salary Verification Register
                </Link>
              </div>
            </StepItem>
          </div>

          {/* Sign-off status */}
          <div className="rounded-lg border p-3 space-y-2 text-sm">
            <p className="text-xs font-semibold text-slate-500 uppercase">Sign-Off Status</p>
            <div className="flex items-center justify-between">
              <span className="text-slate-600">Process Manager</span>
              {process.process_manager_signoff
                ? <span className="text-emerald-600 font-medium">✓ {fmtDate(process.process_manager_signoff_at)}</span>
                : <span className="text-slate-400">Pending</span>}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-600">Branch Head</span>
              {process.branch_head_signoff
                ? <span className="text-emerald-600 font-medium">✓</span>
                : <span className="text-slate-400">Pending</span>}
            </div>
            {process.process_manager_remarks && (
              <p className="text-xs text-slate-500 italic">"{process.process_manager_remarks}"</p>
            )}
          </div>

          {/* HO override info */}
          {process.ho_override_ready === 1 && (
            <div className="rounded-lg bg-purple-50 border border-purple-200 p-3 text-xs space-y-1">
              <p className="font-semibold text-purple-700">HO Override Applied</p>
              <p className="text-purple-600">On: {fmtDate(process.ho_override_at)}</p>
              {process.ho_override_reason && <p className="text-purple-600">"{process.ho_override_reason}"</p>}
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col gap-2 pt-1">
            {canSignOff && (
              <Button onClick={() => setSignOffOpen(true)} className="w-full">
                Process Manager Sign-Off
              </Button>
            )}
            {isHO && process.readiness_status !== "ready" && !process.ho_override_ready && (
              <Button variant="outline" onClick={() => setOverrideOpen(true)} className="w-full border-rose-300 text-rose-700 hover:bg-rose-50">
                HO Override — Force Ready
              </Button>
            )}
          </div>
        </div>
      </SheetContent>

      <ProcessSignOffDialog
        open={signOffOpen}
        onClose={() => setSignOffOpen(false)}
        branchId={process.branch_id}
        processId={process.process_id}
        month={month}
      />
      <HOOverrideDialog
        open={overrideOpen}
        onClose={() => setOverrideOpen(false)}
        branchId={process.branch_id}
        processId={process.process_id}
        month={month}
      />
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// ProcessCard — compact card in the grid
// ---------------------------------------------------------------------------

function ProcessCard({
  process, onClick,
}: {
  process: ProcessReadiness; onClick: () => void;
}) {
  const checks = [
    process.attendance_data_ready,
    process.attendance_frozen,
    process.incentives_status === "approved" ? 1 : 0,
    process.custom_deductions_uploaded,
    process.overtime_entered,
    process.bank_details_pct >= 95 ? 1 : 0,
    process.uan_complete_pct >= 95 ? 1 : 0,
    process.noc_resolved,
    process.holiday_work_approved,
  ];
  const doneCount = checks.filter(Boolean).length;

  return (
    <Card
      className="cursor-pointer hover:shadow-md transition-shadow border-l-4"
      style={{
        borderLeftColor:
          process.readiness_status === "ready" ? "#10b981" :
          process.readiness_status === "in_progress" ? "#f59e0b" :
          process.readiness_status === "blocked" ? "#f43f5e" : "#94a3b8",
      }}
      onClick={onClick}
    >
      <CardContent className="p-3 space-y-2">
        <div className="flex items-start justify-between gap-1">
          <p className="text-sm font-semibold leading-tight text-slate-800 line-clamp-2">
            {process.process_name}
          </p>
          <StatusBadge status={process.readiness_status} />
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500">{process.employee_count_active ?? process.employee_count} employees</span>
          <ScoreCircle score={process.readiness_score} />
        </div>

        <Progress value={process.readiness_score} className="h-1.5" />

        {/* Mini checklist dots */}
        <div className="flex gap-1 flex-wrap">
          {checks.map((v, i) => (
            <span
              key={i}
              className={cn(
                "inline-block w-2 h-2 rounded-full",
                v ? "bg-emerald-400" : "bg-rose-300"
              )}
            />
          ))}
          <span className="text-xs text-slate-500 ml-1">{doneCount}/{checks.length}</span>
        </div>

        {process.process_manager_signoff === 1 && (
          <Badge className="bg-emerald-100 text-emerald-700 border border-emerald-200 text-xs">
            PM Signed Off
          </Badge>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// BranchAccordion — one branch in the HO grouped view
// ---------------------------------------------------------------------------

function BranchAccordion({
  group, month, onProcessClick,
}: {
  group: BranchGroup; month: string; onProcessClick: (p: ProcessReadiness) => void;
}) {
  const [open, setOpen] = useState(false);
  const readyPct = group.stats.total > 0
    ? Math.round((group.stats.ready / group.stats.total) * 100)
    : 0;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <div className="flex items-center justify-between p-3 rounded-lg border bg-white hover:bg-slate-50 cursor-pointer transition-colors">
          <div className="flex items-center gap-3">
            {open
              ? <ChevronDown className="h-4 w-4 text-slate-400" />
              : <ChevronRight className="h-4 w-4 text-slate-400" />}
            <Building2 className="h-4 w-4 text-indigo-400" />
            <span className="font-semibold text-slate-800">{group.branch_name}</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-500 hidden sm:inline">
              {group.stats.ready}/{group.stats.total} ready
            </span>
            <Badge
              className={cn(
                "border text-xs",
                readyPct === 100
                  ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                  : readyPct >= 50
                  ? "bg-amber-100 text-amber-800 border-amber-200"
                  : "bg-rose-100 text-rose-800 border-rose-200"
              )}
            >
              {group.stats.avg_score}% avg
            </Badge>
          </div>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {group.processes.length === 0 ? (
          <p className="text-sm text-slate-500 px-4 py-3">No processes mapped to this branch.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 p-3 pt-2 border-x border-b rounded-b-lg bg-slate-50">
            {group.processes.map((proc) => (
              <ProcessCard key={proc.process_id} process={proc} onClick={() => onProcessClick(proc)} />
            ))}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Surfaces payrollGovernanceService's org-wide blockers/warnings — the checks that
 * actually gate calculation but this page's own per-process checklist doesn't cover
 * (PAN/UAN validity, attendance errors, salary structure, statutory config). See
 * the OrgWideGovernance type doc for why this is org-wide rather than per-process.
 */
function GovernanceBanner({ governance }: { governance: OrgWideGovernance }) {
  const [expanded, setExpanded] = useState(false);

  if (governance.status === "not_created") {
    // No salary_prep_run exists yet for this month — CONFIGURATION_MISSING, not PASS.
    return null;
  }

  if (governance.status === "error") {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-700">
        <AlertCircle className="h-4 w-4 flex-shrink-0 text-slate-500" />
        <span>
          <strong>Compliance/statutory checks: NOT CHECKED</strong> — the governance engine failed to
          run for this month's payroll run. This is not the same as "no issues found." Retry or check
          server logs.
        </span>
      </div>
    );
  }

  const { blockers, warnings, issues, canCalculate } = governance;
  if (blockers === 0 && warnings === 0) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        <span>
          <strong>Compliance/statutory checks: PASS</strong> — no blockers or warnings from PAN/UAN
          validity, attendance-error, salary-structure or statutory-config checks for this run.
        </span>
      </div>
    );
  }

  return (
    <div className={cn("rounded-2xl border px-4 py-3 text-sm", blockers > 0 ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-800")}>
      <button type="button" onClick={() => setExpanded((v) => !v)} className="flex w-full items-center gap-3 text-left">
        <AlertCircle className={cn("h-4 w-4 flex-shrink-0", blockers > 0 ? "text-red-500" : "text-amber-500")} />
        <span className="flex-1">
          <strong>Compliance/statutory checks: {canCalculate ? "WARNING" : "FAIL"}</strong> — org-wide
          for this month's run, not per-process: <strong>{blockers}</strong> blocker{blockers === 1 ? "" : "s"},{" "}
          <strong>{warnings}</strong> warning{warnings === 1 ? "" : "s"}
          {!canCalculate && " — payroll calculation is currently blocked"}.
        </span>
        <span className="text-xs underline">{expanded ? "Hide" : "View"} details</span>
      </button>
      {expanded && (
        <ul className="mt-3 space-y-1.5 border-t border-current/20 pt-3">
          {issues.map((issue) => (
            <li key={issue.code} className="flex items-start gap-2 text-xs">
              <span className={cn("mt-0.5 shrink-0 rounded px-1.5 py-0.5 font-bold uppercase", issue.severity === "blocker" ? "bg-red-200 text-red-800" : "bg-amber-200 text-amber-800")}>
                {issue.severity}
              </span>
              <span><strong>{issue.count}</strong> — {issue.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Surfaces the payment-readiness depth layer (payroll-readiness-categories.service.ts)
 * alongside GovernanceBanner. Kept as its own banner deliberately: a month can be
 * "calculation technically available" (governance PASS) while simultaneously
 * "NOT READY FOR PAYMENT" (canPay=false) — see the identical component in
 * BranchPayrollReadiness.tsx, which this mirrors so both named pages show the
 * same canonical verdict rather than independent interpretations of it.
 */
function PaymentReadinessBanner({ readiness }: { readiness: PaymentReadinessCategories }) {
  const [expanded, setExpanded] = useState(false);

  if (readiness.status === "not_created") return null;

  if (readiness.status === "error") {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-700">
        <AlertCircle className="h-4 w-4 flex-shrink-0 text-slate-500" />
        <span>
          <strong>Payment readiness: NOT CHECKED</strong> — {readiness.message}. This is not the same as
          "ready to pay."
        </span>
      </div>
    );
  }

  const { canPay, canPayBlockedBy, summary, layers, checks, evaluatedAt, governanceVersion } = readiness;
  const notGreenChecks = checks.filter((c) => c.state !== "PASS" && c.state !== "NOT_APPLICABLE");

  if (canPay && summary.p0 === 0 && summary.p1 === 0 && summary.sourceMissing === 0 && summary.checkErrors === 0) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        <span>
          <strong>Payment readiness: READY TO PAY</strong> — incentive, reimbursement, recovery, F&amp;F and
          payment-file checks all clear ({governanceVersion}, evaluated {new Date(evaluatedAt).toLocaleString()}).
        </span>
      </div>
    );
  }

  return (
    <div className={cn("rounded-2xl border px-4 py-3 text-sm", !canPay ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-800")}>
      <button type="button" onClick={() => setExpanded((v) => !v)} className="flex w-full items-center gap-3 text-left">
        <AlertCircle className={cn("h-4 w-4 flex-shrink-0", !canPay ? "text-red-500" : "text-amber-500")} />
        <span className="flex-1">
          <strong>Payment readiness: {canPay ? "WARNING" : "NOT READY FOR PAYMENT"}</strong> — incentive /
          reimbursement / recovery / F&amp;F / payment-file layer:{" "}
          <strong>{summary.p0}</strong> P0, <strong>{summary.p1}</strong> P1, <strong>{summary.p2}</strong> P2
          {summary.sourceMissing > 0 && <>, <strong>{summary.sourceMissing}</strong> source-missing</>}
          {summary.checkErrors > 0 && <>, <strong>{summary.checkErrors}</strong> check-error</>}
          {!canPay && canPayBlockedBy.length > 0 && ` — blocked by ${canPayBlockedBy.join(", ")}`}.
        </span>
        <span className="text-xs underline">{expanded ? "Hide" : "View"} details</span>
      </button>
      {expanded && (
        <>
          <div className="mt-3 flex flex-wrap gap-1.5 border-t border-current/20 pt-3">
            {layers
              .filter((l) => l.state !== "PASS")
              .map((l) => (
                <span
                  key={l.layer}
                  className={cn(
                    "rounded px-2 py-1 text-[11px] font-semibold uppercase",
                    l.state === "SOURCE_MISSING" ? "bg-slate-200 text-slate-700" : l.p0 > 0 ? "bg-red-200 text-red-800" : "bg-amber-200 text-amber-800",
                  )}
                  title={`${l.checks} checks, ${l.failed} failed, ${l.affectedEmployees} employees affected`}
                >
                  {l.layer}: {l.state}
                </span>
              ))}
          </div>
          <ul className="mt-3 space-y-1.5">
            {notGreenChecks.map((c) => (
              <li key={c.code} className="flex items-start gap-2 text-xs">
                <span
                  className={cn(
                    "mt-0.5 shrink-0 rounded px-1.5 py-0.5 font-bold uppercase",
                    c.state === "SOURCE_MISSING"
                      ? "bg-slate-200 text-slate-700"
                      : c.state === "CHECK_ERROR"
                        ? "bg-red-300 text-red-900"
                        : c.severity === "P0"
                          ? "bg-red-200 text-red-800"
                          : c.severity === "P1"
                            ? "bg-amber-200 text-amber-800"
                            : "bg-slate-100 text-slate-600",
                  )}
                >
                  {c.state === "FAIL" ? c.severity : c.state}
                </span>
                <span>
                  {c.affectedEmployees > 0 && <><strong>{c.affectedEmployees}</strong> — </>}
                  {c.message}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// HOGroupedView
// ---------------------------------------------------------------------------

function HOGroupedView({ roleKeys, autoOpenProcessId }: { roleKeys: string[]; autoOpenProcessId?: string }) {
  const [month, setMonth] = useState(currentMonth());
  const [selected, setSelected] = useState<ProcessReadiness | null>(null);
  const [activeTab, setActiveTab] = useState<"branches" | "flags">("branches");

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["process-readiness-grouped", month],
    queryFn: () => apiFetch(`/api/payroll/process-readiness/grouped-summary?month=${month}`),
    refetchInterval: 120_000,
  });

  const groups: BranchGroup[] = data?.data ?? [];

  const canOverride = roleKeys.some(r => ["payroll_head", "super_admin"].includes(r));

  const { data: flagData, refetch: refetchFlags } = useQuery({
    queryKey: ["salary-open-flags", month],
    queryFn: () =>
      apiFetch(`/api/payroll/salary-verification/open-flags?month=${month}`),
    staleTime: 60_000,
    enabled: canOverride,
  });
  const openFlags: Array<{
    id: string; employee_code: string; employee_name: string; process_name: string;
    branch_name: string; category: string; description: string;
    expected_value: number | null; raised_at: string; status: string; raised_by_email: string;
  }> = flagData?.data ?? [];
  const openFlagCount = openFlags.length;

  const resolveFlag = useMutation({
    mutationFn: ({ flagId, status }: { flagId: string; status: string }) =>
      apiFetch(`/api/payroll/salary-verification/flags/${flagId}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => { toast.success("Flag updated"); refetchFlags(); },
    onError: () => toast.error("Failed to update flag"),
  });

  useEffect(() => {
    if (!autoOpenProcessId || !groups.length) return;
    for (const group of groups) {
      const proc = group.processes.find((p) => p.process_id === autoOpenProcessId);
      if (proc) { setSelected(proc); break; }
    }
  }, [autoOpenProcessId, groups]);
  const summary = data?.summary ?? { totalBranches: 0, totalProcesses: 0, readyProcesses: 0, avgScore: 0 };
  const governance: OrgWideGovernance = data?.governance ?? { status: "not_created" };

  const { data: paymentReadinessData } = useQuery({
    queryKey: ["payment-readiness-categories", month],
    queryFn: async () => {
      try {
        const res = await apiFetch(`/api/payroll/readiness-categories/month/${month}`);
        if (res.status === "not_created" || !res.data) return { status: "not_created" as const };
        return { status: "checked" as const, ...res.data };
      } catch (err) {
        return { status: "error" as const, message: err instanceof Error ? err.message : "Payment readiness check failed" };
      }
    },
    refetchInterval: 120_000,
    retry: false,
  });
  const paymentReadiness: PaymentReadinessCategories = paymentReadinessData ?? { status: "not_created" };

  const csvUrl = `/api/payroll/process-readiness/export?month=${month}&format=csv`;
  const canExport = roleKeys.some(r => ["payroll_head", "super_admin", "admin"].includes(r));

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-slate-600">Month</label>
          <Input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="w-36 h-8 text-sm"
          />
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={cn("h-3 w-3 mr-1", isFetching && "animate-spin")} />
          Refresh
        </Button>
        {canExport && (
          <a href={csvUrl} download={`process-readiness-${month}.csv`}>
            <Button size="sm" variant="outline">
              <Download className="h-3 w-3 mr-1" />
              Export CSV
            </Button>
          </a>
        )}
      </div>

      <GovernanceBanner governance={governance} />
      <PaymentReadinessBanner readiness={paymentReadiness} />

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Branches",      value: summary.totalBranches },
          { label: "Processes",     value: summary.totalProcesses },
          { label: "Ready",         value: summary.readyProcesses, green: true },
          { label: "Avg Score",     value: `${summary.avgScore}%` },
        ].map(({ label, value, green }) => (
          <Card key={label} className="bg-white">
            <CardContent className="p-3 text-center">
              <div className={cn("text-2xl font-bold", green ? "text-emerald-600" : "text-slate-700")}>
                {value}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">{label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tab bar */}
      {canOverride && (
        <div className="flex gap-1 rounded-xl border bg-white p-1 w-fit">
          {[
            { v: "branches", label: "Branches" },
            { v: "flags",    label: `Salary Flags${openFlagCount > 0 ? ` (${openFlagCount})` : ""}` },
          ].map(({ v, label }) => (
            <button
              key={v}
              type="button"
              onClick={() => setActiveTab(v as "branches" | "flags")}
              className={cn(
                "rounded-lg px-4 py-1.5 text-xs font-semibold transition-all",
                activeTab === v ? "bg-[#1B6AB5] text-white shadow-sm" : "text-slate-500 hover:text-slate-700"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Branch accordions */}
      {activeTab === "branches" && (isLoading ? (
        <div className="text-center py-10 text-slate-400">Loading…</div>
      ) : groups.length === 0 ? (
        <div className="text-center py-10 text-slate-400">No branches found.</div>
      ) : (
        <div className="space-y-2">
          {groups.map((group) => (
            <BranchAccordion
              key={group.branch_id}
              group={group}
              month={month}
              onProcessClick={setSelected}
            />
          ))}
        </div>
      ))}

      {/* Flag queue */}
      {activeTab === "flags" && canOverride && (
        <div className="space-y-3">
          {openFlags.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
              <CheckCircle2 className="h-8 w-8 mb-2" />
              <p className="text-sm">No open salary flags for {month}</p>
            </div>
          ) : openFlags.map((flag) => (
            <div key={flag.id} className="rounded-2xl border border-red-200 bg-white overflow-hidden">
              <div className="flex items-start gap-3 p-4">
                <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-slate-800">{flag.employee_name} ({flag.employee_code})</span>
                    <span className="text-xs text-slate-400">{flag.branch_name} / {flag.process_name}</span>
                    <Badge className="capitalize border text-[10px] bg-red-50 text-red-700 border-red-200">
                      {flag.category.replace("_", " ")}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-slate-600">{flag.description}</p>
                  {flag.expected_value != null && (
                    <p className="mt-0.5 text-xs text-slate-500">Expected: ₹{flag.expected_value.toLocaleString("en-IN")}</p>
                  )}
                  <p className="mt-1 text-[10px] text-slate-400">
                    By {flag.raised_by_email} · {new Date(flag.raised_at).toLocaleDateString("en-IN")}
                  </p>
                </div>
              </div>
              <div className="flex gap-2 border-t px-4 py-2.5 bg-slate-50">
                <Button size="sm" className="h-7 text-xs rounded-xl"
                  disabled={resolveFlag.isPending}
                  onClick={() => resolveFlag.mutate({ flagId: flag.id, status: "resolved" })}>
                  Recalculate &amp; Resolve
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs rounded-xl"
                  disabled={resolveFlag.isPending}
                  onClick={() => resolveFlag.mutate({ flagId: flag.id, status: "acknowledged" })}>
                  Acknowledge — No Change
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs rounded-xl text-slate-500"
                  disabled={resolveFlag.isPending}
                  onClick={() => resolveFlag.mutate({ flagId: flag.id, status: "rejected" })}>
                  Reject
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ProcessDetailDrawer
        process={selected}
        month={month}
        open={!!selected}
        onClose={() => setSelected(null)}
        roleKeys={roleKeys}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// BranchProcessView — branch_head sees their branch's processes
// ---------------------------------------------------------------------------

function BranchProcessView({ branchId, roleKeys, autoOpenProcessId }: { branchId: string; roleKeys: string[]; autoOpenProcessId?: string }) {
  const [month, setMonth] = useState(currentMonth());
  const [selected, setSelected] = useState<ProcessReadiness | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["process-readiness-branch", month, branchId],
    queryFn: () => apiFetch(`/api/payroll/process-readiness/branch/${branchId}?month=${month}`),
    refetchInterval: 120_000,
  });

  const processes: ProcessReadiness[] = data?.data ?? [];

  useEffect(() => {
    if (!autoOpenProcessId || !processes.length) return;
    const proc = processes.find((p) => p.process_id === autoOpenProcessId);
    if (proc) setSelected(proc);
  }, [autoOpenProcessId, processes]);
  const summary = data?.summary ?? { total: 0, ready: 0, in_progress: 0, blocked: 0, avg_score: 0 };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-slate-600">Month</label>
          <Input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="w-36 h-8 text-sm"
          />
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={cn("h-3 w-3 mr-1", isFetching && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total", value: summary.total },
          { label: "Ready", value: summary.ready, green: true },
          { label: "In Progress", value: summary.in_progress },
          { label: "Avg Score", value: `${summary.avg_score}%` },
        ].map(({ label, value, green }) => (
          <Card key={label} className="bg-white">
            <CardContent className="p-3 text-center">
              <div className={cn("text-2xl font-bold", green ? "text-emerald-600" : "text-slate-700")}>
                {value}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">{label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {isLoading ? (
        <div className="text-center py-10 text-slate-400">Loading…</div>
      ) : processes.length === 0 ? (
        <div className="text-center py-10 text-slate-400">No processes mapped to your branch for this month.</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {processes.map((proc) => (
            <ProcessCard key={proc.process_id} process={proc} onClick={() => setSelected(proc)} />
          ))}
        </div>
      )}

      <ProcessDetailDrawer
        process={selected}
        month={month}
        open={!!selected}
        onClose={() => setSelected(null)}
        roleKeys={roleKeys}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// SingleProcessView — process_manager/wfm see their assigned process(es)
// ---------------------------------------------------------------------------

function SingleProcessView({ userId, roleKeys, autoOpenProcessId }: { userId: string; roleKeys: string[]; autoOpenProcessId?: string }) {
  const [month, setMonth] = useState(currentMonth());
  const [selected, setSelected] = useState<ProcessReadiness | null>(null);

  // Fetch processes assigned to this user
  const { data: assignedData } = useQuery({
    queryKey: ["my-processes", userId],
    // The router is mounted at /api/processES; /api/process was served by nothing, so this
    // call had always failed and assignedProcesses was permanently empty — which is why the
    // page told every user "No processes are assigned to your account" regardless of their
    // actual mapping. userId is no longer sent: the endpoint reads the caller's identity from
    // the verified token, so passing it was both redundant and spoofable.
    queryFn: () => apiFetch(`/api/processes/my-processes`),
    retry: false,
  });

  const assignedProcesses: Array<{ id: string; branch_id: string; process_name: string }> =
    assignedData?.data ?? assignedData?.processes ?? [];

  const readinessQueries = useQuery({
    queryKey: ["process-readiness-single", month, userId],
    enabled: assignedProcesses.length > 0,
    queryFn: async () => {
      const results = await Promise.allSettled(
        assignedProcesses.map((p) =>
          apiFetch(`/api/payroll/process-readiness/${p.branch_id}/${p.id}?month=${month}`)
        )
      );
      return results
        .filter((r) => r.status === "fulfilled")
        .map((r) => (r as PromiseFulfilledResult<any>).value?.data as ProcessReadiness)
        .filter(Boolean);
    },
    refetchInterval: 120_000,
  });

  const processes: ProcessReadiness[] = readinessQueries.data ?? [];

  useEffect(() => {
    if (!autoOpenProcessId || !processes.length) return;
    const proc = processes.find((p) => p.process_id === autoOpenProcessId);
    if (proc) setSelected(proc);
  }, [autoOpenProcessId, processes]);

  if (assignedProcesses.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
        <Info className="h-10 w-10" />
        <p className="text-sm">No processes are assigned to your account.</p>
        <p className="text-xs">Contact your HR admin to map you to a process.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-slate-600">Month</label>
          <Input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="w-36 h-8 text-sm"
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => readinessQueries.refetch()}
          disabled={readinessQueries.isFetching}
        >
          <RefreshCw className={cn("h-3 w-3 mr-1", readinessQueries.isFetching && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {readinessQueries.isLoading ? (
        <div className="text-center py-10 text-slate-400">Loading…</div>
      ) : processes.length === 0 ? (
        <div className="text-center py-10 text-slate-400">No readiness data yet.</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {processes.map((proc) => (
            <ProcessCard key={proc.process_id} process={proc} onClick={() => setSelected(proc)} />
          ))}
        </div>
      )}

      <ProcessDetailDrawer
        process={selected}
        month={month}
        open={!!selected}
        onClose={() => setSelected(null)}
        roleKeys={roleKeys}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

export default function ProcessPayrollReadiness() {
  const { user } = useAuth();
  const { roleKeys, isLoading: roleLoading } = useWorkforceAccess();
  const [searchParams] = useSearchParams();
  const autoOpenProcessId = searchParams.get("open") ?? undefined;

  const isHO = roleKeys.some(r => ["payroll_head", "super_admin", "admin", "payroll"].includes(r));
  const isBranchHead = !isHO && roleKeys.some(r => ["branch_head", "payroll_branch", "hr"].includes(r));
  const isPMorWFM = !isHO && !isBranchHead && roleKeys.some(r => ["process_manager", "wfm"].includes(r));

  const branchId: string = (user as any)?.branch_id ?? "";

  if (roleLoading) return null;

  return (
    <WorkforcePageGate pageCode="PAYROLL_PROCESS_READINESS">
      <DashboardLayout>
        <div className="p-4 md:p-6 space-y-4 max-w-6xl mx-auto">
          {/* Header */}
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <Layers className="h-5 w-5 text-indigo-500" />
                <h1 className="text-xl font-bold text-slate-900">Process Payroll Readiness</h1>
              </div>
              <p className="text-sm text-slate-500 mt-0.5">
                {isHO
                  ? "HO view — all branches and their processes"
                  : isBranchHead
                  ? "Processes in your branch"
                  : "Your assigned processes"}
              </p>
            </div>
          </div>

          {/* How it works */}
          <Collapsible>
            <CollapsibleTrigger asChild>
              <button className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700">
                <Info className="h-4 w-4" />
                How Process Readiness Works
                <ChevronDown className="h-3 w-3" />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-2 rounded-lg bg-slate-50 border p-4 text-sm text-slate-600 space-y-2">
                <p><strong>WFM</strong> marks "Attendance Data Ready" once punching/regularisation is complete.</p>
                <p><strong>Payroll Head</strong> then performs the attendance freeze in the payroll system.</p>
                <p><strong>Process Manager</strong> completes remaining checklist items (deductions, overtime) and signs off.</p>
                <p><strong>Payroll Head</strong> receives work-inbox notifications for each process sign-off.</p>
                <p>Score weights: Attendance Data Ready 15 · Frozen 10 · Incentives 20 · Deductions 10 · OT 10 · Bank 15 · UAN 10 · NOC 5 · HWR 5</p>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* View based on role */}
          {isHO && <HOGroupedView roleKeys={roleKeys} autoOpenProcessId={autoOpenProcessId} />}
          {isBranchHead && branchId && <BranchProcessView branchId={branchId} roleKeys={roleKeys} autoOpenProcessId={autoOpenProcessId} />}
          {isPMorWFM && user?.id && <SingleProcessView userId={user.id} roleKeys={roleKeys} autoOpenProcessId={autoOpenProcessId} />}
          {!isHO && !isBranchHead && !isPMorWFM && (
            <div className="text-center py-16 text-slate-400 text-sm">
              Your role does not have access to process readiness.
            </div>
          )}
        </div>
      </DashboardLayout>
    </WorkforcePageGate>
  );
}
