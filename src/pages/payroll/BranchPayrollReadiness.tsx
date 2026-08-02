import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Lock,
  CheckCircle2,
  XCircle,
  RefreshCw,
  AlertTriangle,
  Clock,
  CreditCard,
  Briefcase,
  Sun,
  Building2,
  ChevronRight,
  ShieldCheck,
  X,
  Download,
  ChevronDown,
  Bell,
  TrendingUp,
  IndianRupee,
} from "lucide-react";
import { toast } from "sonner";

import { DashboardLayout } from "../../components/layout/DashboardLayout";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../../components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "../../components/ui/sheet";
import { Textarea } from "../../components/ui/textarea";
import { Skeleton } from "../../components/ui/skeleton";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../components/ui/collapsible";
import { useWorkforceAccess } from "../../hooks/useUserRole";
import { hrmsApi } from "../../lib/hrmsApi";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface BranchReadiness {
  branch_id: string;
  branch_name: string;
  process_month: string;
  attendance_frozen: number;
  attendance_frozen_at: string | null;
  incentives_status: "not_uploaded" | "uploaded" | "approved";
  custom_deductions_uploaded: number;
  overtime_entered: number;
  bank_details_pct: number;
  uan_complete_pct: number;
  noc_resolved: number;
  holiday_work_approved: number;
  branch_head_signoff: number;
  branch_head_signoff_at: string | null;
  branch_head_signoff_by: string | null;
  branch_head_remarks: string | null;
  ho_override_ready: number;
  ho_override_by: string | null;
  ho_override_at: string | null;
  ho_override_reason: string | null;
  readiness_score: number;
  readiness_status: "not_started" | "in_progress" | "ready" | "blocked";
  employee_count: number;
  employee_count_active: number;
  employee_count_left: number;
  projected_gross: number | null;
  projected_net: number | null;
  projection_computed_at: string | null;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

const fmt = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

function fmtCurrency(v: number | null | undefined): string {
  if (v == null) return "—";
  return fmt.format(v);
}

function fmtDateTime(v: string | null | undefined): string {
  if (!v) return "—";
  // Replace space separator with T so V8 parses as local time, not UTC
  return new Date(v.replace(" ", "T")).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getScoreColors(score: number) {
  if (score >= 80)
    return {
      badge: "text-emerald-700 bg-emerald-50 border-emerald-200",
      ring: "stroke-emerald-500",
      text: "text-emerald-700",
    };
  if (score >= 60)
    return {
      badge: "text-amber-700 bg-amber-50 border-amber-200",
      ring: "stroke-amber-500",
      text: "text-amber-700",
    };
  return {
    badge: "text-red-700 bg-red-50 border-red-200",
    ring: "stroke-red-500",
    text: "text-red-700",
  };
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ─── Score Circle ──────────────────────────────────────────────────────────────

function ScoreCircle({ score, size = 64 }: { score: number; size?: number }) {
  const colors = getScoreColors(score);
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.min(100, Math.max(0, score));
  const dash = (pct / 100) * circ;

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={6}
          className="text-gray-100"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={6}
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          className={colors.ring}
        />
      </svg>
      <span className={`absolute text-sm font-bold tabular-nums ${colors.text}`}>{score}%</span>
    </div>
  );
}

// ─── Checklist Item Definitions ────────────────────────────────────────────────

interface ChecklistDef {
  key: keyof BranchReadiness | "incentives_status";
  label: string;
  icon: React.ReactNode;
  isPercent?: boolean;
  timestampKey?: keyof BranchReadiness;
  isManual?: boolean;
}

const CHECKLIST_DEFS: ChecklistDef[] = [
  {
    key: "attendance_frozen",
    label: "Attendance Frozen",
    icon: <Lock className="w-4 h-4" />,
    timestampKey: "attendance_frozen_at",
  },
  {
    key: "incentives_status",
    label: "Incentives Approved",
    icon: <CheckCircle2 className="w-4 h-4" />,
  },
  {
    key: "custom_deductions_uploaded",
    label: "Custom Deductions",
    icon: <CreditCard className="w-4 h-4" />,
    isManual: true,
  },
  {
    key: "overtime_entered",
    label: "Overtime Entered",
    icon: <Clock className="w-4 h-4" />,
    isManual: true,
  },
  {
    key: "bank_details_pct",
    label: "Bank Details",
    icon: <Building2 className="w-4 h-4" />,
    isPercent: true,
  },
  {
    key: "uan_complete_pct",
    label: "UAN Complete",
    icon: <Briefcase className="w-4 h-4" />,
    isPercent: true,
  },
  {
    key: "noc_resolved",
    label: "NOC Resolved",
    icon: <ShieldCheck className="w-4 h-4" />,
  },
  {
    key: "holiday_work_approved",
    label: "Holiday Work Approved",
    icon: <Sun className="w-4 h-4" />,
  },
];

function getChecklistValue(branch: BranchReadiness, def: ChecklistDef): boolean {
  if (def.key === "incentives_status") return branch.incentives_status === "approved";
  if (def.isPercent) {
    const val = branch[def.key as keyof BranchReadiness] as number;
    return val >= 100;
  }
  return Boolean(branch[def.key as keyof BranchReadiness]);
}

function getChecklistDisplay(branch: BranchReadiness, def: ChecklistDef): string | null {
  if (def.isPercent) {
    const val = branch[def.key as keyof BranchReadiness] as number;
    return `${val}%`;
  }
  if (def.key === "incentives_status") return branch.incentives_status.replace(/_/g, " ");
  return null;
}

// ─── Branch Card (HO view) ─────────────────────────────────────────────────────

const STATUS_CARD_STYLE: Record<string, { border: string; accentBar: string; badge: string; badgeText: string }> = {
  ready:       { border: "border-emerald-200", accentBar: "bg-emerald-400", badge: "bg-emerald-100 text-emerald-700 border-emerald-200", badgeText: "Ready" },
  in_progress: { border: "border-amber-200",   accentBar: "bg-amber-400",   badge: "bg-amber-100 text-amber-700 border-amber-200",       badgeText: "In Progress" },
  blocked:     { border: "border-red-200",     accentBar: "bg-red-400",     badge: "bg-red-100 text-red-700 border-red-200",             badgeText: "Blocked" },
  not_started: { border: "border-slate-200",   accentBar: "bg-slate-300",   badge: "bg-slate-100 text-slate-500 border-slate-200",       badgeText: "Not Started" },
};

function BranchCard({
  branch,
  onOpenDetail,
  onOverride,
  canOverride,
}: {
  branch: BranchReadiness;
  onOpenDetail: (b: BranchReadiness) => void;
  onOverride: (b: BranchReadiness) => void;
  canOverride: boolean;
}) {
  const s = STATUS_CARD_STYLE[branch.readiness_status] ?? STATUS_CARD_STYLE.not_started;
  const doneCount = CHECKLIST_DEFS.filter((def) => getChecklistValue(branch, def)).length;
  const totalCount = CHECKLIST_DEFS.length;

  return (
    <div
      className={`group relative cursor-pointer overflow-hidden rounded-2xl border-2 bg-white shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg ${s.border}`}
      onClick={() => onOpenDetail(branch)}
    >
      {/* Status accent bar */}
      <div className={`absolute left-0 top-0 h-full w-1 ${s.accentBar}`} />

      <div className="pl-4 pr-4 pt-4 pb-3">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-base font-bold leading-tight text-slate-900">{branch.branch_name}</h3>
            <p className="mt-0.5 text-xs text-slate-400">
              {branch.employee_count_active || branch.employee_count} active
              {branch.employee_count_left > 0 && (
                <span className="ml-1 text-orange-600 font-medium">· {branch.employee_count_left} left (salary due)</span>
              )}
            </p>
          </div>
          <div className="flex-shrink-0">
            <ScoreCircle score={branch.readiness_score} size={52} />
          </div>
        </div>

        {/* Status badge + checklist progress */}
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${s.badge}`}>
            {s.badgeText}
          </span>
          <span className="text-[11px] text-slate-400">{doneCount}/{totalCount} checks</span>
        </div>

        {/* Progress bar */}
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-full rounded-full transition-all ${s.accentBar}`}
            style={{ width: `${Math.round((doneCount / totalCount) * 100)}%` }}
          />
        </div>

        {/* Checklist pills */}
        <div className="mt-3 flex flex-wrap gap-1">
          {CHECKLIST_DEFS.map((def) => {
            const ok = getChecklistValue(branch, def);
            const display = getChecklistDisplay(branch, def);
            return (
              <span
                key={String(def.key)}
                title={def.label + (display ? ` (${display})` : "")}
                className={`inline-flex items-center gap-0.5 rounded-md border px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                  ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-300"
                }`}
              >
                {ok ? <CheckCircle2 className="h-2.5 w-2.5" /> : <XCircle className="h-2.5 w-2.5" />}
                <span className="hidden sm:inline">{display ?? def.label.split(" ")[0]}</span>
              </span>
            );
          })}
        </div>

        {/* Salary projections */}
        {(branch.projected_gross != null || branch.projected_net != null) && (
          <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2">
            <div>
              <p className="text-[10px] font-medium text-slate-400">Gross</p>
              <p className="mt-0.5 text-sm font-bold text-slate-800">{fmtCurrency(branch.projected_gross)}</p>
            </div>
            {branch.projected_net != null && (
              <div>
                <p className="text-[10px] font-medium text-slate-400">Net</p>
                <p className="mt-0.5 text-sm font-bold text-slate-800">{fmtCurrency(branch.projected_net)}</p>
              </div>
            )}
          </div>
        )}

        {/* Footer: sign-off + override */}
        <div className="mt-3 flex items-center justify-between gap-2" onClick={(e) => e.stopPropagation()}>
          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
            branch.branch_head_signoff
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-amber-200 bg-amber-50 text-amber-700"
          }`}>
            {branch.branch_head_signoff ? <><CheckCircle2 className="h-2.5 w-2.5" /> Signed Off</> : "Pending Sign-off"}
          </span>
          <div className="flex items-center gap-1.5">
            {canOverride && !branch.ho_override_ready && (
              <Button size="sm" variant="outline" className="h-7 rounded-xl text-xs"
                onClick={(e) => { e.stopPropagation(); onOverride(branch); }}>
                HO Override
              </Button>
            )}
            {branch.ho_override_ready && (
              <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                <CheckCircle2 className="h-2.5 w-2.5" /> Overridden
              </span>
            )}
            <ChevronRight className="h-4 w-4 text-slate-300 transition-transform group-hover:translate-x-0.5" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Detail Drawer ─────────────────────────────────────────────────────────────

function DetailDrawer({
  branch,
  open,
  onClose,
  month,
}: {
  branch: BranchReadiness | null;
  open: boolean;
  onClose: () => void;
  month: string;
}) {
  const qc = useQueryClient();

  const projectionMutation = useMutation({
    mutationFn: async () => {
      if (!branch) return;
      await hrmsApi.get(
        `/api/payroll/branch-readiness/${branch.branch_id}/projection?month=${month}`
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["branch-readiness"] });
      toast.success("Projection refreshed");
    },
    onError: () => toast.error("Failed to refresh projection"),
  });

  if (!branch) return null;
  const colors = getScoreColors(branch.readiness_score);

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:w-[420px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{branch.branch_name} — Readiness Detail</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-4">
          <div className="flex items-center gap-4">
            <ScoreCircle score={branch.readiness_score} size={72} />
            <div>
              <p className="text-sm text-muted-foreground">Readiness Score</p>
              <Badge
                variant="outline"
                className={`mt-1 capitalize ${colors.badge}`}
              >
                {branch.readiness_status.replace(/_/g, " ")}
              </Badge>
            </div>
          </div>

          <div className="space-y-2">
            {CHECKLIST_DEFS.map((def) => {
              const ok = getChecklistValue(branch, def);
              const display = getChecklistDisplay(branch, def);
              const tsKey = def.timestampKey;
              const ts = tsKey ? (branch[tsKey] as string | null) : null;
              return (
                <div
                  key={String(def.key)}
                  className="flex items-start gap-3 p-3 rounded-lg border bg-card"
                >
                  <div
                    className={`mt-0.5 flex-shrink-0 ${ok ? "text-emerald-600" : "text-gray-300"}`}
                  >
                    {ok ? (
                      <CheckCircle2 className="w-5 h-5" />
                    ) : (
                      <XCircle className="w-5 h-5 text-red-300" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{def.label}</p>
                    {display && (
                      <p className="text-xs text-muted-foreground">{display}</p>
                    )}
                    {ts && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Updated: {fmtDateTime(ts)}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Projections */}
          <div className="rounded-lg border p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Salary Projections</p>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                disabled={projectionMutation.isPending}
                onClick={() => projectionMutation.mutate()}
                title="Refresh projection"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${projectionMutation.isPending ? "animate-spin" : ""}`} />
              </Button>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Projected Gross</span>
              <span className="font-medium">{fmtCurrency(branch.projected_gross)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Projected Net</span>
              <span className="font-medium">{fmtCurrency(branch.projected_net)}</span>
            </div>
            {branch.projection_computed_at && (
              <p className="text-xs text-muted-foreground">
                Computed: {fmtDateTime(branch.projection_computed_at)}
              </p>
            )}
          </div>

          {/* Branch head sign-off */}
          <div className="rounded-lg border p-3 space-y-1">
            <p className="text-sm font-semibold">Branch Head Sign-off</p>
            {branch.branch_head_signoff ? (
              <>
                <Badge
                  variant="outline"
                  className="text-emerald-700 bg-emerald-50 border-emerald-200"
                >
                  Signed Off
                </Badge>
                <p className="text-xs text-muted-foreground">
                  By: {branch.branch_head_signoff_by ?? "—"} on{" "}
                  {fmtDateTime(branch.branch_head_signoff_at)}
                </p>
                {branch.branch_head_remarks && (
                  <p className="text-xs text-muted-foreground italic">
                    "{branch.branch_head_remarks}"
                  </p>
                )}
              </>
            ) : (
              <Badge
                variant="outline"
                className="text-amber-700 bg-amber-50 border-amber-200"
              >
                Pending Sign-off
              </Badge>
            )}
          </div>

          {/* HO Override details */}
          {branch.ho_override_ready ? (
            <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3 space-y-1">
              <Badge
                variant="outline"
                className="text-blue-700 bg-blue-50 border-blue-200"
              >
                HO Override Applied
              </Badge>
              {branch.ho_override_by && (
                <p className="text-xs text-muted-foreground">
                  By: {branch.ho_override_by} on {fmtDateTime(branch.ho_override_at)}
                </p>
              )}
              {branch.ho_override_reason && (
                <p className="text-xs text-muted-foreground italic">
                  Reason: "{branch.ho_override_reason}"
                </p>
              )}
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── HO Override Dialog ────────────────────────────────────────────────────────

function OverrideDialog({
  branch,
  open,
  onClose,
  month,
}: {
  branch: BranchReadiness | null;
  open: boolean;
  onClose: () => void;
  month: string;
}) {
  const [reason, setReason] = useState("");
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: async () => {
      if (!branch) return;
      await hrmsApi.post(`/api/payroll/branch-readiness/${branch.branch_id}/ho-override`, {
        month,
        reason,
      });
    },
    onSuccess: () => {
      toast.success("HO Override applied");
      qc.invalidateQueries({ queryKey: ["branch-readiness"] });
      onClose();
      setReason("");
    },
    onError: () => toast.error("Failed to apply override"),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>HO Override — {branch?.branch_name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-sm text-muted-foreground">
            Marking this branch as ready overrides any checklist gaps. This action is audited.
          </p>
          <Textarea
            placeholder="Reason for override (required)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!reason.trim() || mutation.isPending}
          >
            {mutation.isPending ? "Applying…" : "Apply Override"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Sign-off Dialog (Branch View) ────────────────────────────────────────────

function SignOffDialog({
  branch,
  open,
  onClose,
  month,
}: {
  branch: BranchReadiness | null;
  open: boolean;
  onClose: () => void;
  month: string;
}) {
  const [remarks, setRemarks] = useState("");
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: async () => {
      if (!branch) return;
      await hrmsApi.post(`/api/payroll/branch-readiness/${branch.branch_id}/signoff`, {
        month,
        remarks,
      });
    },
    onSuccess: () => {
      toast.success("Branch signed off successfully");
      qc.invalidateQueries({ queryKey: ["branch-readiness"] });
      onClose();
      setRemarks("");
    },
    onError: () => toast.error("Sign-off failed"),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sign Off Branch Ready</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-sm text-muted-foreground">
            Confirm that all payroll inputs for <strong>{branch?.branch_name}</strong> are complete and
            ready for processing.
          </p>
          <Textarea
            placeholder="Remarks (required)"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            rows={3}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!remarks.trim() || mutation.isPending}
          >
            {mutation.isPending ? "Signing off…" : "Confirm Sign-off"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Mark Manual Item Dialog / Toggle ─────────────────────────────────────────

function ManualToggleButton({
  branchId,
  month,
  fieldKey,
  currentValue,
  label,
}: {
  branchId: string;
  month: string;
  fieldKey: "custom_deductions_uploaded" | "overtime_entered";
  currentValue: number;
  label: string;
}) {
  const qc = useQueryClient();
  const [confirmingUndo, setConfirmingUndo] = useState(false);

  const mutation = useMutation({
    mutationFn: async (newVal: number) => {
      await hrmsApi.post(`/api/payroll/branch-readiness/${branchId}/checklist?month=${month}`, {
        item: fieldKey,
        value: newVal,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["branch-readiness"] });
      setConfirmingUndo(false);
    },
    onError: () => {
      toast.error(`Failed to update ${label}`);
      setConfirmingUndo(false);
    },
  });

  const isDone = Boolean(currentValue);

  if (!isDone) {
    return (
      <Button
        size="sm"
        variant="outline"
        className="text-xs h-7"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate(1)}
      >
        {mutation.isPending ? "…" : "Mark as Done"}
      </Button>
    );
  }

  if (confirmingUndo) {
    return (
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant="destructive"
          className="text-xs h-7"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate(0)}
        >
          {mutation.isPending ? "…" : "Confirm Undo"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-xs h-7"
          onClick={() => setConfirmingUndo(false)}
        >
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <Button
      size="sm"
      variant="default"
      className="text-xs h-7 bg-emerald-600 hover:bg-emerald-700 text-white"
      disabled={mutation.isPending}
      onClick={() => setConfirmingUndo(true)}
    >
      Mark as Pending
    </Button>
  );
}

// ─── Branch View (single branch) ──────────────────────────────────────────────

function BranchView({
  branchId,
  month,
  isBranchRole,
}: {
  branchId: string;
  month: string;
  isBranchRole: boolean;
}) {
  const [signOffOpen, setSignOffOpen] = useState(false);
  const qc = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery<BranchReadiness>({
    queryKey: ["branch-readiness", month, branchId],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: BranchReadiness }>(
        `/api/payroll/branch-readiness/${branchId}?month=${month}`
      );
      return res.data;
    },
    staleTime: 30_000,
  });

  const projectionMutation = useMutation({
    mutationFn: async () => {
      await hrmsApi.get(
        `/api/payroll/branch-readiness/${branchId}/projection?month=${month}`
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["branch-readiness"] });
      toast.success("Projection refreshed");
    },
    onError: () => toast.error("Failed to refresh projection"),
  });

  const freezeRequestMutation = useMutation({
    mutationFn: async () => {
      await hrmsApi.post(`/api/payroll/branch-readiness/${branchId}/request-freeze`, {
        month,
      });
    },
    onSuccess: () => {
      toast.success("Attendance freeze request sent to Payroll Head");
    },
    onError: () => toast.error("Failed to send freeze request"),
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        {[...Array(8)].map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <AlertTriangle className="w-8 h-8 mb-2" />
        <p>Failed to load branch readiness data.</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  const colors = getScoreColors(data.readiness_score);
  const canSignOff = Boolean(data.attendance_frozen) && !data.branch_head_signoff;

  // Build list of failing checklist items for blocked guidance
  const failingItems = CHECKLIST_DEFS.filter((def) => !getChecklistValue(data, def));

  return (
    <div className="space-y-5">
      {/* Score Hero */}
      <div
        className={`relative overflow-hidden rounded-2xl border-2 p-5 ${
          data.readiness_score >= 80
            ? "border-emerald-200 bg-gradient-to-br from-emerald-50 to-white"
            : data.readiness_score >= 60
            ? "border-amber-200 bg-gradient-to-br from-amber-50 to-white"
            : "border-red-200 bg-gradient-to-br from-red-50 to-white"
        }`}
      >
        <div className="flex items-center gap-5">
          <ScoreCircle score={data.readiness_score} size={88} />
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold text-slate-900">{data.branch_name}</h2>
            <span className={`mt-1.5 inline-flex items-center rounded-full border px-3 py-0.5 text-xs font-bold capitalize ${colors.badge}`}>
              {data.readiness_status.replace(/_/g, " ")}
            </span>
            <p className="mt-1.5 text-xs text-slate-500">
              {data.employee_count_active || data.employee_count} active employees
              {data.employee_count_left > 0 && <span className="ml-1 text-orange-600 font-medium">· {data.employee_count_left} leaving</span>}
              {" · "}{data.process_month}
            </p>
          </div>
          {data.branch_head_signoff && (
            <div className="flex-shrink-0 text-right">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" /> Signed Off
              </span>
              <p className="mt-1 text-[10px] text-slate-400">{fmtDateTime(data.branch_head_signoff_at)}</p>
            </div>
          )}
        </div>
      </div>

      {/* Blocked guidance */}
      {data.readiness_status === "blocked" && failingItems.length > 0 && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
          <div className="flex items-center gap-2 text-sm font-bold text-red-800">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            Payroll readiness is blocked. Complete to unblock:
          </div>
          <ul className="mt-2 space-y-1 text-xs text-red-700 list-disc list-inside">
            {failingItems.map((def) => <li key={String(def.key)}>{def.label}</li>)}
          </ul>
        </div>
      )}

      {/* Attendance freeze request */}
      {isBranchRole && !data.attendance_frozen && (
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-amber-900">Attendance not yet frozen</p>
            <p className="text-xs text-amber-700 mt-0.5">Notify the Payroll Head to freeze attendance once data is final.</p>
          </div>
          <Button size="sm" variant="outline"
            className="flex-shrink-0 rounded-xl border-amber-400 text-amber-800 hover:bg-amber-100"
            disabled={freezeRequestMutation.isPending} onClick={() => freezeRequestMutation.mutate()}>
            <Bell className="mr-1.5 h-3.5 w-3.5" />
            {freezeRequestMutation.isPending ? "Sending…" : "Request Freeze"}
          </Button>
        </div>
      )}

      {/* Checklist cards */}
      <div className="grid gap-3 sm:grid-cols-2">
        {CHECKLIST_DEFS.map((def) => {
          const ok = getChecklistValue(data, def);
          const display = getChecklistDisplay(data, def);
          const tsKey = def.timestampKey;
          const ts = tsKey ? (data[tsKey] as string | null) : null;
          const isManualField = def.key === "custom_deductions_uploaded" || def.key === "overtime_entered";

          return (
            <div
              key={String(def.key)}
              className={`flex items-start gap-3 rounded-2xl border-2 p-4 transition-colors ${
                ok
                  ? "border-emerald-200 bg-gradient-to-br from-emerald-50/60 to-white"
                  : "border-red-100 bg-gradient-to-br from-red-50/40 to-white"
              }`}
            >
              <div className={`mt-0.5 flex-shrink-0 rounded-xl p-1.5 ${ok ? "bg-emerald-100 text-emerald-600" : "bg-red-100 text-red-400"}`}>
                {ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-800">{def.label}</p>
                  {isManualField && (
                    <ManualToggleButton
                      branchId={data.branch_id} month={month}
                      fieldKey={def.key as "custom_deductions_uploaded" | "overtime_entered"}
                      currentValue={data[def.key as keyof BranchReadiness] as number}
                      label={def.label}
                    />
                  )}
                </div>
                {display && <p className="mt-0.5 text-xs font-medium text-slate-500">{display}</p>}
                {ts && <p className="mt-0.5 text-[10px] text-slate-400">Updated: {fmtDateTime(ts)}</p>}
                {!isManualField && !ok && (
                  <p className="mt-0.5 text-[11px] italic text-slate-400">Go to the relevant module to update</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Salary Projections */}
      {(data.projected_gross != null || data.projected_net != null) && (
        <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <IndianRupee className="h-4 w-4 text-slate-500" />
              <p className="text-sm font-bold text-slate-800">Salary Projections</p>
            </div>
            <Button size="icon" variant="ghost" className="h-7 w-7 rounded-xl"
              disabled={projectionMutation.isPending} onClick={() => projectionMutation.mutate()} title="Refresh">
              <RefreshCw className={`h-4 w-4 ${projectionMutation.isPending ? "animate-spin" : ""}`} />
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Projected Gross</p>
              <p className="mt-1 text-xl font-extrabold tabular-nums text-slate-900">{fmtCurrency(data.projected_gross)}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Projected Net</p>
              <p className="mt-1 text-xl font-extrabold tabular-nums text-emerald-700">{fmtCurrency(data.projected_net)}</p>
            </div>
          </div>
          {data.projection_computed_at && (
            <p className="mt-2 text-[10px] text-slate-400">Computed: {fmtDateTime(data.projection_computed_at)}</p>
          )}
        </div>
      )}

      {/* How It Works — process guide */}
      <Collapsible>
        <div className="rounded-lg border p-4 bg-blue-50/50">
          <CollapsibleTrigger className="flex items-center justify-between w-full text-sm font-medium text-blue-900">
            How Payroll Readiness Works
            <ChevronDown className="w-4 h-4 transition-transform [[data-state=open]_&]:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ol className="mt-3 space-y-2 text-xs text-blue-800 list-decimal list-inside">
              <li><strong>WFM finalizes attendance</strong> → Use "Request Freeze" above to notify Payroll Head</li>
              <li><strong>Branch Head / WFM uploads incentives</strong> in the Incentives module → status updates automatically</li>
              <li><strong>Branch Head marks</strong> "Custom Deductions" and "Overtime Entered" as done (toggle buttons above)</li>
              <li><strong>Bank details &amp; UAN %</strong> are computed from employee records — update in Employee profiles</li>
              <li><strong>NOC &amp; Holiday Work</strong> are resolved in their respective modules</li>
              <li><strong>Branch Head signs off</strong> when all items are green (attendance must be frozen first)</li>
              <li><strong>HO can override</strong> readiness status if needed (with mandatory reason)</li>
            </ol>
          </CollapsibleContent>
        </div>
      </Collapsible>

      {/* Sign-off button */}
      <div className="flex justify-end">
        {data.branch_head_signoff ? (
          <div className="flex items-center gap-2 text-emerald-700 text-sm font-medium">
            <CheckCircle2 className="w-4 h-4" />
            Signed off on {fmtDateTime(data.branch_head_signoff_at)}
            {data.branch_head_remarks && (
              <span className="text-muted-foreground italic font-normal">
                — "{data.branch_head_remarks}"
              </span>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-end gap-1">
            <Button
              disabled={!canSignOff}
              onClick={() => setSignOffOpen(true)}
            >
              <CheckCircle2 className="w-4 h-4 mr-2" />
              Sign Off Branch Ready
            </Button>
            {!data.attendance_frozen && (
              <p className="text-xs text-red-600">
                Attendance must be frozen before signing off
              </p>
            )}
          </div>
        )}
      </div>

      <SignOffDialog
        branch={data}
        open={signOffOpen}
        onClose={() => setSignOffOpen(false)}
        month={month}
      />
    </div>
  );
}

// ─── Stat Chip ──────────────────────────────────────────────────────────────────

function StatChip({
  label,
  value,
  accent = "slate",
}: {
  label: string;
  value: string | number;
  accent?: "slate" | "green" | "amber" | "red" | "blue";
}) {
  const accentMap: Record<string, { card: string; value: string; bar: string }> = {
    slate: { card: "border-slate-200 bg-white", value: "text-slate-800", bar: "bg-slate-300" },
    green: { card: "border-emerald-200 bg-emerald-50/60", value: "text-emerald-700", bar: "bg-emerald-400" },
    amber: { card: "border-amber-200 bg-amber-50/60", value: "text-amber-700", bar: "bg-amber-400" },
    red:   { card: "border-red-200 bg-red-50/60", value: "text-red-700", bar: "bg-red-400" },
    blue:  { card: "border-blue-200 bg-blue-50/60", value: "text-blue-700", bar: "bg-blue-400" },
  };
  const s = accentMap[accent];
  return (
    <div className={`relative overflow-hidden rounded-2xl border-2 px-4 py-3 shadow-sm transition-all hover:-translate-y-0.5 ${s.card}`}>
      <div className={`absolute bottom-0 left-0 right-0 h-0.5 ${s.bar}`} />
      <p className={`text-2xl font-extrabold tabular-nums leading-none ${s.value}`}>{value}</p>
      <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
    </div>
  );
}

// ─── HO View ───────────────────────────────────────────────────────────────────

function HOView({ month }: { month: string }) {
  const { roleKeys } = useWorkforceAccess();
  const canOverride =
    roleKeys.includes("payroll_head") || roleKeys.includes("super_admin");
  const canExport =
    canOverride || roleKeys.includes("admin");

  const [detailBranch, setDetailBranch] = useState<BranchReadiness | null>(null);
  const [overrideBranch, setOverrideBranch] = useState<BranchReadiness | null>(null);

  const { data: branches = [], isLoading, error, refetch } = useQuery<BranchReadiness[]>({
    queryKey: ["branch-readiness", month],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: BranchReadiness[] }>(
        `/api/payroll/branch-readiness/summary?month=${month}`
      );
      return res.data ?? [];
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const stats = useMemo(() => {
    const total = branches.length;
    const ready = branches.filter((b) => b.readiness_status === "ready").length;
    const inProgress = branches.filter((b) => b.readiness_status === "in_progress").length;
    const blocked = branches.filter((b) => b.readiness_status === "blocked").length;
    const notStarted = branches.filter((b) => b.readiness_status === "not_started").length;
    const avgScore =
      total > 0 ? Math.round(branches.reduce((s, b) => s + b.readiness_score, 0) / total) : 0;
    return { total, ready, inProgress, blocked, notStarted, avgScore };
  }, [branches]);

  const notFrozenCount = branches.filter((b) => !b.attendance_frozen).length;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex gap-3">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-16 flex-1" />
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-64" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <AlertTriangle className="w-8 h-8 mb-2" />
        <p>Failed to load readiness data.</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Warning banner */}
      {notFrozenCount > 0 && (
        <div className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-500" />
          <span>
            <strong>{notFrozenCount}</strong> branch{notFrozenCount > 1 ? "es" : ""} not attendance-frozen — payroll run creation will be blocked for{" "}
            {notFrozenCount > 1 ? "those branches" : "that branch"}.
          </span>
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatChip label="Total Branches" value={stats.total} accent="blue" />
        <StatChip label="Ready" value={stats.ready} accent="green" />
        <StatChip label="In Progress" value={stats.inProgress} accent="amber" />
        <StatChip label="Blocked" value={stats.blocked} accent="red" />
        <StatChip label="Not Started" value={stats.notStarted} accent="slate" />
        <StatChip label="Avg Score" value={`${stats.avgScore}%`} accent={stats.avgScore >= 80 ? "green" : stats.avgScore >= 60 ? "amber" : "red"} />
      </div>

      {/* Branch cards */}
      {branches.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Building2 className="w-8 h-8 mb-2" />
          <p>No branches found for {month}.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {branches.map((branch) => (
            <BranchCard
              key={branch.branch_id}
              branch={branch}
              onOpenDetail={setDetailBranch}
              onOverride={setOverrideBranch}
              canOverride={canOverride}
            />
          ))}
        </div>
      )}

      <DetailDrawer
        branch={detailBranch}
        open={!!detailBranch}
        onClose={() => setDetailBranch(null)}
        month={month}
      />

      <OverrideDialog
        branch={overrideBranch}
        open={!!overrideBranch}
        onClose={() => setOverrideBranch(null)}
        month={month}
      />
    </div>
  );
}

// ─── Root Page ──────────────────────────────────────────────────────────────────

export default function BranchPayrollReadiness() {
  const [month, setMonth] = useState(currentMonth);
  const { roleKeys, scopes, isLoading: roleLoading } = useWorkforceAccess();
  const qc = useQueryClient();

  const isHORole =
    roleKeys.includes("payroll_head") ||
    roleKeys.includes("super_admin") ||
    roleKeys.includes("payroll") ||
    roleKeys.includes("admin") ||
    roleKeys.includes("hr");

  const isBranchRole =
    !isHORole &&
    (roleKeys.includes("branch_head") || roleKeys.includes("payroll_branch"));

  const canExport =
    roleKeys.includes("payroll_head") ||
    roleKeys.includes("super_admin") ||
    roleKeys.includes("admin");

  // Determine branch_id for branch view from scopes
  const branchId = useMemo(() => {
    const branchScope = scopes.find((s) => s.branch_id);
    return branchScope?.branch_id ?? null;
  }, [scopes]);

  const handleRefreshAll = () => {
    qc.invalidateQueries({ queryKey: ["branch-readiness"] });
    toast.info("Refreshing readiness data…");
  };

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-7xl space-y-4 px-4 py-5 sm:px-5">
        {/* Hero Header */}
        <div
          className="relative overflow-hidden rounded-2xl p-5 sm:p-6"
          style={{
            background: "linear-gradient(135deg, #064e3b 0%, #065f46 50%, #047857 100%)",
            boxShadow: "0 8px 32px rgba(6,78,59,0.30)",
          }}
        >
          <div className="pointer-events-none absolute inset-0 opacity-10"
            style={{ backgroundImage: "radial-gradient(circle at 20% 50%, rgba(255,255,255,0.3) 0%, transparent 50%), radial-gradient(circle at 80% 20%, rgba(255,255,255,0.15) 0%, transparent 40%)" }} />
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-emerald-200" />
                <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-200">Payroll Operations</span>
              </div>
              <h1 className="mt-1.5 text-2xl font-extrabold tracking-tight text-white sm:text-3xl">Branch Payroll Readiness</h1>
              <p className="mt-1 text-sm text-emerald-100/80">Track payroll input completeness · attendance freeze · sign-off · projections</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
              <input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="h-10 rounded-xl border border-white/25 bg-white/10 px-3 text-sm text-white placeholder-white/50 backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-white/30"
              />
              {canExport && (
                <a href={`/api/payroll/branch-readiness/export?month=${month}&format=csv`} download={`branch-readiness-${month}.csv`}>
                  <Button variant="outline" size="sm" className="h-10 rounded-xl border-white/25 bg-white/10 text-white hover:bg-white/20">
                    <Download className="mr-1.5 h-4 w-4" /> Export CSV
                  </Button>
                </a>
              )}
              {(isHORole || isBranchRole) && (
                <Button variant="outline" size="sm" className="h-10 rounded-xl border-white/25 bg-white/10 text-white hover:bg-white/20" onClick={handleRefreshAll}>
                  <RefreshCw className="mr-1.5 h-4 w-4" /> Refresh
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Content */}
        {roleLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-64" />
            ))}
          </div>
        ) : isHORole ? (
          <HOView month={month} />
        ) : isBranchRole && branchId ? (
          <BranchView branchId={branchId} month={month} isBranchRole={isBranchRole} />
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <X className="w-8 h-8 mb-2" />
            <p>You do not have access to this page.</p>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
