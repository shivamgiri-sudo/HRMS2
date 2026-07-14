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
  return new Date(v).toLocaleString("en-IN", {
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
      <span className={`absolute text-sm font-bold tabular-nums ${colors.text}`}>{score}</span>
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
  if (def.key === "incentives_status") return branch.incentives_status.replace("_", " ");
  return null;
}

// ─── Branch Card (HO view) ─────────────────────────────────────────────────────

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
  const colors = getScoreColors(branch.readiness_score);

  return (
    <Card
      className="cursor-pointer hover:shadow-md transition-shadow border"
      onClick={() => onOpenDetail(branch)}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base leading-tight">{branch.branch_name}</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              {branch.employee_count_active || branch.employee_count} Active
              {branch.employee_count_left > 0 && <span className="text-orange-600"> · {branch.employee_count_left} Left (salary due)</span>}
            </p>
          </div>
          <ScoreCircle score={branch.readiness_score} size={56} />
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {/* Checklist icon row */}
        <div className="flex flex-wrap gap-1.5">
          {CHECKLIST_DEFS.map((def) => {
            const ok = getChecklistValue(branch, def);
            const display = getChecklistDisplay(branch, def);
            return (
              <div
                key={String(def.key)}
                title={def.label + (display ? ` (${display})` : "")}
                className={`flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded border ${
                  ok
                    ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                    : "bg-gray-50 border-gray-200 text-gray-400"
                }`}
              >
                {def.icon}
                {display && <span>{display}</span>}
                {!display && (ok ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />)}
              </div>
            );
          })}
        </div>

        {/* Projected salary */}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Projected Gross</span>
          <span className="font-medium text-foreground">{fmtCurrency(branch.projected_gross)}</span>
        </div>
        {branch.projected_net != null && (
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Projected Net</span>
            <span className="font-medium text-foreground">{fmtCurrency(branch.projected_net)}</span>
          </div>
        )}

        {/* Sign-off + override row */}
        <div
          className="flex items-center justify-between gap-2 pt-1"
          onClick={(e) => e.stopPropagation()}
        >
          <Badge
            variant="outline"
            className={
              branch.branch_head_signoff
                ? "text-emerald-700 bg-emerald-50 border-emerald-200"
                : "text-amber-700 bg-amber-50 border-amber-200"
            }
          >
            {branch.branch_head_signoff ? "Signed Off" : "Pending Sign-off"}
          </Badge>
          {canOverride && (
            <Button
              size="sm"
              variant="outline"
              className="text-xs h-7"
              onClick={(e) => {
                e.stopPropagation();
                onOverride(branch);
              }}
            >
              HO Override
            </Button>
          )}
        </div>

        <div className="flex items-center justify-end text-xs text-muted-foreground">
          <ChevronRight className="w-3.5 h-3.5" />
          <span>View details</span>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Detail Drawer ─────────────────────────────────────────────────────────────

function DetailDrawer({
  branch,
  open,
  onClose,
}: {
  branch: BranchReadiness | null;
  open: boolean;
  onClose: () => void;
}) {
  if (!branch) return null;
  const colors = getScoreColors(branch.readiness_score);

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-[420px] overflow-y-auto">
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
                {branch.readiness_status.replace("_", " ")}
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
            <p className="text-sm font-semibold">Salary Projections</p>
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

          {branch.ho_override_ready ? (
            <Badge
              variant="outline"
              className="text-blue-700 bg-blue-50 border-blue-200"
            >
              HO Override Applied
            </Badge>
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
            placeholder="Remarks (optional)"
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
            disabled={mutation.isPending}
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
  const mutation = useMutation({
    mutationFn: async (newVal: number) => {
      await hrmsApi.post(`/api/payroll/branch-readiness/${branchId}/checklist?month=${month}`, {
        item: fieldKey,
        value: newVal,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["branch-readiness"] });
    },
    onError: () => toast.error(`Failed to update ${label}`),
  });

  const isDone = Boolean(currentValue);
  return (
    <Button
      size="sm"
      variant={isDone ? "default" : "outline"}
      className={`text-xs h-7 ${isDone ? "bg-emerald-600 hover:bg-emerald-700 text-white" : ""}`}
      disabled={mutation.isPending}
      onClick={() => mutation.mutate(isDone ? 0 : 1)}
    >
      {mutation.isPending ? "…" : isDone ? "Mark as Pending" : "Mark as Done"}
    </Button>
  );
}

// ─── Branch View (single branch) ──────────────────────────────────────────────

function BranchView({
  branchId,
  month,
}: {
  branchId: string;
  month: string;
}) {
  const [signOffOpen, setSignOffOpen] = useState(false);

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

  return (
    <div className="space-y-6">
      {/* Score gauge */}
      <div className="flex items-center gap-6 p-6 rounded-xl border bg-card">
        <ScoreCircle score={data.readiness_score} size={96} />
        <div>
          <p className="text-lg font-semibold">{data.branch_name}</p>
          <Badge variant="outline" className={`mt-1 capitalize ${colors.badge}`}>
            {data.readiness_status.replace("_", " ")}
          </Badge>
          <p className="text-xs text-muted-foreground mt-1">
            {data.employee_count_active || data.employee_count} Active
            {data.employee_count_left > 0 && <span className="text-orange-600"> · {data.employee_count_left} Left (salary due)</span>}
            {" "}· {data.process_month}
          </p>
        </div>
        {data.branch_head_signoff && (
          <div className="ml-auto text-right">
            <Badge
              variant="outline"
              className="text-emerald-700 bg-emerald-50 border-emerald-200"
            >
              <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
              Signed Off
            </Badge>
            <p className="text-xs text-muted-foreground mt-1">
              {fmtDateTime(data.branch_head_signoff_at)}
            </p>
          </div>
        )}
      </div>

      {/* Checklist cards */}
      <div className="grid gap-3 sm:grid-cols-2">
        {CHECKLIST_DEFS.map((def) => {
          const ok = getChecklistValue(data, def);
          const display = getChecklistDisplay(data, def);
          const tsKey = def.timestampKey;
          const ts = tsKey ? (data[tsKey] as string | null) : null;
          const isManualField =
            def.key === "custom_deductions_uploaded" || def.key === "overtime_entered";

          return (
            <div
              key={String(def.key)}
              className={`p-4 rounded-lg border bg-card flex items-start gap-3 ${
                ok ? "border-emerald-200" : "border-gray-200"
              }`}
            >
              <div className={`mt-0.5 ${ok ? "text-emerald-600" : "text-gray-300"}`}>
                {ok ? (
                  <CheckCircle2 className="w-5 h-5" />
                ) : (
                  <XCircle className="w-5 h-5 text-red-300" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{def.label}</p>
                  {isManualField && (
                    <ManualToggleButton
                      branchId={data.branch_id}
                      month={month}
                      fieldKey={def.key as "custom_deductions_uploaded" | "overtime_entered"}
                      currentValue={data[def.key as keyof BranchReadiness] as number}
                      label={def.label}
                    />
                  )}
                </div>
                {display && <p className="text-xs text-muted-foreground">{display}</p>}
                {ts && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Updated: {fmtDateTime(ts)}
                  </p>
                )}
                {!isManualField && !ok && (
                  <p className="text-xs text-muted-foreground italic mt-0.5">
                    Go to the relevant module to update
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Projections */}
      {(data.projected_gross != null || data.projected_net != null) && (
        <div className="rounded-lg border p-4 grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Projected Gross</p>
            <p className="text-base font-semibold">{fmtCurrency(data.projected_gross)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Projected Net</p>
            <p className="text-base font-semibold">{fmtCurrency(data.projected_net)}</p>
          </div>
        </div>
      )}

      {/* How It Works — process guide */}
      <details className="rounded-lg border p-4 bg-blue-50/50">
        <summary className="text-sm font-medium cursor-pointer text-blue-900">How Payroll Readiness Works</summary>
        <ol className="mt-3 space-y-2 text-xs text-blue-800 list-decimal list-inside">
          <li><strong>WFM finalizes attendance</strong> → "Attendance Frozen" auto-detects from the system</li>
          <li><strong>Branch Head / WFM uploads incentives</strong> in the Incentives module → status updates automatically</li>
          <li><strong>Branch Head marks</strong> "Custom Deductions" and "Overtime Entered" as done (toggle buttons above)</li>
          <li><strong>Bank details &amp; UAN %</strong> are computed from employee records — update in Employee profiles</li>
          <li><strong>NOC &amp; Holiday Work</strong> are resolved in their respective modules</li>
          <li><strong>Branch Head signs off</strong> when all items are green (attendance must be frozen first)</li>
          <li><strong>HO can override</strong> readiness status if needed (with mandatory reason)</li>
        </ol>
      </details>

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
  colorClass = "",
}: {
  label: string;
  value: string | number;
  colorClass?: string;
}) {
  return (
    <div className={`flex flex-col items-center px-4 py-2 rounded-lg border bg-card ${colorClass}`}>
      <p className="text-xl font-bold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

// ─── HO View ───────────────────────────────────────────────────────────────────

function HOView({ month }: { month: string }) {
  const { roleKeys } = useWorkforceAccess();
  const canOverride =
    roleKeys.includes("payroll_head") || roleKeys.includes("super_admin");

  const [detailBranch, setDetailBranch] = useState<BranchReadiness | null>(null);
  const [overrideBranch, setOverrideBranch] = useState<BranchReadiness | null>(null);

  const qc = useQueryClient();

  const { data: branches = [], isLoading, error, refetch } = useQuery<BranchReadiness[]>({
    queryKey: ["branch-readiness", month],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: BranchReadiness[] }>(
        `/api/payroll/branch-readiness/summary?month=${month}`
      );
      return res.data ?? [];
    },
    staleTime: 60_000,
  });

  const stats = useMemo(() => {
    const total = branches.length;
    const ready = branches.filter((b) => b.readiness_status === "ready").length;
    const inProgress = branches.filter((b) => b.readiness_status === "in_progress").length;
    const blocked = branches.filter((b) => b.readiness_status === "blocked").length;
    const avgScore =
      total > 0 ? Math.round(branches.reduce((s, b) => s + b.readiness_score, 0) / total) : 0;
    return { total, ready, inProgress, blocked, avgScore };
  }, [branches]);

  const frozenCount = branches.filter((b) => !b.attendance_frozen).length;

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
      {frozenCount > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800 text-sm">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>
            <strong>{frozenCount}</strong> branch{frozenCount > 1 ? "es" : ""} not
            attendance-frozen — payroll run creation will be blocked for{" "}
            {frozenCount > 1 ? "those branches" : "that branch"}.
          </span>
        </div>
      )}

      {/* Stats row */}
      <div className="flex flex-wrap gap-3">
        <StatChip label="Total Branches" value={stats.total} />
        <StatChip
          label="Ready"
          value={stats.ready}
          colorClass="border-emerald-200 text-emerald-700"
        />
        <StatChip
          label="In Progress"
          value={stats.inProgress}
          colorClass="border-amber-200 text-amber-700"
        />
        <StatChip
          label="Blocked"
          value={stats.blocked}
          colorClass="border-red-200 text-red-700"
        />
        <StatChip label="Avg Score" value={stats.avgScore} />
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
      <div className="px-4 py-6 sm:px-6 lg:px-8 max-w-7xl mx-auto space-y-4">
        {/* Page header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Branch Payroll Readiness</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Track payroll input completeness across branches
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            {(isHORole || isBranchRole) && (
              <Button variant="outline" size="sm" onClick={handleRefreshAll}>
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                Refresh
              </Button>
            )}
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
          <BranchView branchId={branchId} month={month} />
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
