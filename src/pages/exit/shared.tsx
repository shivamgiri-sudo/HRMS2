import type { ReactNode } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";

export type ExitRow = {
  id: string;
  employee_id: string;
  employee_name?: string;
  employee_code?: string;
  branch_name?: string;
  branch_id?: string;
  process_name?: string;
  process_id?: string;
  department_name?: string;
  exit_type: string;
  exit_sub_type?: string;
  exit_reason_category?: string;
  status: string;
  last_working_day_proposed?: string;
  created_at?: string;
  engagement_score?: number;
  regrettable_exit?: number;
  risk_label?: string;
  clearance_total?: number;
  clearance_cleared?: number;
  noc_case_status?: string | null;
  ff_status?: string | null;
  is_ff_provisional?: number | null;
};

export type CenterData = {
  summary: Record<string, number>;
  requests: ExitRow[];
  clearance: Array<{ clearance_area: string; status: string; count: number }>;
  attrition_trend?: Array<{
    month: string;
    voluntary: number;
    involuntary: number;
    rate: number;
  }>;
  reason_breakdown?: Array<{ reason: string; count: number }>;
  branch_breakdown?: Array<{ branch: string; count: number; rate: number }>;
  aon_breakdown?: Array<{ bucket: string; voluntary: number; involuntary: number; count: number }>;
};

export type FullFinalCalc = {
  id: string;
  exit_request_id: string;
  employee_id: string;
  employee_name?: string;
  calculation_date: string;
  notice_period_days: number;
  notice_shortfall_days: number;
  notice_recovery: number;
  earned_leave_encashment: number;
  gratuity_amount: number;
  salary_hold: number;
  advances_recovery: number;
  net_payable: number;
  status: "draft" | "verified" | "approved" | "paid";
  is_ff_provisional: number;
};

export const REASON_CATEGORIES: Array<{ code: string; label: string }> = [
  { code: "better_opportunity",         label: "Better Opportunity" },
  { code: "career_growth",              label: "Career Growth" },
  { code: "compensation",               label: "Compensation Dissatisfaction" },
  { code: "relocation",                 label: "Relocation" },
  { code: "health_personal",            label: "Health / Personal Reasons" },
  { code: "family_reasons",             label: "Family Reasons" },
  { code: "higher_education",           label: "Higher Education" },
  { code: "work_environment",           label: "Work Environment" },
  { code: "dissatisfaction_management", label: "Management Dissatisfaction" },
  { code: "entrepreneurship",           label: "Entrepreneurship" },
  { code: "performance_action",         label: "Performance Action (Involuntary)" },
  { code: "termination_misconduct",     label: "Termination — Misconduct" },
  { code: "absconding",                 label: "Absconding" },
  { code: "contract_end",               label: "Contract End" },
  { code: "other",                      label: "Other" },
];

export function reasonLabel(code?: string | null): string {
  if (!code) return "—";
  return REASON_CATEGORIES.find((r) => r.code === code)?.label ?? code.replace(/_/g, " ");
}

export function exitTypeBadgeClass(exitType?: string): string {
  return exitType?.toLowerCase() === "involuntary"
    ? "bg-red-100 text-red-700"
    : "bg-emerald-100 text-emerald-700";
}

export const statusFlow = [
  "submitted",
  "manager_review",
  "accepted",
  "notice_serving",
  "exited",
];

// NOC clearance only makes sense once the resignation is actually accepted and moving —
// same window the "Generate clearance" checklist action already uses.
export const NOC_ELIGIBLE_STATUSES = [
  "accepted",
  "notice_serving",
  "exited",
  "exit_confirmed",
];

// Mirrors noc-case.routes.ts's ROLE_EVIDENCE exactly, but checked most-senior-first (not
// the order that table declares them): the escalation matrix notifies everyone ABOVE the
// initiator's tier, so classifying an admin/HR viewer as a plain "agent" (the loosest match,
// since "admin" sits in every evidence list) would over-notify. Falls back to "agent" only
// for someone with no other matching evidence — e.g. a bare "employee" role, which "agent"
// uniquely covers.
export const NOC_INITIATOR_EVIDENCE: Array<{
  role: "agent" | "tl" | "manager" | "hr" | "it" | "admin_mis";
  roleKeys: string[];
}> = [
  {
    role: "hr",
    roleKeys: [
      "hr",
      "branch_hr",
      "payroll_hr",
      "payroll_head",
      "admin",
      "super_admin",
    ],
  },
  { role: "admin_mis", roleKeys: ["branch_admin", "admin", "super_admin"] },
  {
    role: "manager",
    roleKeys: [
      "process_manager",
      "manager",
      "branch_head",
      "admin",
      "super_admin",
    ],
  },
  {
    role: "it",
    roleKeys: ["branch_it", "it", "it_head", "admin", "super_admin"],
  },
  { role: "tl", roleKeys: ["tl", "team_leader", "admin", "super_admin"] },
  {
    role: "agent",
    roleKeys: ["employee", "tl", "team_leader", "hr", "admin", "super_admin"],
  },
];
export const CHART_COLORS = [
  "#3B82F6",
  "#10B981",
  "#F59E0B",
  "#EF4444",
  "#8B5CF6",
  "#EC4899",
  "#14B8A6",
  "#F97316",
];
export const REASON_COLORS: Record<string, string> = {
  better_opportunity: "#3B82F6",
  personal_reasons: "#10B981",
  health: "#EF4444",
  relocation: "#F59E0B",
  higher_studies: "#8B5CF6",
  dissatisfaction_management: "#EC4899",
  dissatisfaction_compensation: "#F97316",
  family_reasons: "#14B8A6",
  termination_performance: "#DC2626",
  termination_misconduct: "#991B1B",
  absconding: "#7C2D12",
  other: "#64748B",
};

// ─────────────────────────────────────────────────────────────────────────────
// Reusable Components
// ─────────────────────────────────────────────────────────────────────────────
export function Pill({
  children,
  tone = "slate",
}: {
  children: ReactNode;
  tone?: "slate" | "green" | "amber" | "red" | "blue" | "violet";
}) {
  const cls = {
    slate: "bg-slate-100 text-slate-700 border-slate-200",
    green: "bg-emerald-50 text-emerald-700 border-emerald-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    red: "bg-red-50 text-red-700 border-red-200",
    blue: "bg-blue-50 text-blue-700 border-blue-200",
    violet: "bg-violet-50 text-violet-700 border-violet-200",
  }[tone];
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-bold border ${cls}`}>
      {children}
    </span>
  );
}

export function KpiTile({
  title,
  value,
  icon,
  note,
  trend,
  trendLabel,
  tone = "slate",
}: {
  title: string;
  value: number | string;
  icon: ReactNode;
  note: string;
  trend?: number;
  trendLabel?: string;
  tone?: "blue" | "green" | "amber" | "red" | "violet" | "slate";
}) {
  const tones = {
    blue: {
      bg: "from-blue-50 to-indigo-50",
      border: "border-blue-200",
      icon: "bg-blue-100 text-blue-600",
      value: "text-blue-700",
    },
    green: {
      bg: "from-emerald-50 to-green-50",
      border: "border-emerald-200",
      icon: "bg-emerald-100 text-emerald-600",
      value: "text-emerald-700",
    },
    amber: {
      bg: "from-amber-50 to-orange-50",
      border: "border-amber-200",
      icon: "bg-amber-100 text-amber-600",
      value: "text-amber-700",
    },
    red: {
      bg: "from-red-50 to-rose-50",
      border: "border-red-200",
      icon: "bg-red-100 text-red-600",
      value: "text-red-700",
    },
    violet: {
      bg: "from-violet-50 to-purple-50",
      border: "border-violet-200",
      icon: "bg-violet-100 text-violet-600",
      value: "text-violet-700",
    },
    slate: {
      bg: "from-slate-50 to-gray-50",
      border: "border-slate-200",
      icon: "bg-slate-100 text-slate-600",
      value: "text-slate-700",
    },
  };
  const t = tones[tone];
  return (
    <div
      className={`rounded-2xl border ${t.border} bg-gradient-to-br ${t.bg} p-5 shadow-sm hover:shadow-md transition-all duration-200`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
            {title}
          </p>
          <p className={`mt-2 text-3xl font-bold ${t.value} leading-none`}>
            {value ?? 0}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <p className="text-xs text-slate-500">{note}</p>
            {trend !== undefined && (
              <span
                className={`flex items-center gap-0.5 text-xs font-semibold ${trend >= 0 ? "text-red-600" : "text-emerald-600"}`}
              >
                {trend >= 0 ? (
                  <TrendingUp className="w-3 h-3" />
                ) : (
                  <TrendingDown className="w-3 h-3" />
                )}
                {Math.abs(trend).toFixed(1)}%
                {trendLabel && (
                  <span className="text-slate-400 font-normal ml-1">
                    {trendLabel}
                  </span>
                )}
              </span>
            )}
          </div>
        </div>
        <div
          className={`w-12 h-12 rounded-xl ${t.icon} flex items-center justify-center shrink-0`}
        >
          {icon}
        </div>
      </div>
    </div>
  );
}
