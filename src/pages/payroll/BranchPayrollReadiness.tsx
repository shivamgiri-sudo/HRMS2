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

/**
 * From payrollGovernanceService.readiness() (payroll-governance.service.ts) — the
 * comprehensive engine that actually gates payroll calculation (409s
 * POST /runs/:id/calculate on any blocker), covering attendance-finalized,
 * missing-punch, attendance-error, leave-sync, PAN/UAN, salary-structure and
 * statutory-config checks this page's own branch checklist does not. Org-wide
 * for the run (not attributable to an individual branch card — see the
 * backend helper's comment in payroll-branch-readiness.routes.ts), surfaced
 * here as read-only, informational: does not affect readiness_score/status.
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
 * (payroll-readiness-categories.service.ts) — the deeper, employee-level layer
 * underneath payrollGovernanceService: incentive/reimbursement/recovery/F&F/
 * payment-file, each check reporting PASS/FAIL/BLOCKED/NOT_APPLICABLE/
 * SOURCE_MISSING/CHECK_ERROR rather than blocker/warning. Answers a distinct
 * question from OrgWideGovernance — "may this run be PAID", not "may this run
 * be CALCULATED" — so a month can show canCalculate=true here and canPay=false.
 * Deliberately NOT merged into one score with the governance banner above: the
 * whole point of a layered gate is that the two can disagree.
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

interface BranchReadiness {
  branch_id: string;
  branch_name: string;
  /*
   * Process scope and the process-manager sign-off. Present on the API row
   * (payroll-branch-readiness.service.ts) and read throughout this page, but missing from this
   * interface — so the page was already using fields it claimed did not exist. Types copied from
   * the service rather than inferred: process_id is '' for the branch-level aggregate and a UUID
   * when process-scoped, and the sign-off flag is 0/1, not a boolean.
   */
  process_id: string;
  process_name: string;
  process_manager_signoff: number;
  process_manager_signoff_at: string | null;
  process_manager_signoff_by: string | null;
  process_manager_remarks: string | null;
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
  // ── WFM declares attendance data is complete (replaces freeze-before-run gate)
  {
    key: "attendance_data_ready",
    label: "Attendance Data Ready",
    icon: <CheckCircle2 className="w-4 h-4" />,
    timestampKey: "attendance_data_ready_at",
    isManual: true,
  },
  {
    key: "attendance_frozen",
    label: "Attendance Frozen (by Payroll Head)",
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

        {/* Click hint */}
        <div className="mt-2 flex items-center gap-1 text-[10px] text-slate-400">
          <Briefcase className="h-3 w-3" />
          <span>Click to view process-level breakdown</span>
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
            {canOverride && !Boolean(branch.ho_override_ready) && (
              <Button size="sm" variant="outline" className="h-7 rounded-xl text-xs"
                onClick={(e) => { e.stopPropagation(); onOverride(branch); }}>
                HO Override
              </Button>
            )}
            {Boolean(branch.ho_override_ready) && (
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

// ─── Process Row Card (inside detail drawer) ───────────────────────────────────

function ProcessReadinessRow({
  process,
  month,
  branchId,
}: {
  process: BranchReadiness;
  month: string;
  branchId: string;
}) {
  const qc = useQueryClient();
  const s = STATUS_CARD_STYLE[process.readiness_status] ?? STATUS_CARD_STYLE.not_started;
  const doneCount = CHECKLIST_DEFS.filter((def) => getChecklistValue(process, def)).length;
  const [signOffOpen, setSignOffOpen] = useState(false);
  const [remarks, setRemarks] = useState("");

  const toggleItem = useMutation({
    mutationFn: async ({ field, value }: { field: "custom_deductions_uploaded" | "overtime_entered"; value: number }) => {
      await hrmsApi.post(`/api/payroll/branch-readiness/${branchId}/${process.process_id}/checklist?month=${month}`, { item: field, value });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["branch-processes", branchId, month] });
      toast.success("Checklist updated");
    },
    onError: () => toast.error("Failed to update checklist"),
  });

  const signOff = useMutation({
    mutationFn: async () => {
      await hrmsApi.post(`/api/payroll/branch-readiness/${branchId}/${process.process_id}/signoff?month=${month}`, { remarks });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["branch-processes", branchId, month] });
      setSignOffOpen(false);
      setRemarks("");
      toast.success(`${process.process_name} signed off`);
    },
    onError: () => toast.error("Sign-off failed"),
  });

  return (
    <div className={`rounded-2xl border-2 overflow-hidden ${s.border}`}>
      {/* Process header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 bg-white">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-slate-900 truncate">{process.process_name || "Unnamed Process"}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {process.employee_count_active || process.employee_count || 0} active employees
          </p>
        </div>
        <div className="flex items-center gap-2.5 flex-shrink-0">
          <ScoreCircle score={process.readiness_score} size={44} />
          <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${s.badge}`}>
            {s.badgeText}
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1">
        <div className={`h-full ${s.accentBar}`} style={{ width: `${Math.round((doneCount / CHECKLIST_DEFS.length) * 100)}%` }} />
      </div>

      {/* Checklist pills */}
      <div className="flex flex-wrap gap-1.5 px-4 py-3 bg-slate-50/50">
        {CHECKLIST_DEFS.map((def) => {
          const ok = getChecklistValue(process, def);
          const display = getChecklistDisplay(process, def);
          const isManual = def.key === "custom_deductions_uploaded" || def.key === "overtime_entered";
          return (
            <div key={String(def.key)} className="flex items-center gap-1">
              <span
                title={def.label + (display ? ` (${display})` : "")}
                className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-medium ${
                  ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-400"
                }`}
              >
                {ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                {display ?? def.label.split(" ")[0]}
              </span>
              {isManual && !ok && (
                <button
                  type="button"
                  disabled={toggleItem.isPending}
                  onClick={() => toggleItem.mutate({ field: def.key as "custom_deductions_uploaded" | "overtime_entered", value: 1 })}
                  className="rounded-lg border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 hover:bg-blue-100 transition-colors"
                  title={`Mark ${def.label} as done`}
                >
                  Mark done
                </button>
              )}
              {isManual && ok && (
                <button
                  type="button"
                  disabled={toggleItem.isPending}
                  onClick={() => toggleItem.mutate({ field: def.key as "custom_deductions_uploaded" | "overtime_entered", value: 0 })}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-400 hover:bg-slate-50 transition-colors"
                  title={`Undo ${def.label}`}
                >
                  Undo
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Salary projections if available */}
      {(process.projected_gross != null || process.projected_net != null) && (
        <div className="grid grid-cols-2 divide-x divide-slate-100 border-t border-slate-100">
          <div className="px-4 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Gross</p>
            <p className="text-sm font-bold text-slate-800">{fmtCurrency(process.projected_gross)}</p>
          </div>
          <div className="px-4 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Net</p>
            <p className="text-sm font-bold text-emerald-700">{fmtCurrency(process.projected_net)}</p>
          </div>
        </div>
      )}

      {/* Process Manager Sign-off row */}
      <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-2.5 bg-white">
        <div className="text-xs text-slate-500">
          {process.process_manager_signoff ? (
            <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
              <CheckCircle2 className="h-3.5 w-3.5" />
              WFM signed off
              {process.process_manager_signoff_at && (
                <span className="font-normal text-slate-400 ml-1">{fmtDateTime(process.process_manager_signoff_at)}</span>
              )}
            </span>
          ) : (
            <span className="text-amber-600 font-medium">WFM sign-off pending</span>
          )}
        </div>
        {!process.process_manager_signoff && (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 transition-colors"
            onClick={() => setSignOffOpen(true)}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            WFM Sign-off
          </button>
        )}
      </div>

      {/* Sign-off dialog */}
      {signOffOpen && (
        <div className="border-t border-blue-100 bg-blue-50/50 px-4 py-3">
          <p className="text-xs font-semibold text-blue-800 mb-2">
            Confirm process readiness for <strong>{process.process_name}</strong>
          </p>
          <Textarea
            placeholder="Remarks (required) — confirm that attendance, incentives, deductions and overtime are complete for this process"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            rows={2}
            className="text-xs mb-2"
          />
          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setSignOffOpen(false); setRemarks(""); }}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs bg-blue-600 hover:bg-blue-700 text-white"
              disabled={!remarks.trim() || signOff.isPending}
              onClick={() => signOff.mutate()}
            >
              {signOff.isPending ? "Signing…" : "Confirm Sign-off"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Detail Drawer — with process-level breakdown ──────────────────────────────

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

  const processQuery = useQuery({
    queryKey: ["branch-processes", branch?.branch_id, month],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: BranchReadiness[]; summary: { total: number; ready: number; blocked: number; avg_score: number } }>(
        `/api/payroll/branch-readiness/${branch!.branch_id}/processes?month=${month}`
      );
      return res;
    },
    enabled: !!branch && open,
    staleTime: 30_000,
  });

  const projectionMutation = useMutation({
    mutationFn: async () => {
      if (!branch) return;
      await hrmsApi.get(`/api/payroll/branch-readiness/${branch.branch_id}/projection?month=${month}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["branch-readiness"] });
      toast.success("Projection refreshed");
    },
    onError: () => toast.error("Failed to refresh projection"),
  });

  if (!branch) return null;
  const colors = getScoreColors(branch.readiness_score);
  const processes = processQuery.data?.data ?? [];
  const procSummary = processQuery.data?.summary;

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:w-[600px] md:w-[680px] overflow-y-auto p-0">
        {/* Header */}
        <div
          className="sticky top-0 z-10 px-5 pt-5 pb-4"
          style={{
            background: "linear-gradient(135deg, #073f78 0%, #1B6AB5 100%)",
            boxShadow: "0 4px 16px rgba(7,63,120,0.2)",
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-wider text-blue-200">Branch Detail</p>
              <h2 className="mt-0.5 text-xl font-extrabold text-white truncate">{branch.branch_name}</h2>
              <p className="mt-0.5 text-xs text-blue-200">
                {branch.employee_count_active || branch.employee_count} active · {month}
              </p>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              <ScoreCircle score={branch.readiness_score} size={56} />
              <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-bold capitalize backdrop-blur-sm ${colors.badge}`}>
                {branch.readiness_status.replace(/_/g, " ")}
              </span>
            </div>
          </div>

          {/* Branch-level projections in header */}
          {(branch.projected_gross != null || branch.projected_net != null) && (
            <div className="mt-3 flex items-center gap-4 rounded-xl bg-white/10 px-4 py-2">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-blue-200">Branch Gross</p>
                <p className="text-sm font-bold text-white">{fmtCurrency(branch.projected_gross)}</p>
              </div>
              <div className="h-8 w-px bg-white/20" />
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-blue-200">Branch Net</p>
                <p className="text-sm font-bold text-emerald-300">{fmtCurrency(branch.projected_net)}</p>
              </div>
              <button
                type="button"
                className="ml-auto rounded-lg p-1.5 text-blue-200 hover:bg-white/10 transition-colors"
                onClick={() => projectionMutation.mutate()}
                disabled={projectionMutation.isPending}
                title="Refresh projection"
              >
                <RefreshCw className={`h-4 w-4 ${projectionMutation.isPending ? "animate-spin" : ""}`} />
              </button>
            </div>
          )}
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Process summary strip */}
          {procSummary && procSummary.total > 0 && (
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: "Total", value: procSummary.total, cls: "border-slate-200 text-slate-700" },
                { label: "Ready", value: procSummary.ready, cls: "border-emerald-200 text-emerald-700 bg-emerald-50/60" },
                { label: "Blocked", value: procSummary.blocked, cls: "border-red-200 text-red-700 bg-red-50/60" },
                { label: "Avg Score", value: `${procSummary.avg_score}%`, cls: procSummary.avg_score >= 80 ? "border-emerald-200 text-emerald-700 bg-emerald-50/60" : procSummary.avg_score >= 50 ? "border-amber-200 text-amber-700 bg-amber-50/60" : "border-red-200 text-red-700 bg-red-50/60" },
              ].map((item) => (
                <div key={item.label} className={`rounded-xl border-2 px-3 py-2 text-center ${item.cls}`}>
                  <p className="text-lg font-extrabold leading-none">{item.value}</p>
                  <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider opacity-70">{item.label}</p>
                </div>
              ))}
            </div>
          )}

          {/* Processes */}
          {processQuery.isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-28 rounded-2xl bg-slate-100 animate-pulse" />
              ))}
            </div>
          ) : processes.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 py-12 text-center">
              <Briefcase className="h-10 w-10 text-slate-300 mb-3" />
              <p className="text-sm font-semibold text-slate-500">No processes found for this branch</p>
              <p className="text-xs text-slate-400 mt-1">Processes must be configured in the process master</p>
            </div>
          ) : (
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                <Briefcase className="h-4 w-4 text-slate-400" />
                Process-Level Readiness
                <span className="ml-auto text-[11px] font-normal text-slate-400">{processes.length} process{processes.length !== 1 ? "es" : ""}</span>
              </h3>
              {processes.map((proc) => (
                <ProcessReadinessRow
                  key={proc.process_id || proc.process_name}
                  process={proc}
                  month={month}
                  branchId={branch.branch_id}
                />
              ))}
            </div>
          )}

          {/* Branch-level sign-off & override */}
          <div className="rounded-2xl border-2 border-slate-200 overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-100">
              <p className="text-sm font-bold text-slate-700">Branch Sign-off & Governance</p>
            </div>
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600">Branch Head Sign-off</span>
                {branch.branch_head_signoff ? (
                  <div className="text-right">
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
                      <CheckCircle2 className="h-3 w-3" /> Signed Off
                    </span>
                    <p className="mt-0.5 text-[10px] text-slate-400">{fmtDateTime(branch.branch_head_signoff_at)}</p>
                  </div>
                ) : (
                  <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">
                    Pending
                  </span>
                )}
              </div>
              {Boolean(branch.ho_override_ready) && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-600">HO Override</span>
                  <div className="text-right">
                    <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
                      <CheckCircle2 className="h-3 w-3" /> Applied
                    </span>
                    {branch.ho_override_reason && (
                      <p className="mt-0.5 text-[10px] text-slate-400 italic">{branch.ho_override_reason}</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
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
  fieldKey: "attendance_data_ready" | "custom_deductions_uploaded" | "overtime_entered";
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
  canBranchHeadSignOff,
}: {
  branchId: string;
  month: string;
  isBranchRole: boolean;
  canBranchHeadSignOff: boolean;
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
  // Fixed: require attendance_data_ready (WFM declaration) not attendance_frozen
  // (which needs a payroll run to exist first — a chicken-and-egg impossible state).
  const canSignOff = Boolean(data.attendance_data_ready) && !data.branch_head_signoff;

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

      {/* Step 1: WFM declares attendance data is ready */}
      {isBranchRole && !data.attendance_data_ready && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 space-y-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-700 flex-shrink-0" />
            <p className="text-sm font-semibold text-amber-900">Mark attendance data as ready</p>
          </div>
          <p className="text-xs text-amber-700">
            Once you have validated attendance, resolved missing punches, uploaded incentives and deductions —
            mark attendance data as ready. This enables Branch Head sign-off.
          </p>
        </div>
      )}
      {/* Step 2: After data is ready, request Payroll Head to freeze */}
      {isBranchRole && data.attendance_data_ready && !data.attendance_frozen && (
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-blue-900">Request attendance freeze</p>
            <p className="text-xs text-blue-700 mt-0.5">Attendance data is ready. Notify Payroll Head to freeze it.</p>
          </div>
          <Button size="sm" variant="outline"
            className="flex-shrink-0 rounded-xl border-blue-400 text-blue-800 hover:bg-blue-100"
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
                      fieldKey={def.key as "attendance_data_ready" | "custom_deductions_uploaded" | "overtime_entered"}
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
        ) : canBranchHeadSignOff ? (
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
        ) : (
          <p className="text-xs text-slate-500">
            Awaiting Branch Head sign-off
            {!data.attendance_frozen && " — attendance must be frozen first"}
          </p>
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

/**
 * Surfaces payrollGovernanceService's org-wide blockers/warnings — the checks that
 * actually gate calculation but this page's own per-branch checklist doesn't cover
 * (PAN/UAN validity, attendance errors, salary structure, statutory config). See
 * the OrgWideGovernance type doc for why this is org-wide rather than per-branch.
 */
function GovernanceBanner({ governance }: { governance: OrgWideGovernance }) {
  const [expanded, setExpanded] = useState(false);

  if (governance.status === "not_created") {
    // No salary_prep_run exists yet for this month — nothing to check against.
    // Distinct from "checked, zero issues": this is CONFIGURATION_MISSING, not PASS.
    return null;
  }

  if (governance.status === "error") {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-700">
        <AlertTriangle className="h-4 w-4 flex-shrink-0 text-slate-500" />
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
    <div className={`rounded-2xl border px-4 py-3 text-sm ${blockers > 0 ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 text-left"
      >
        <AlertTriangle className={`h-4 w-4 flex-shrink-0 ${blockers > 0 ? "text-red-500" : "text-amber-500"}`} />
        <span className="flex-1">
          <strong>Compliance/statutory checks: {canCalculate ? "WARNING" : "FAIL"}</strong> — org-wide
          for this month's run, not per-branch: <strong>{blockers}</strong> blocker{blockers === 1 ? "" : "s"},{" "}
          <strong>{warnings}</strong> warning{warnings === 1 ? "" : "s"}
          {!canCalculate && " — payroll calculation is currently blocked"}.
        </span>
        <span className="text-xs underline">{expanded ? "Hide" : "View"} details</span>
      </button>
      {expanded && (
        <ul className="mt-3 space-y-1.5 border-t border-current/20 pt-3">
          {issues.map((issue) => (
            <li key={issue.code} className="flex items-start gap-2 text-xs">
              <span
                className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 font-bold uppercase ${
                  issue.severity === "blocker" ? "bg-red-200 text-red-800" : "bg-amber-200 text-amber-800"
                }`}
              >
                {issue.severity}
              </span>
              <span>
                <strong>{issue.count}</strong> — {issue.message}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Surfaces the payment-readiness depth layer alongside GovernanceBanner. The two
 * are shown separately, not blended: a month can be "calculation technically
 * available" (governance PASS) while simultaneously "NOT READY FOR PAYMENT"
 * (canPay=false) — that distinction is the reason this is its own banner.
 */
function PaymentReadinessBanner({ readiness }: { readiness: PaymentReadinessCategories }) {
  const [expanded, setExpanded] = useState(false);

  if (readiness.status === "not_created") return null;

  if (readiness.status === "error") {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-700">
        <AlertTriangle className="h-4 w-4 flex-shrink-0 text-slate-500" />
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
    <div className={`rounded-2xl border px-4 py-3 text-sm ${!canPay ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
      <button type="button" onClick={() => setExpanded((v) => !v)} className="flex w-full items-center gap-3 text-left">
        <AlertTriangle className={`h-4 w-4 flex-shrink-0 ${!canPay ? "text-red-500" : "text-amber-500"}`} />
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
                  className={`rounded px-2 py-1 text-[11px] font-semibold uppercase ${
                    l.state === "SOURCE_MISSING"
                      ? "bg-slate-200 text-slate-700"
                      : l.p0 > 0
                        ? "bg-red-200 text-red-800"
                        : "bg-amber-200 text-amber-800"
                  }`}
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
                  className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 font-bold uppercase ${
                    c.state === "SOURCE_MISSING"
                      ? "bg-slate-200 text-slate-700"
                      : c.state === "CHECK_ERROR"
                        ? "bg-red-300 text-red-900"
                        : c.severity === "P0"
                          ? "bg-red-200 text-red-800"
                          : c.severity === "P1"
                            ? "bg-amber-200 text-amber-800"
                            : "bg-slate-100 text-slate-600"
                  }`}
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

  const { data: summaryRes, isLoading, error, refetch } = useQuery<{
    data: BranchReadiness[];
    governance: OrgWideGovernance;
  }>({
    queryKey: ["branch-readiness", month],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: BranchReadiness[]; governance: OrgWideGovernance }>(
        `/api/payroll/branch-readiness/summary?month=${month}`
      );
      return { data: res.data ?? [], governance: res.governance ?? { status: "not_created" } };
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
  const branches = summaryRes?.data ?? [];
  const governance = summaryRes?.governance ?? { status: "not_created" as const };

  const { data: paymentReadiness } = useQuery<PaymentReadinessCategories>({
    queryKey: ["payment-readiness-categories", month],
    queryFn: async () => {
      try {
        const res = await hrmsApi.get<{ success: boolean; status: string; data: Omit<Extract<PaymentReadinessCategories, { status: "checked" }>, "status"> | null }>(
          `/api/payroll/readiness-categories/month/${month}`
        );
        if (res.status === "not_created" || !res.data) return { status: "not_created" as const };
        return { status: "checked" as const, ...res.data };
      } catch (err) {
        // The route 503s (never 200-with-empty-body) on a check failure — surface
        // that as NOT CHECKED, never silently drop it to "not_created".
        return { status: "error" as const, message: err instanceof Error ? err.message : "Payment readiness check failed" };
      }
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
    retry: false,
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

  const notFrozenCount     = branches.filter((b) => !b.attendance_frozen).length;
  const notReadyCount      = branches.filter((b) => !b.attendance_data_ready).length;
  const allBranchesReady   = stats.total > 0 && stats.ready === stats.total;
  const majorityReady      = stats.total > 0 && stats.ready >= Math.ceil(stats.total * 0.8);

  const startRunMutation = useMutation({
    mutationFn: async () => {
      await hrmsApi.post(`/api/payroll/runs`, { run_month: month });
    },
    onSuccess: () => {
      toast.success(`Payroll run for ${month} created. You can now calculate salaries.`);
      refetch();
    },
    onError: (err: unknown) => {
      toast.error((err as Error)?.message ?? "Failed to create payroll run");
    },
  });

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
      {/* All branches ready — Start Payroll Run CTA */}
      {canOverride && (allBranchesReady || majorityReady) && (
        <div className={`flex items-center justify-between gap-4 rounded-2xl border px-4 py-3
          ${allBranchesReady
            ? "border-emerald-200 bg-emerald-50"
            : "border-blue-200 bg-blue-50"}`}>
          <div>
            <p className={`text-sm font-semibold ${allBranchesReady ? "text-emerald-900" : "text-blue-900"}`}>
              {allBranchesReady
                ? `All ${stats.total} branches ready — start payroll processing`
                : `${stats.ready} of ${stats.total} branches ready (${Math.round(stats.ready / stats.total * 100)}%)`}
            </p>
            <p className={`text-xs mt-0.5 ${allBranchesReady ? "text-emerald-700" : "text-blue-700"}`}>
              {allBranchesReady
                ? "Create the payroll run to begin salary calculation."
                : "You can start now or wait for remaining branches to sign off."}
            </p>
          </div>
          <Button
            size="sm"
            className={`flex-shrink-0 ${allBranchesReady ? "bg-emerald-700 hover:bg-emerald-800" : ""}`}
            disabled={startRunMutation.isPending}
            onClick={() => startRunMutation.mutate()}
          >
            <IndianRupee className="mr-1.5 h-3.5 w-3.5" />
            {startRunMutation.isPending ? "Creating…" : "Start Payroll Run"}
          </Button>
        </div>
      )}

      {/* Attendance data ready warning */}
      {notReadyCount > 0 && (
        <div className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-500" />
          <span>
            <strong>{notReadyCount}</strong> branch{notReadyCount > 1 ? "es have" : " has"} not marked attendance data as ready — WFM must complete validation first.
          </span>
        </div>
      )}

      {/* Freeze reminder */}
      {notFrozenCount > 0 && notReadyCount === 0 && (
        <div className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          <Lock className="h-4 w-4 flex-shrink-0 text-blue-500" />
          <span>
            <strong>{notFrozenCount}</strong> branch{notFrozenCount > 1 ? "es" : ""} not yet attendance-frozen.
            Freeze attendance before running payroll calculation to lock the data.
          </span>
        </div>
      )}

      <GovernanceBanner governance={governance} />
      <PaymentReadinessBanner readiness={paymentReadiness ?? { status: "not_created" }} />

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
    (roleKeys.includes("branch_head") || roleKeys.includes("payroll_branch") || roleKeys.includes("wfm"));

  const canBranchHeadSignOff = roleKeys.includes("branch_head");

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
          <BranchView branchId={branchId} month={month} isBranchRole={isBranchRole} canBranchHeadSignOff={canBranchHeadSignOff} />
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
