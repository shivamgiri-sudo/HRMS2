import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
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
  const canSignOff = isPM && process.attendance_frozen === 1 && process.process_manager_signoff === 0;

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

          {/* Checklist */}
          <div className="rounded-lg border p-3 space-y-0.5">
            <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Checklist</p>

            {/* Attendance Data Ready — WFM toggleable */}
            <ChecklistToggle
              label="Attendance Data Ready (WFM)"
              checked={process.attendance_data_ready === 1}
              disabled={!canToggleAttendance}
              onToggle={(v) => checklistMutation.mutate({ item: "attendance_data_ready", value: v })}
            />

            {/* Attendance Frozen — read-only; show Request Freeze if not frozen */}
            <div className="flex items-center justify-between gap-2 py-2 border-b">
              <div className="flex items-center gap-2 text-sm">
                {process.attendance_frozen
                  ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                  : <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />}
                <span className={process.attendance_frozen ? "text-slate-700" : "text-slate-500"}>
                  Attendance Frozen (Payroll)
                </span>
              </div>
              {!process.attendance_frozen && isWFM && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-xs text-amber-700 border-amber-300 hover:bg-amber-50"
                  disabled={freezeRequestMutation.isPending}
                  onClick={() => freezeRequestMutation.mutate()}
                >
                  <Bell className="h-3 w-3 mr-1" />
                  Request
                </Button>
              )}
            </div>

            {/* Incentives — read-only */}
            <div className="flex items-center justify-between gap-2 py-2 border-b">
              <div className="flex items-center gap-2 text-sm">
                {process.incentives_status === "approved"
                  ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                  : <Clock className="h-4 w-4 text-slate-400 shrink-0" />}
                <span className={process.incentives_status === "approved" ? "text-slate-700" : "text-slate-500"}>
                  Incentives Approved
                </span>
              </div>
              <Badge variant="outline" className="text-xs capitalize">
                {process.incentives_status.replace("_", " ")}
              </Badge>
            </div>

            {/* Custom Deductions — PM/WFM toggleable */}
            <ChecklistToggle
              label="Custom Deductions Uploaded"
              checked={process.custom_deductions_uploaded === 1}
              disabled={!canToggleOther}
              onToggle={(v) => checklistMutation.mutate({ item: "custom_deductions_uploaded", value: v })}
            />

            {/* Overtime — PM/WFM toggleable */}
            <ChecklistToggle
              label="Overtime Entered"
              checked={process.overtime_entered === 1}
              disabled={!canToggleOther}
              onToggle={(v) => checklistMutation.mutate({ item: "overtime_entered", value: v })}
            />

            {/* Bank Details % */}
            <div className="flex items-center justify-between gap-2 py-2 border-b">
              <div className="flex items-center gap-2 text-sm">
                {process.bank_details_pct >= 95
                  ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                  : <AlertCircle className="h-4 w-4 text-amber-400 shrink-0" />}
                <span className="text-slate-700">Bank Details Complete</span>
              </div>
              <span className="text-sm font-medium tabular-nums">{process.bank_details_pct}%</span>
            </div>

            {/* UAN % */}
            <div className="flex items-center justify-between gap-2 py-2 border-b">
              <div className="flex items-center gap-2 text-sm">
                {process.uan_complete_pct >= 95
                  ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                  : <AlertCircle className="h-4 w-4 text-amber-400 shrink-0" />}
                <span className="text-slate-700">UAN / PF Complete</span>
              </div>
              <span className="text-sm font-medium tabular-nums">{process.uan_complete_pct}%</span>
            </div>

            {/* NOC */}
            <div className="flex items-center gap-2 py-2 border-b text-sm">
              {process.noc_resolved
                ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                : <XCircle className="h-4 w-4 text-rose-400 shrink-0" />}
              <span className={process.noc_resolved ? "text-slate-700" : "text-rose-600"}>
                NOC Resolved
              </span>
            </div>

            {/* Holiday Work */}
            <div className="flex items-center gap-2 py-2 text-sm">
              {process.holiday_work_approved
                ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                : <XCircle className="h-4 w-4 text-rose-400 shrink-0" />}
              <span className={process.holiday_work_approved ? "text-slate-700" : "text-rose-600"}>
                Holiday Work Approved
              </span>
            </div>
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

// ---------------------------------------------------------------------------
// HOGroupedView
// ---------------------------------------------------------------------------

function HOGroupedView({ roleKeys }: { roleKeys: string[] }) {
  const [month, setMonth] = useState(currentMonth());
  const [selected, setSelected] = useState<ProcessReadiness | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["process-readiness-grouped", month],
    queryFn: () => apiFetch(`/api/payroll/process-readiness/grouped-summary?month=${month}`),
    refetchInterval: 120_000,
  });

  const groups: BranchGroup[] = data?.data ?? [];
  const summary = data?.summary ?? { totalBranches: 0, totalProcesses: 0, readyProcesses: 0, avgScore: 0 };

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

      {/* Branch accordions */}
      {isLoading ? (
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

function BranchProcessView({ branchId, roleKeys }: { branchId: string; roleKeys: string[] }) {
  const [month, setMonth] = useState(currentMonth());
  const [selected, setSelected] = useState<ProcessReadiness | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["process-readiness-branch", month, branchId],
    queryFn: () => apiFetch(`/api/payroll/process-readiness/branch/${branchId}?month=${month}`),
    refetchInterval: 120_000,
  });

  const processes: ProcessReadiness[] = data?.data ?? [];
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

function SingleProcessView({ userId, roleKeys }: { userId: string; roleKeys: string[] }) {
  const [month, setMonth] = useState(currentMonth());
  const [selected, setSelected] = useState<ProcessReadiness | null>(null);

  // Fetch processes assigned to this user
  const { data: assignedData } = useQuery({
    queryKey: ["my-processes", userId],
    queryFn: () => apiFetch(`/api/process/my-processes?userId=${userId}`),
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
  const { user } = useAuthStore();
  const { roleKeys, isLoading: roleLoading } = useWorkforceAccess();

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
          {isHO && <HOGroupedView roleKeys={roleKeys} />}
          {isBranchHead && branchId && <BranchProcessView branchId={branchId} roleKeys={roleKeys} />}
          {isPMorWFM && user?.id && <SingleProcessView userId={user.id} roleKeys={roleKeys} />}
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
