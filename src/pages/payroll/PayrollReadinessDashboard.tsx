/**
 * Payroll Readiness Dashboard — /payroll/readiness
 *
 * Merged hub combining Branch Payroll Readiness and Process Payroll Readiness
 * into a single URL-param-driven surface.
 * Activate scope via ?scope=branch (default) or ?scope=process.
 *
 * Branch scope: HO sees all branches with checklist progress, sign-off status,
 * and HO override capability. Branch roles see their own branch.
 *
 * Process scope: HO sees grouped branch→process accordion view. Branch Head sees
 * processes in their branch. Process Manager/WFM sees their assigned processes.
 */
import { useState, useMemo, useEffect } from "react";
import { useSearchParams, Link } from "react-router-dom";
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
  Calendar,
  Layers,
  AlertCircle,
  Info,
} from "lucide-react";
import { toast } from "sonner";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { useAuth } from "@/contexts/AuthContext";
import { hrmsApi } from "@/lib/hrmsApi";
import { cn } from "@/lib/utils";
import WorkforcePageGate from "@/components/security/WorkforcePageGate";

// ─── Types ─────────────────────────────────────────────────────────────────────

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
  process_id: string;
  process_name: string;
  process_manager_signoff: number;
  process_manager_signoff_at: string | null;
  process_manager_signoff_by: string | null;
  process_manager_remarks: string | null;
  process_month: string;
  attendance_frozen: number;
  attendance_frozen_at: string | null;
  attendance_data_ready?: number;
  attendance_data_ready_at?: string | null;
  incentives_status: "not_uploaded" | "uploaded" | "approved";
  // Outstanding work behind the manual attestations (backend migration 1643). Optional so an
  // older backend response cannot crash the page. REPORTING ONLY - these never affect the score.
  pending_leave_count?: number;
  pending_regularization_count?: number;
  employees_without_attendance?: number;
  incentive_batch_status?: string | null;
  custom_deductions_uploaded: number;
  overtime_entered: number;
  leave_finalized: number;
  leave_finalized_at: string | null;
  regularization_complete: number;
  regularization_complete_at: string | null;
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
  // Outstanding work behind the manual attestations (backend migration 1643). Optional so an
  // older backend response cannot crash the page. REPORTING ONLY - these never affect the score.
  pending_leave_count?: number;
  pending_regularization_count?: number;
  employees_without_attendance?: number;
  incentive_batch_status?: string | null;
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
  return new Date(v.replace(" ", "T")).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDate(v: string | null) {
  if (!v) return "—";
  return new Date(v.replace(" ", "T")).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
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

// ─── KPI Tile ──────────────────────────────────────────────────────────────────

type KpiTone = "blue" | "green" | "amber" | "red" | "violet" | "slate";

const TONE_STYLES: Record<KpiTone, { bg: string; border: string; value: string; bar: string }> = {
  blue:   { bg: "bg-blue-50/60",    border: "border-blue-200",    value: "text-blue-700",    bar: "bg-blue-400" },
  green:  { bg: "bg-emerald-50/60", border: "border-emerald-200", value: "text-emerald-700", bar: "bg-emerald-400" },
  amber:  { bg: "bg-amber-50/60",   border: "border-amber-200",   value: "text-amber-700",   bar: "bg-amber-400" },
  red:    { bg: "bg-red-50/60",     border: "border-red-200",     value: "text-red-700",     bar: "bg-red-400" },
  violet: { bg: "bg-violet-50/60",  border: "border-violet-200",  value: "text-violet-700",  bar: "bg-violet-400" },
  slate:  { bg: "bg-slate-50/60",   border: "border-slate-200",   value: "text-slate-700",   bar: "bg-slate-300" },
};

function KpiTile({ label, value, tone = "slate" }: { label: string; value: string | number; tone?: KpiTone }) {
  const s = TONE_STYLES[tone];
  return (
    <div className={cn("relative overflow-hidden rounded-2xl border-2 px-4 py-3 shadow-sm transition-all hover:-translate-y-0.5", s.bg, s.border)}>
      <div className={cn("absolute bottom-0 left-0 right-0 h-0.5", s.bar)} />
      <p className={cn("text-2xl font-extrabold tabular-nums leading-none", s.value)}>{value}</p>
      <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
    </div>
  );
}

// ─── Status Badge ──────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  ready:       { label: "Ready",       color: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  in_progress: { label: "In Progress", color: "bg-amber-100 text-amber-800 border-amber-200" },
  blocked:     { label: "Blocked",     color: "bg-rose-100 text-rose-800 border-rose-200" },
  not_started: { label: "Not Started", color: "bg-slate-100 text-slate-700 border-slate-200" },
};

function StatusBadge({ status }: { status: string }) {
  const { label, color } = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.not_started;
  return <Badge className={cn("border text-xs font-medium", color)}>{label}</Badge>;
}

// ─── Governance Banner ─────────────────────────────────────────────────────────

function GovernanceBanner({ governance }: { governance: OrgWideGovernance }) {
  const [expanded, setExpanded] = useState(false);

  if (governance.status === "not_created") return null;

  if (governance.status === "error") {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-700">
        <AlertTriangle className="h-4 w-4 flex-shrink-0 text-slate-500" />
        <span>
          <strong>Compliance/statutory checks: NOT CHECKED</strong> — the governance engine failed to run.
        </span>
      </div>
    );
  }

  const { blockers, warnings, issues, canCalculate } = governance;
  if (blockers === 0 && warnings === 0) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-emerald-500" />
        <span><strong>Compliance/statutory checks: PASS</strong></span>
      </div>
    );
  }

  return (
    <div className={cn("rounded-2xl border px-4 py-3 text-sm", blockers > 0 ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-800")}>
      <button type="button" onClick={() => setExpanded((v) => !v)} className="flex w-full items-center gap-3 text-left">
        <AlertTriangle className={cn("h-4 w-4 flex-shrink-0", blockers > 0 ? "text-red-500" : "text-amber-500")} />
        <span className="flex-1">
          <strong>Compliance checks: {canCalculate ? "WARNING" : "FAIL"}</strong> — <strong>{blockers}</strong> blocker{blockers === 1 ? "" : "s"}, <strong>{warnings}</strong> warning{warnings === 1 ? "" : "s"}
          {!canCalculate && " — payroll calculation blocked"}.
        </span>
        <span className="text-xs underline">{expanded ? "Hide" : "View"}</span>
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

// ─── Payment Readiness Banner ──────────────────────────────────────────────────

function PaymentReadinessBanner({ readiness }: { readiness: PaymentReadinessCategories }) {
  const [expanded, setExpanded] = useState(false);

  if (readiness.status === "not_created") return null;

  if (readiness.status === "error") {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-700">
        <AlertCircle className="h-4 w-4 flex-shrink-0 text-slate-500" />
        <span><strong>Payment readiness: NOT CHECKED</strong> — {readiness.message}</span>
      </div>
    );
  }

  const { canPay, canPayBlockedBy, summary, layers, checks, evaluatedAt, governanceVersion } = readiness;
  const notGreenChecks = checks.filter((c) => c.state !== "PASS" && c.state !== "NOT_APPLICABLE");

  if (canPay && summary.p0 === 0 && summary.p1 === 0 && summary.sourceMissing === 0 && summary.checkErrors === 0) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-emerald-500" />
        <span><strong>Payment readiness: READY TO PAY</strong></span>
      </div>
    );
  }

  return (
    <div className={cn("rounded-2xl border px-4 py-3 text-sm", !canPay ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-800")}>
      <button type="button" onClick={() => setExpanded((v) => !v)} className="flex w-full items-center gap-3 text-left">
        <AlertCircle className={cn("h-4 w-4 flex-shrink-0", !canPay ? "text-red-500" : "text-amber-500")} />
        <span className="flex-1">
          <strong>Payment readiness: {canPay ? "WARNING" : "NOT READY"}</strong> — <strong>{summary.p0}</strong> P0, <strong>{summary.p1}</strong> P1
          {!canPay && canPayBlockedBy.length > 0 && ` — blocked by ${canPayBlockedBy.join(", ")}`}.
        </span>
        <span className="text-xs underline">{expanded ? "Hide" : "View"}</span>
      </button>
      {expanded && (
        <ul className="mt-3 space-y-1.5 border-t border-current/20 pt-3">
          {notGreenChecks.map((c) => (
            <li key={c.code} className="flex items-start gap-2 text-xs">
              <span className={cn("mt-0.5 shrink-0 rounded px-1.5 py-0.5 font-bold uppercase",
                c.state === "SOURCE_MISSING" ? "bg-slate-200 text-slate-700" :
                c.severity === "P0" ? "bg-red-200 text-red-800" : "bg-amber-200 text-amber-800"
              )}>
                {c.state === "FAIL" ? c.severity : c.state}
              </span>
              <span>{c.affectedEmployees > 0 && <><strong>{c.affectedEmployees}</strong> — </>}{c.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// BRANCH SCOPE COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

const STATUS_CARD_STYLE: Record<string, { border: string; accentBar: string; badge: string; badgeText: string }> = {
  ready:       { border: "border-emerald-200", accentBar: "bg-emerald-400", badge: "bg-emerald-100 text-emerald-700 border-emerald-200", badgeText: "Ready" },
  in_progress: { border: "border-amber-200",   accentBar: "bg-amber-400",   badge: "bg-amber-100 text-amber-700 border-amber-200",       badgeText: "In Progress" },
  blocked:     { border: "border-red-200",     accentBar: "bg-red-400",     badge: "bg-red-100 text-red-700 border-red-200",             badgeText: "Blocked" },
  not_started: { border: "border-slate-200",   accentBar: "bg-slate-300",   badge: "bg-slate-100 text-slate-500 border-slate-200",       badgeText: "Not Started" },
};

interface ChecklistDef {
  key: string;
  label: string;
  isPercent?: boolean;
}

const BRANCH_CHECKLIST_DEFS: ChecklistDef[] = [
  { key: "attendance_frozen", label: "Attendance Frozen" },
  { key: "incentives_status", label: "Incentives Approved" },
  { key: "leave_finalized", label: "Leaves Finalized" },
  { key: "regularization_complete", label: "Regularizations" },
  { key: "custom_deductions_uploaded", label: "Custom Deductions" },
  { key: "overtime_entered", label: "Overtime" },
  { key: "bank_details_pct", label: "Bank Details", isPercent: true },
  { key: "uan_complete_pct", label: "UAN", isPercent: true },
  { key: "noc_resolved", label: "NOC" },
  { key: "holiday_work_approved", label: "Holiday Work" },
];

function getChecklistValue(branch: BranchReadiness, def: ChecklistDef): boolean {
  if (def.key === "incentives_status") return branch.incentives_status === "approved";
  if (def.isPercent) {
    const val = branch[def.key as keyof BranchReadiness] as number;
    return val >= 100;
  }
  return Boolean(branch[def.key as keyof BranchReadiness]);
}

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
  const doneCount = BRANCH_CHECKLIST_DEFS.filter((def) => getChecklistValue(branch, def)).length;
  const totalCount = BRANCH_CHECKLIST_DEFS.length;

  return (
    <div
      className={`group relative cursor-pointer overflow-hidden rounded-2xl border-2 bg-white shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg ${s.border}`}
      onClick={() => onOpenDetail(branch)}
    >
      <div className={`absolute left-0 top-0 h-full w-1 ${s.accentBar}`} />

      <div className="pl-4 pr-4 pt-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-base font-bold leading-tight text-slate-900">{branch.branch_name}</h3>
            <p className="mt-0.5 text-xs text-slate-400">
              {branch.employee_count_active || branch.employee_count} active
              {branch.employee_count_left > 0 && (
                <span className="ml-1 text-orange-600 font-medium">· {branch.employee_count_left} left</span>
              )}
            </p>
          </div>
          <ScoreCircle score={branch.readiness_score} size={52} />
        </div>

        <div className="mt-3 flex items-center justify-between gap-2">
          <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${s.badge}`}>
            {s.badgeText}
          </span>
          <span className="text-[11px] text-slate-400">{doneCount}/{totalCount} checks</span>
        </div>

        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div className={`h-full rounded-full transition-all ${s.accentBar}`} style={{ width: `${Math.round((doneCount / totalCount) * 100)}%` }} />
        </div>

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

function BranchOverrideDialog({
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
      await hrmsApi.post(`/api/payroll/branch-readiness/${branch.branch_id}/ho-override`, { month, reason });
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
          <Textarea placeholder="Reason for override (required)" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={!reason.trim() || mutation.isPending}>
            {mutation.isPending ? "Applying…" : "Apply Override"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BranchDetailDrawer({
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

  if (!branch) return null;
  const colors = getScoreColors(branch.readiness_score);
  const processes = processQuery.data?.data ?? [];

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:w-[600px] overflow-y-auto p-0">
        <div className="sticky top-0 z-10 px-5 pt-5 pb-4 bg-gradient-to-br from-teal-600 via-cyan-600 to-blue-700">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-wider text-teal-200">Branch Detail</p>
              <h2 className="mt-0.5 text-xl font-extrabold text-white truncate">{branch.branch_name}</h2>
              <p className="mt-0.5 text-xs text-teal-200">{branch.employee_count_active || branch.employee_count} active · {month}</p>
            </div>
            <ScoreCircle score={branch.readiness_score} size={56} />
          </div>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* The HO route into the same cost-centre sign-off the branch uses — the Payroll Head's
              final approval happens on that screen, one cost centre at a time. */}
          <Button variant="outline" className="w-full rounded-xl" asChild>
            <Link to={`/payroll/readiness/cost-centres?branchId=${branch.branch_id}&month=${month}`}>
              <Layers className="mr-1.5 h-4 w-4" /> Cost-Centre Attendance Sign-Off
            </Link>
          </Button>

          {processQuery.isLoading ? (
            <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-28 rounded-2xl bg-slate-100 animate-pulse" />)}</div>
          ) : processes.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 py-12 text-center">
              <Briefcase className="h-10 w-10 text-slate-300 mb-3" />
              <p className="text-sm font-semibold text-slate-500">No processes found for this branch</p>
            </div>
          ) : (
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                <Briefcase className="h-4 w-4 text-slate-400" />
                Process-Level Readiness
              </h3>
              {processes.map((proc) => {
                const ps = STATUS_CARD_STYLE[proc.readiness_status] ?? STATUS_CARD_STYLE.not_started;
                return (
                  <div key={proc.process_id || proc.process_name} className={`rounded-2xl border-2 overflow-hidden ${ps.border}`}>
                    <div className="flex items-center justify-between gap-3 px-4 py-3 bg-white">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-slate-900 truncate">{proc.process_name || "Unnamed Process"}</p>
                        <p className="text-[11px] text-slate-400 mt-0.5">{proc.employee_count_active || proc.employee_count || 0} employees</p>
                      </div>
                      <div className="flex items-center gap-2.5 flex-shrink-0">
                        <ScoreCircle score={proc.readiness_score} size={44} />
                        <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${ps.badge}`}>{ps.badgeText}</span>
                      </div>
                    </div>
                    <div className="h-1"><div className={`h-full ${ps.accentBar}`} style={{ width: `${proc.readiness_score}%` }} /></div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function BranchScopeHOView({ month }: { month: string }) {
  const { roleKeys } = useWorkforceAccess();
  const canOverride = roleKeys.includes("payroll_head") || roleKeys.includes("super_admin");
  const canExport = canOverride || roleKeys.includes("admin");

  const [detailBranch, setDetailBranch] = useState<BranchReadiness | null>(null);
  const [overrideBranch, setOverrideBranch] = useState<BranchReadiness | null>(null);

  const { data: summaryRes, isLoading, refetch } = useQuery<{ data: BranchReadiness[]; governance: OrgWideGovernance }>({
    queryKey: ["branch-readiness", month],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: BranchReadiness[]; governance: OrgWideGovernance }>(
        `/api/payroll/branch-readiness/summary?month=${month}`
      );
      return { data: res.data ?? [], governance: res.governance ?? { status: "not_created" } };
    },
    staleTime: 60_000,
  });

  const branches = summaryRes?.data ?? [];
  const governance = summaryRes?.governance ?? { status: "not_created" as const };

  const { data: paymentReadiness } = useQuery<PaymentReadinessCategories>({
    queryKey: ["payment-readiness-categories", month],
    queryFn: async () => {
      try {
        const res = await hrmsApi.get<{ success: boolean; status: string; data: any }>(`/api/payroll/readiness-categories/month/${month}`);
        if (res.status === "not_created" || !res.data) return { status: "not_created" as const };
        return { status: "checked" as const, ...res.data };
      } catch {
        return { status: "error" as const, message: "Payment readiness check failed" };
      }
    },
    staleTime: 60_000,
  });

  const stats = useMemo(() => {
    const total = branches.length;
    const ready = branches.filter((b) => b.readiness_status === "ready").length;
    const blocked = branches.filter((b) => b.readiness_status === "blocked").length;
    const signOffPending = branches.filter((b) => !b.branch_head_signoff).length;
    const avgScore = total > 0 ? Math.round(branches.reduce((s, b) => s + b.readiness_score, 0) / total) : 0;
    return { total, ready, blocked, signOffPending, avgScore };
  }, [branches]);

  const readinessPct = stats.total > 0 ? Math.round((stats.ready / stats.total) * 100) : 0;

  if (isLoading) {
    return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-64" />)}</div>;
  }

  return (
    <div className="space-y-4">
      {/* Org Readiness Health Bar */}
      {stats.total > 0 && (
        <div className="rounded-2xl border border-teal-100 bg-teal-50/60 px-5 py-3.5 flex items-center gap-4">
          <span className="text-sm font-semibold text-teal-800 whitespace-nowrap">Org Readiness</span>
          <div className="flex-1 h-3 rounded-full bg-slate-200 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-teal-400 to-emerald-500 rounded-full transition-all" style={{ width: `${readinessPct}%` }} />
          </div>
          <span className="text-sm font-bold text-teal-900 whitespace-nowrap">{stats.ready}/{stats.total} branches ready</span>
          <span className={cn("text-xs font-bold px-2 py-0.5 rounded-full", readinessPct >= 80 ? "bg-emerald-100 text-emerald-700" : readinessPct >= 50 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700")}>
            {readinessPct}%
          </span>
        </div>
      )}

      <GovernanceBanner governance={governance} />
      <PaymentReadinessBanner readiness={paymentReadiness ?? { status: "not_created" }} />

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiTile label="Branches Ready" value={stats.ready} tone="green" />
        <KpiTile label="Sign-off Pending" value={stats.signOffPending} tone="amber" />
        <KpiTile label="Blocked" value={stats.blocked} tone="red" />
        <KpiTile label="Avg Score" value={`${stats.avgScore}%`} tone="blue" />
      </div>

      {/* Branch cards */}
      {branches.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Building2 className="w-8 h-8 mb-2" />
          <p>No branches found for {month}.</p>
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
          {branches.map((branch) => (
            <BranchCard key={branch.branch_id} branch={branch} onOpenDetail={setDetailBranch} onOverride={setOverrideBranch} canOverride={canOverride} />
          ))}
        </div>
      )}

      <BranchDetailDrawer branch={detailBranch} open={!!detailBranch} onClose={() => setDetailBranch(null)} month={month} />
      <BranchOverrideDialog branch={overrideBranch} open={!!overrideBranch} onClose={() => setOverrideBranch(null)} month={month} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROCESS SCOPE COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

function ProcessCard({ process, onClick }: { process: ProcessReadiness; onClick: () => void }) {
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
          <p className="text-sm font-semibold leading-tight text-slate-800 line-clamp-2">{process.process_name}</p>
          <StatusBadge status={process.readiness_status} />
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500">{process.employee_count_active ?? process.employee_count} employees</span>
          <span className={cn("text-lg font-bold tabular-nums", process.readiness_score >= 80 ? "text-emerald-600" : process.readiness_score >= 50 ? "text-amber-600" : "text-rose-600")}>
            {process.readiness_score}%
          </span>
        </div>

        <Progress value={process.readiness_score} className="h-1.5" />

        <div className="flex gap-1 flex-wrap">
          {checks.map((v, i) => (
            <span key={i} className={cn("inline-block w-2 h-2 rounded-full", v ? "bg-emerald-400" : "bg-rose-300")} />
          ))}
          <span className="text-xs text-slate-500 ml-1">{doneCount}/{checks.length}</span>
        </div>

        {process.process_manager_signoff === 1 && (
          <Badge className="bg-emerald-100 text-emerald-700 border border-emerald-200 text-xs">PM Signed Off</Badge>
        )}
      </CardContent>
    </Card>
  );
}

function ProcessDetailDrawer({
  process,
  month,
  open,
  onClose,
  roleKeys,
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
  const [signOffRemarks, setSignOffRemarks] = useState("");
  const [overrideReason, setOverrideReason] = useState("");

  const isPM = roleKeys.some(r => ["process_manager", "branch_head"].includes(r));
  const isHO = roleKeys.some(r => ["payroll_head", "super_admin"].includes(r));

  const checklistMutation = useMutation({
    mutationFn: ({ item, value }: { item: string; value: number }) =>
      apiFetch(`/api/payroll/process-readiness/${process!.branch_id}/${process!.process_id}/checklist`, {
        method: "POST",
        body: JSON.stringify({ month, item, value }),
      }),
    onSuccess: () => { toast.success("Updated"); qc.invalidateQueries({ queryKey: ["process-readiness"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const signOffMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/payroll/process-readiness/${process!.branch_id}/${process!.process_id}/signoff`, {
        method: "POST",
        body: JSON.stringify({ month, remarks: signOffRemarks.trim() }),
      }),
    onSuccess: () => {
      toast.success("Process sign-off recorded");
      qc.invalidateQueries({ queryKey: ["process-readiness"] });
      setSignOffRemarks("");
      setSignOffOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const overrideMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/payroll/process-readiness/${process!.branch_id}/${process!.process_id}/ho-override`, {
        method: "POST",
        body: JSON.stringify({ month, reason: overrideReason.trim() }),
      }),
    onSuccess: () => {
      toast.success("HO override applied");
      qc.invalidateQueries({ queryKey: ["process-readiness"] });
      setOverrideReason("");
      setOverrideOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!process) return null;

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
          <div className="flex items-center justify-between">
            <div>
              <StatusBadge status={process.readiness_status} />
              {process.ho_override_ready === 1 && (
                <Badge className="ml-2 bg-purple-100 text-purple-800 border-purple-200 border text-xs">Overridden</Badge>
              )}
            </div>
            <span className={cn("text-2xl font-bold tabular-nums", process.readiness_score >= 80 ? "text-emerald-600" : process.readiness_score >= 50 ? "text-amber-600" : "text-rose-600")}>
              {process.readiness_score}%
            </span>
          </div>
          <Progress value={process.readiness_score} className="h-2" />

          <div className="rounded-lg bg-slate-50 p-3 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-slate-500">Active Employees</span>
              <span className="font-medium">{process.employee_count_active ?? process.employee_count}</span>
            </div>
            {process.projected_gross != null && (
              <div className="flex justify-between">
                <span className="text-slate-500">Est. Gross</span>
                <span className="font-medium">{fmtCurrency(process.projected_gross)}</span>
              </div>
            )}
          </div>

          {/* Checklist */}
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Checklist</p>
            {[
              { key: "attendance_data_ready", label: "Attendance Data Ready", val: process.attendance_data_ready },
              { key: "attendance_frozen", label: "Attendance Frozen", val: process.attendance_frozen, readonly: true },
              { key: "custom_deductions_uploaded", label: "Custom Deductions", val: process.custom_deductions_uploaded },
              { key: "overtime_entered", label: "Overtime Entered", val: process.overtime_entered },
            ].map(({ key, label, val, readonly }) => (
              <div key={key} className="flex items-center justify-between gap-2 py-2 border-b last:border-0">
                <div className="flex items-center gap-2 text-sm">
                  {val ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Clock className="h-4 w-4 text-slate-400" />}
                  <span className={val ? "text-slate-700" : "text-slate-500"}>{label}</span>
                </div>
                {!readonly && (
                  <Button
                    size="sm"
                    variant={val ? "outline" : "default"}
                    className="h-6 px-2 text-xs"
                    disabled={checklistMutation.isPending}
                    onClick={() => checklistMutation.mutate({ item: key, value: val ? 0 : 1 })}
                  >
                    {val ? "Undo" : "Mark Done"}
                  </Button>
                )}
              </div>
            ))}
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
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-2 pt-1">
            {canSignOff && (
              <Button onClick={() => setSignOffOpen(true)} className="w-full">Process Manager Sign-Off</Button>
            )}
            {isHO && process.readiness_status !== "ready" && !process.ho_override_ready && (
              <Button variant="outline" onClick={() => setOverrideOpen(true)} className="w-full border-rose-300 text-rose-700 hover:bg-rose-50">
                HO Override — Force Ready
              </Button>
            )}
          </div>
        </div>
      </SheetContent>

      {/* Sign-off dialog */}
      <Dialog open={signOffOpen} onOpenChange={(v) => !v && setSignOffOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Process Manager Sign-Off</DialogTitle>
            <DialogDescription>Confirm all payroll inputs are complete for this process.</DialogDescription>
          </DialogHeader>
          <Textarea value={signOffRemarks} onChange={(e) => setSignOffRemarks(e.target.value)} placeholder="Remarks (required)" rows={3} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setSignOffOpen(false)}>Cancel</Button>
            <Button disabled={!signOffRemarks.trim() || signOffMutation.isPending} onClick={() => signOffMutation.mutate()}>
              {signOffMutation.isPending ? "Submitting…" : "Confirm Sign-Off"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Override dialog */}
      <Dialog open={overrideOpen} onOpenChange={(v) => !v && setOverrideOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>HO Override — Force Ready</DialogTitle>
            <DialogDescription>This bypasses all checklist requirements. Provide a reason for the audit trail.</DialogDescription>
          </DialogHeader>
          <Textarea value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="Override reason (required)" rows={3} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOverrideOpen(false)}>Cancel</Button>
            <Button variant="destructive" disabled={!overrideReason.trim() || overrideMutation.isPending} onClick={() => overrideMutation.mutate()}>
              {overrideMutation.isPending ? "Applying…" : "Apply Override"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Sheet>
  );
}

function BranchAccordion({ group, onProcessClick }: { group: BranchGroup; onProcessClick: (p: ProcessReadiness) => void }) {
  const [open, setOpen] = useState(false);
  const readyPct = group.stats.total > 0 ? Math.round((group.stats.ready / group.stats.total) * 100) : 0;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <div className="flex items-center justify-between p-3 rounded-lg border bg-white hover:bg-slate-50 cursor-pointer transition-colors">
          <div className="flex items-center gap-3">
            {open ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
            <Building2 className="h-4 w-4 text-indigo-400" />
            <span className="font-semibold text-slate-800">{group.branch_name}</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-500 hidden sm:inline">{group.stats.ready}/{group.stats.total} ready</span>
            <Badge className={cn("border text-xs",
              readyPct === 100 ? "bg-emerald-100 text-emerald-800 border-emerald-200" :
              readyPct >= 50 ? "bg-amber-100 text-amber-800 border-amber-200" :
              "bg-rose-100 text-rose-800 border-rose-200"
            )}>
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

function ProcessScopeHOView({ month, roleKeys }: { month: string; roleKeys: string[] }) {
  const [selected, setSelected] = useState<ProcessReadiness | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["process-readiness-grouped", month],
    queryFn: () => apiFetch(`/api/payroll/process-readiness/grouped-summary?month=${month}`),
    refetchInterval: 120_000,
  });

  const groups: BranchGroup[] = data?.data ?? [];
  const summary = data?.summary ?? { totalBranches: 0, totalProcesses: 0, readyProcesses: 0, avgScore: 0 };
  const governance: OrgWideGovernance = data?.governance ?? { status: "not_created" };

  const { data: paymentReadinessData } = useQuery({
    queryKey: ["payment-readiness-categories-process", month],
    queryFn: async () => {
      try {
        const res = await apiFetch(`/api/payroll/readiness-categories/month/${month}`);
        if (res.status === "not_created" || !res.data) return { status: "not_created" as const };
        return { status: "checked" as const, ...res.data };
      } catch {
        return { status: "error" as const, message: "Payment readiness check failed" };
      }
    },
    refetchInterval: 120_000,
    retry: false,
  });

  return (
    <div className="space-y-4">
      <GovernanceBanner governance={governance} />
      <PaymentReadinessBanner readiness={paymentReadinessData ?? { status: "not_created" }} />

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiTile label="Branches" value={summary.totalBranches} tone="slate" />
        <KpiTile label="Processes" value={summary.totalProcesses} tone="slate" />
        <KpiTile label="Ready" value={summary.readyProcesses} tone="green" />
        <KpiTile label="Avg Score" value={`${summary.avgScore}%`} tone="blue" />
      </div>

      {isLoading ? (
        <div className="text-center py-10 text-slate-400">Loading…</div>
      ) : groups.length === 0 ? (
        <div className="text-center py-10 text-slate-400">No branches found.</div>
      ) : (
        <div className="space-y-2">
          {groups.map((group) => (
            <BranchAccordion key={group.branch_id} group={group} onProcessClick={setSelected} />
          ))}
        </div>
      )}

      <ProcessDetailDrawer process={selected} month={month} open={!!selected} onClose={() => setSelected(null)} roleKeys={roleKeys} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// BRANCH-SIDE OWN VIEW  (wfm / branch_head / payroll_branch / process_manager)
//
// The merged readiness page previously rendered "You do not have access to the
// branch view" for every branch-side role, on BOTH tabs — so the wfm,
// branch_head and process_manager users had no surface at all for the thing the
// page exists to collect, even though the backend has shipped
// POST /branch-readiness/:branchId/{checklist,signoff,request-freeze} (wfm
// allowed on checklist + request-freeze, branch_head on signoff) since
// migration 400. branch_head_signoff was 0 on every row of every month as a
// direct result. This view is that missing surface.
//
// Maker/checker is the backend's, unchanged: WFM ticks the five manual items and
// requests the freeze; branch_head signs the branch off; attendance_frozen and
// the percentage items stay read-only because Payroll Head / the nightly
// refresh own them.
// ═══════════════════════════════════════════════════════════════════════════════

type OwnChecklistDef = {
  key: keyof BranchReadiness;
  label: string;
  editable: boolean;
  isPercent?: boolean;
  hint?: string;
  /**
   * The real outstanding number behind this item, when one exists.
   *
   * The five editable items are ATTESTATIONS: the checklist POST writes the column and queries
   * nothing, so before this a WFM user ticked "Attendance Data Ready" from memory and the
   * Payroll Head saw a score with no way to tell why a branch was short. These render the
   * measured figure next to the tick so it is made against a visible number, and so follow-up
   * has something specific to chase.
   */
  outstanding?: (b: BranchReadiness) => { text: string; warn: boolean } | null;
};

// The five `editable` keys are exactly ALLOWED_CHECKLIST_ITEMS in
// payroll-branch-readiness.routes.ts — posting anything else 400s.
const BRANCH_OWN_CHECKLIST: OwnChecklistDef[] = [
  { key: "attendance_data_ready",      label: "Attendance Data Ready", editable: true,  hint: "Punches and exceptions resolved for the whole month",
    outstanding: (b) => {
      const n = Number(b.employees_without_attendance ?? 0);
      return n > 0
        ? { text: `${n} employee${n === 1 ? "" : "s"} with no attendance at all this month`, warn: true }
        : { text: "Every active employee has attendance this month", warn: false };
    } },
  { key: "leave_finalized",            label: "Leaves Finalized",      editable: true,  hint: "Every leave request approved or rejected",
    outstanding: (b) => {
      const n = Number(b.pending_leave_count ?? 0);
      return n > 0 ? { text: `${n} leave request${n === 1 ? "" : "s"} still pending`, warn: true } : null;
    } },
  { key: "regularization_complete",    label: "Regularizations Done",  editable: true,  hint: "No pending attendance regularizations",
    outstanding: (b) => {
      const n = Number(b.pending_regularization_count ?? 0);
      return n > 0 ? { text: `${n} regularization${n === 1 ? "" : "s"} pending or escalated`, warn: true } : null;
    } },
  { key: "custom_deductions_uploaded", label: "Custom Deductions",     editable: true,  hint: "Advances, recoveries and one-off deductions uploaded" },
  { key: "overtime_entered",           label: "Overtime Entered",      editable: true,  hint: "OT hours captured for the month" },
  { key: "attendance_frozen",          label: "Attendance Frozen",     editable: false, hint: "Payroll Head freezes this after your request" },
  { key: "incentives_status",          label: "Incentives Approved",   editable: false, hint: "Approved on the incentive module by admin/finance \u2014 worth 20 of the 100 points, and branch staff cannot approve it",
    outstanding: (b) => {
      const s = b.incentive_batch_status;
      if (!s) return { text: "No incentive batch uploaded for this month", warn: true };
      return s === "approved"
        ? { text: "Batch approved", warn: false }
        : { text: `Batch is '${s}' \u2014 needs admin/finance approval`, warn: true };
    } },
  { key: "bank_details_pct",           label: "Bank Details",          editable: false, isPercent: true },
  { key: "uan_complete_pct",           label: "UAN",                   editable: false, isPercent: true },
  { key: "noc_resolved",               label: "NOC Resolved",          editable: false },
  { key: "holiday_work_approved",      label: "Holiday Work Approved", editable: false },
];

function ownChecklistDone(branch: BranchReadiness, def: OwnChecklistDef): boolean {
  if (def.key === "incentives_status") return branch.incentives_status === "approved";
  if (def.isPercent) return Number(branch[def.key] ?? 0) >= 100;
  return Boolean(branch[def.key]);
}

function BranchScopeOwnView({ month, processOnly = false }: { month: string; processOnly?: boolean }) {
  const { roleKeys, scopes } = useWorkforceAccess();
  const qc = useQueryClient();
  const [urlParams] = useSearchParams();
  const openProcessId = urlParams.get("open");

  const [branchId, setBranchId] = useState<string>("");
  const [branchNames, setBranchNames] = useState<Record<string, string>>({});
  const [signOffOpen, setSignOffOpen] = useState(false);
  const [signOffRemarks, setSignOffRemarks] = useState("");
  const [selectedProcess, setSelectedProcess] = useState<ProcessReadiness | null>(null);

  // Branch options come from the user's own assignment scopes, so this can only
  // ever address a branch the backend's requireScopedRole would allow anyway.
  const branchOptions = useMemo(
    () => Array.from(new Set(scopes.map((s) => s.branch_id).filter((b): b is string => !!b))),
    [scopes]
  );

  useEffect(() => {
    if (!branchId && branchOptions.length) setBranchId(branchOptions[0]);
  }, [branchOptions, branchId]);

  // payroll_hr included: user_roles has 4 active payroll_hr users and ZERO holding
  // payroll_branch, so payroll_hr is the branch-payroll role in practice, and
  // custom_deductions_uploaded is the item it owns. The backend already permitted it.
  const canEditChecklist = roleKeys.some((r) => ["wfm", "branch_head", "payroll_branch", "payroll_hr"].includes(r));
  const canSignOff = roleKeys.includes("branch_head");

  const branchQuery = useQuery({
    queryKey: ["branch-readiness", "own", branchId, month],
    queryFn: () => apiFetch(`/api/payroll/branch-readiness/${branchId}?month=${month}`),
    enabled: !!branchId,
    staleTime: 30_000,
  });

  const processQuery = useQuery({
    queryKey: ["branch-readiness", "own-processes", branchId, month],
    queryFn: () => apiFetch(`/api/payroll/branch-readiness/${branchId}/processes?month=${month}`),
    enabled: !!branchId,
    staleTime: 30_000,
  });

  const branch: BranchReadiness | undefined = branchQuery.data?.data;
  const branchName = branch?.branch_name;

  useEffect(() => {
    if (branchName && branchId) {
      setBranchNames((prev) => (prev[branchId] === branchName ? prev : { ...prev, [branchId]: branchName }));
    }
  }, [branchName, branchId]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["branch-readiness"] });

  const checklistMutation = useMutation({
    mutationFn: ({ item, value }: { item: string; value: number }) =>
      apiFetch(`/api/payroll/branch-readiness/${branchId}/checklist`, {
        method: "POST",
        body: JSON.stringify({ month, item, value }),
      }),
    onSuccess: () => { toast.success("Checklist updated"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const freezeMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/payroll/branch-readiness/${branchId}/request-freeze`, {
        method: "POST",
        body: JSON.stringify({ month }),
      }),
    onSuccess: () => toast.success("Attendance freeze requested from Payroll Head"),
    onError: (e: Error) => toast.error(e.message),
  });

  const signOffMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/payroll/branch-readiness/${branchId}/signoff`, {
        method: "POST",
        body: JSON.stringify({ month, remarks: signOffRemarks.trim() }),
      }),
    onSuccess: () => {
      toast.success("Branch sign-off recorded");
      invalidate();
      setSignOffRemarks("");
      setSignOffOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const processes: ProcessReadiness[] = processQuery.data?.data ?? [];

  // Deep link from the WFM dashboard's Payroll Prep widget:
  // /payroll/process-readiness?open=<processId>. Opened once, then the user
  // owns the drawer — re-opening on every render would trap them in it.
  const [deepLinkHandled, setDeepLinkHandled] = useState(false);
  useEffect(() => {
    if (deepLinkHandled || !openProcessId || !processes.length) return;
    const match = processes.find((p) => p.process_id === openProcessId);
    setDeepLinkHandled(true);
    if (match) setSelectedProcess({ ...match, branch_id: match.branch_id || branchId });
  }, [deepLinkHandled, openProcessId, processes, branchId]);

  if (!branchOptions.length) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-amber-200 bg-amber-50/50 py-14 text-center">
        <AlertTriangle className="mb-3 h-9 w-9 text-amber-400" />
        <p className="text-sm font-semibold text-amber-800">No branch is assigned to your account</p>
        <p className="mt-1 max-w-md text-xs text-amber-700">
          Payroll readiness is captured per branch, so your login needs a branch assignment scope before you can
          update it. Ask HR or the admin team to add one, then reload this page.
        </p>
      </div>
    );
  }

  const editableDefs = BRANCH_OWN_CHECKLIST.filter((d) => d.editable);
  const allEditableDone = !!branch && editableDefs.every((d) => ownChecklistDone(branch, d));
  const doneCount = branch ? BRANCH_OWN_CHECKLIST.filter((d) => ownChecklistDone(branch, d)).length : 0;
  const locked = Boolean(branch?.branch_head_signoff);

  const branchPicker = branchOptions.length > 1 ? (
    <div className="flex flex-wrap items-center gap-1.5">
      {branchOptions.map((id, i) => (
        <Button
          key={id}
          size="sm"
          variant={id === branchId ? "default" : "outline"}
          className="h-8 rounded-xl text-xs"
          onClick={() => setBranchId(id)}
        >
          {branchNames[id] ?? `Branch ${i + 1}`}
        </Button>
      ))}
    </div>
  ) : null;

  const processSection = (
    <div className="space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-bold text-slate-700">
        <Briefcase className="h-4 w-4 text-slate-400" />
        Process-Level Readiness
      </h3>
      {processQuery.isLoading ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
      ) : processes.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-slate-200 py-10 text-center text-sm text-slate-400">
          No processes mapped to this branch for {month}.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {processes.map((proc) => (
            <ProcessCard
              key={proc.process_id || proc.process_name}
              process={proc}
              onClick={() => setSelectedProcess({ ...proc, branch_id: proc.branch_id || branchId })}
            />
          ))}
        </div>
      )}
      <ProcessDetailDrawer
        process={selectedProcess}
        month={month}
        open={!!selectedProcess}
        onClose={() => setSelectedProcess(null)}
        roleKeys={roleKeys}
      />
    </div>
  );

  if (processOnly) {
    return (
      <div className="space-y-4">
        {branchPicker}
        {processSection}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {branchPicker}

      {branchQuery.isLoading || !branch ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : (
        <>
          {/* Branch summary */}
          <div className="rounded-2xl border-2 border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="truncate text-lg font-extrabold text-slate-900">{branch.branch_name}</h2>
                <p className="mt-0.5 text-xs text-slate-400">
                  {branch.employee_count_active || branch.employee_count} active · {month}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <StatusBadge status={branch.readiness_status} />
                  <span className="text-[11px] font-semibold text-slate-400">
                    {doneCount}/{BRANCH_OWN_CHECKLIST.length} checks
                  </span>
                  {locked && (
                    <Badge className="border border-emerald-200 bg-emerald-100 text-xs text-emerald-700">
                      Signed off {fmtDate(branch.branch_head_signoff_at)}
                    </Badge>
                  )}
                  {Boolean(branch.ho_override_ready) && (
                    <Badge className="border border-purple-200 bg-purple-100 text-xs text-purple-700">HO Overridden</Badge>
                  )}
                </div>
              </div>
              <ScoreCircle score={branch.readiness_score} size={64} />
            </div>
            <Progress value={branch.readiness_score} className="mt-4 h-2" />
          </div>

          {/* Checklist */}
          <div className="rounded-2xl border-2 border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Monthly Checklist</p>
              {!canEditChecklist && (
                <span className="text-[11px] font-medium text-slate-400">Read-only for your role</span>
              )}
            </div>

            <div className="divide-y divide-slate-100">
              {BRANCH_OWN_CHECKLIST.map((def) => {
                const done = ownChecklistDone(branch, def);
                const showToggle = def.editable && canEditChecklist && !locked;
                return (
                  <div key={String(def.key)} className="flex items-start justify-between gap-3 py-2.5">
                    <div className="flex min-w-0 items-start gap-2">
                      {done
                        ? <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-500" />
                        : <Clock className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-300" />}
                      <div className="min-w-0">
                        <p className={cn("text-sm font-medium", done ? "text-slate-700" : "text-slate-500")}>
                          {def.label}
                          {def.isPercent && (
                            <span className="ml-1.5 text-xs font-semibold tabular-nums text-slate-400">
                              {Math.round(Number(branch[def.key] ?? 0))}%
                            </span>
                          )}
                        </p>
                        {def.hint && <p className="mt-0.5 text-[11px] leading-snug text-slate-400">{def.hint}</p>}
                        {(() => {
                          const o = def.outstanding?.(branch);
                          if (!o) return null;
                          return (
                            <p className={cn(
                              "mt-0.5 flex items-center gap-1 text-[11px] font-medium leading-snug tabular-nums",
                              o.warn ? "text-amber-600" : "text-emerald-600"
                            )}>
                              {o.warn && <Info className="h-3 w-3 flex-shrink-0" />}
                              {o.text}
                            </p>
                          );
                        })()}
                      </div>
                    </div>
                    {showToggle ? (
                      <Button
                        size="sm"
                        variant={done ? "outline" : "default"}
                        className="h-7 flex-shrink-0 rounded-xl px-2.5 text-xs"
                        disabled={checklistMutation.isPending}
                        onClick={() => checklistMutation.mutate({ item: String(def.key), value: done ? 0 : 1 })}
                      >
                        {done ? "Undo" : "Mark Done"}
                      </Button>
                    ) : (
                      <span className="flex-shrink-0 text-[11px] font-medium text-slate-300">
                        {def.editable ? "" : "auto"}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Actions */}
            <div className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-4 sm:flex-row">
              {/* The cost-centre sign-off behind "Attendance Data Ready": the checklist item is an
                  attestation, this is the underlying per-employee data it attests to. */}
              <Button
                variant="outline"
                className="flex-1 rounded-xl"
                asChild
              >
                <Link to={`/payroll/readiness/cost-centres?branchId=${branchId}&month=${month}`}>
                  <Layers className="mr-1.5 h-4 w-4" /> Cost-Centre Attendance
                </Link>
              </Button>
              {canEditChecklist && !branch.attendance_frozen && (
                <Button
                  variant="outline"
                  className="flex-1 rounded-xl"
                  disabled={freezeMutation.isPending}
                  onClick={() => freezeMutation.mutate()}
                >
                  <Lock className="mr-1.5 h-4 w-4" />
                  {freezeMutation.isPending ? "Sending…" : "Request Attendance Freeze"}
                </Button>
              )}
              {canSignOff && !locked && (
                <Button
                  className="flex-1 rounded-xl"
                  disabled={!allEditableDone}
                  title={allEditableDone ? undefined : "Complete every checklist item you own before signing off"}
                  onClick={() => setSignOffOpen(true)}
                >
                  <ShieldCheck className="mr-1.5 h-4 w-4" /> Branch Sign-Off
                </Button>
              )}
            </div>
            {canSignOff && !locked && !allEditableDone && (
              <p className="mt-2 flex items-center gap-1.5 text-[11px] text-amber-600">
                <Info className="h-3 w-3" /> Sign-off unlocks once all five branch-owned items are marked done.
              </p>
            )}
          </div>

          {processSection}
        </>
      )}

      <Dialog open={signOffOpen} onOpenChange={(v) => !v && setSignOffOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Branch Sign-Off — {branch?.branch_name}</DialogTitle>
            <DialogDescription>
              Confirms every payroll input for {month} is complete for this branch. This is recorded against your
              user and is visible to the Payroll Head.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={signOffRemarks}
            onChange={(e) => setSignOffRemarks(e.target.value)}
            placeholder="Remarks (required)"
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setSignOffOpen(false)}>Cancel</Button>
            <Button disabled={!signOffRemarks.trim() || signOffMutation.isPending} onClick={() => signOffMutation.mutate()}>
              {signOffMutation.isPending ? "Submitting…" : "Confirm Sign-Off"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROOT PAGE
// ═══════════════════════════════════════════════════════════════════════════════

export default function PayrollReadinessDashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const scope = searchParams.get("scope") || "branch";
  const [month, setMonth] = useState(currentMonth);
  const { roleKeys, scopes, isLoading: roleLoading } = useWorkforceAccess();
  const { user } = useAuth();
  const qc = useQueryClient();

  const isHORole =
    roleKeys.includes("payroll_head") ||
    roleKeys.includes("super_admin") ||
    roleKeys.includes("payroll") ||
    roleKeys.includes("admin") ||
    roleKeys.includes("hr");

  // Branch-side roles get their own branch's readiness instead of the HO roll-up.
  // Every one of these role keys is already allowed on the branch/process
  // readiness endpoints server-side, and requireScopedRole pins each request to
  // the caller's own assignment scope, so this only re-opens a surface the API
  // was always willing to serve them.
  const isBranchSideRole =
    !isHORole &&
    roleKeys.some((r) => ["wfm", "branch_head", "payroll_branch", "process_manager"].includes(r));

  const canExport = roleKeys.includes("payroll_head") || roleKeys.includes("super_admin") || roleKeys.includes("admin");

  const handleScopeChange = (newScope: string) => {
    setSearchParams({ scope: newScope }, { replace: true });
  };

  const handleRefresh = () => {
    qc.invalidateQueries({ queryKey: ["branch-readiness"] });
    qc.invalidateQueries({ queryKey: ["process-readiness"] });
    toast.info("Refreshing readiness data…");
  };

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-7xl space-y-4 px-4 py-5 sm:px-5">
        {/* Hero Header */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-teal-600 via-cyan-600 to-blue-700 p-5 sm:p-6 shadow-lg">
          <div className="pointer-events-none absolute inset-0 opacity-10"
            style={{ backgroundImage: "radial-gradient(circle at 20% 50%, rgba(255,255,255,0.3) 0%, transparent 50%), radial-gradient(circle at 80% 20%, rgba(255,255,255,0.15) 0%, transparent 40%)" }} />
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-teal-200" />
                <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-teal-200">Payroll Operations</span>
              </div>
              <h1 className="mt-1.5 text-2xl font-extrabold tracking-tight text-white sm:text-3xl">Payroll Readiness Dashboard</h1>
              <p className="mt-1 text-sm text-teal-100/80">Real-time readiness across branches and processes</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
              <input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="h-10 rounded-xl border border-white/25 bg-white/10 px-3 text-sm text-white placeholder-white/50 backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-white/30"
              />
              {canExport && (
                <a href={`/api/payroll/${scope === "process" ? "process-readiness" : "branch-readiness"}/export?month=${month}&format=csv`} download={`${scope}-readiness-${month}.csv`}>
                  <Button variant="outline" size="sm" className="h-10 rounded-xl border-white/25 bg-white/10 text-white hover:bg-white/20">
                    <Download className="mr-1.5 h-4 w-4" /> Export
                  </Button>
                </a>
              )}
              <Button variant="outline" size="sm" className="h-10 rounded-xl border-white/25 bg-white/10 text-white hover:bg-white/20" onClick={handleRefresh}>
                <RefreshCw className="mr-1.5 h-4 w-4" /> Refresh
              </Button>
            </div>
          </div>
        </div>

        {/* Scope Toggle */}
        <Tabs value={scope} onValueChange={handleScopeChange} className="w-full">
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="branch" className="flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              Branch View
            </TabsTrigger>
            <TabsTrigger value="process" className="flex items-center gap-2">
              <Layers className="h-4 w-4" />
              Process View
            </TabsTrigger>
          </TabsList>

          <TabsContent value="branch" className="mt-4">
            {roleLoading ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-64" />)}</div>
            ) : isHORole ? (
              <BranchScopeHOView month={month} />
            ) : isBranchSideRole ? (
              <BranchScopeOwnView month={month} />
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <X className="w-8 h-8 mb-2" />
                <p>You do not have access to the branch view.</p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="process" className="mt-4">
            {roleLoading ? (
              <div className="text-center py-10 text-slate-400">Loading…</div>
            ) : isHORole ? (
              <ProcessScopeHOView month={month} roleKeys={roleKeys} />
            ) : isBranchSideRole ? (
              <BranchScopeOwnView month={month} processOnly />
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <X className="w-8 h-8 mb-2" />
                <p>You do not have access to the process view.</p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
