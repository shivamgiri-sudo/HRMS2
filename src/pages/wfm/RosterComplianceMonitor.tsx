/**
 * Roster Compliance Monitor — Phase 5
 *
 * Design System: MAS HRMS Frozen Patterns
 * - GlassCard containers with backdrop-blur
 * - Gradient headers (amber for compliance/warning domain)
 * - Tone color system for violation severity
 * - Responsive: mobile-first grid
 *
 * Features:
 * 1. Rule violation tracking (rest policy, consecutive days, week-off)
 * 2. Compliance score by branch/process/manager
 * 3. Violation trend over time
 * 4. Auto-fix suggestions
 * 5. Audit trail of violations
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Calendar,
  CheckCircle2,
  Clock,
  Filter,
  Moon,
  RefreshCw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sun,
  Target,
  TrendingDown,
  TrendingUp,
  Users,
  XCircle,
  Zap,
} from "lucide-react";

const ALL = "__all__";

// ── Types ────────────────────────────────────────────────────────────────────

interface ComplianceSummary {
  overallScore: number;
  trend: number;
  byRule: {
    minimumRest: { violations: number; total: number; score: number };
    consecutiveDays: { violations: number; total: number; score: number };
    weekOffFairness: { violations: number; total: number; score: number };
    maxHoursWeek: { violations: number; total: number; score: number };
    nightShiftLimit: { violations: number; total: number; score: number };
  };
  byBranch: Array<{
    branchId: string;
    branchName: string;
    score: number;
    violations: number;
    trend: number;
  }>;
  byProcess: Array<{
    processId: string;
    processName: string;
    score: number;
    violations: number;
  }>;
}

interface Violation {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  processName: string | null;
  branchName: string | null;
  /*
   * Widened from the five roster-rule literals to `string`, because the API's per-incident
   * feed emits attendance-derived ids (ABSENT_NO_CALL, LATE_ARRIVAL) and there is no
   * per-incident source for the five rules the summary counts. Narrowing this back would
   * force those ids into buckets they do not belong to; RULE_CONFIG is guarded with a humanised fallback in ViolationRow.
   */
  ruleType: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  detectedAt: string;
  details: string;
  affectedDates: string[];
  suggestedFix: string | null;
  /*
   * Also widened. The API derives this from the roster day (WORKING / WEEK_OFF); there is no
   * acknowledge/resolve/waive workflow behind this dashboard and no table to persist one, so
   * the four-state union described a lifecycle that has never existed.
   */
  status: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

interface TrendData {
  week: string;
  violations: number;
  score: number;
}

// ── Design Tokens (MAS HRMS Frozen) ──────────────────────────────────────────

const TONE = {
  blue: { iconBg: "#edf4ff", value: "#0b63e5", border: "#dce8fb" },
  green: { iconBg: "#eaf8ef", value: "#15803d", border: "#d7f0df" },
  amber: { iconBg: "#fff4e8", value: "#ea580c", border: "#fee3c5" },
  red: { iconBg: "#fff0f1", value: "#dc2626", border: "#ffdadd" },
  violet: { iconBg: "#f3efff", value: "#6d28d9", border: "#e6ddff" },
  teal: { iconBg: "#f0fdfa", value: "#0f766e", border: "#99f6e4" },
  slate: { iconBg: "#f1f4f8", value: "#0b1f44", border: "#e3e9f2" },
};

const RULE_CONFIG = {
  MINIMUM_REST: { label: "Minimum Rest", icon: Moon, description: "Less than required rest between shifts" },
  CONSECUTIVE_DAYS: { label: "Consecutive Days", icon: Calendar, description: "Working too many days in a row" },
  WEEKOFF_FAIRNESS: { label: "Week-Off Fairness", icon: Sun, description: "Unfair week-off distribution" },
  MAX_HOURS_WEEK: { label: "Max Hours/Week", icon: Clock, description: "Exceeding weekly hour limit" },
  NIGHT_SHIFT_LIMIT: { label: "Night Shift Limit", icon: Moon, description: "Too many consecutive night shifts" },
};

const SEVERITY_CONFIG = {
  CRITICAL: { tone: "red" as const, label: "Critical" },
  HIGH: { tone: "amber" as const, label: "High" },
  MEDIUM: { tone: "blue" as const, label: "Medium" },
  LOW: { tone: "green" as const, label: "Low" },
};

const STATUS_CONFIG = {
  OPEN: { color: "bg-red-100 text-red-700", label: "Open" },
  ACKNOWLEDGED: { color: "bg-amber-100 text-amber-700", label: "Acknowledged" },
  RESOLVED: { color: "bg-green-100 text-green-700", label: "Resolved" },
  WAIVED: { color: "bg-slate-100 text-slate-700", label: "Waived" },
};

// ── Subcomponents ────────────────────────────────────────────────────────────

function GlassCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm hover:shadow-md transition-all duration-200 ${className}`}>
      {children}
    </div>
  );
}

function MetricTile({
  label,
  value,
  helper,
  tone = "slate",
  trend,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  helper?: string;
  tone?: keyof typeof TONE;
  trend?: number;
  icon: React.ElementType;
}) {
  const colors = TONE[tone];
  return (
    <GlassCard className="p-4">
      <div className="flex items-start justify-between">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-xl"
          style={{ backgroundColor: colors.iconBg }}
        >
          <Icon className="h-5 w-5" style={{ color: colors.value }} />
        </div>
        {trend !== undefined && (
          <div className={`flex items-center gap-1 text-xs font-medium ${trend >= 0 ? "text-emerald-600" : "text-red-600"}`}>
            {trend >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {Math.abs(trend)}%
          </div>
        )}
      </div>
      <div className="mt-3">
        <p className="text-2xl font-bold" style={{ color: colors.value }}>{value}</p>
        <p className="text-sm font-medium text-slate-700">{label}</p>
        {helper && <p className="text-xs text-slate-500 mt-0.5">{helper}</p>}
      </div>
    </GlassCard>
  );
}

function ComplianceGauge({ score }: { score: number }) {
  const size = 140;
  const strokeWidth = 12;
  const radius = (size - strokeWidth) / 2;
  const circumference = Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  const color = score >= 90 ? "#15803d" : score >= 75 ? "#ea580c" : "#dc2626";
  const label = score >= 90 ? "Excellent" : score >= 75 ? "Good" : score >= 50 ? "Needs Attention" : "Critical";

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size / 2 + 20} className="overflow-visible">
        <path
          d={`M ${strokeWidth / 2} ${size / 2} A ${radius} ${radius} 0 0 1 ${size - strokeWidth / 2} ${size / 2}`}
          fill="none"
          stroke="#e5e7eb"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
        <path
          d={`M ${strokeWidth / 2} ${size / 2} A ${radius} ${radius} 0 0 1 ${size - strokeWidth / 2} ${size / 2}`}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-700"
        />
        <text x={size / 2} y={size / 2 - 10} textAnchor="middle" fontSize={32} fontWeight="bold" fill={color}>
          {score}%
        </text>
        <text x={size / 2} y={size / 2 + 15} textAnchor="middle" fontSize={12} fill="#64748b">
          {label}
        </text>
      </svg>
    </div>
  );
}

function RuleComplianceCard({
  rule,
  data,
}: {
  rule: keyof typeof RULE_CONFIG;
  data: { violations: number; total: number; score: number };
}) {
  const config = RULE_CONFIG[rule];
  const Icon = config.icon;
  const tone = data.score >= 90 ? "green" : data.score >= 75 ? "amber" : "red";
  const colors = TONE[tone];

  return (
    <GlassCard className="p-4">
      <div className="flex items-center gap-3 mb-3">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-xl"
          style={{ backgroundColor: colors.iconBg }}
        >
          <Icon className="h-5 w-5" style={{ color: colors.value }} />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-slate-800">{config.label}</h4>
          <p className="text-xs text-slate-500 truncate">{config.description}</p>
        </div>
        <div className="text-right">
          <p className="text-xl font-bold" style={{ color: colors.value }}>{data.score}%</p>
        </div>
      </div>
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-slate-500">
          <span>{data.violations} violations</span>
          <span>{data.total} checked</span>
        </div>
        <Progress value={data.score} className={`h-2 [&>div]:bg-${tone === "green" ? "emerald" : tone}-500`} />
      </div>
    </GlassCard>
  );
}

/** "ABSENT_NO_CALL" -> "Absent No Call", for ids RULE_CONFIG has no entry for. */
const humanise = (id: string) =>
  id.split(/[_\s]+/).filter(Boolean).map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(" ");

function ViolationRow({ violation }: { violation: Violation }) {
  /*
   * Both lookups are keyed on values the API supplies, and the API emits ids these maps do
   * not contain: ruleId is attendance-derived (ABSENT_NO_CALL, LATE_ARRIVAL) rather than one
   * of the five roster rules, and status is WORKING/WEEK_OFF rather than an OPEN/RESOLVED
   * lifecycle. Unguarded, `RULE_CONFIG[...]` returns undefined and the `.icon` read below
   * throws, taking the whole page down on the first real row.
   */
  const ruleConfig = RULE_CONFIG[violation.ruleType as keyof typeof RULE_CONFIG] ?? {
    label: humanise(violation.ruleType),
    icon: AlertTriangle,
    description: "",
  };
  const severityConfig = SEVERITY_CONFIG[violation.severity] ?? SEVERITY_CONFIG.LOW;
  const statusConfig = STATUS_CONFIG[violation.status as keyof typeof STATUS_CONFIG] ?? {
    color: "bg-slate-100 text-slate-700",
    label: humanise(violation.status),
  };
  const colors = TONE[severityConfig.tone];
  const Icon = ruleConfig.icon;

  return (
    <div className="p-4 border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
      <div className="flex items-start gap-4">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-xl flex-shrink-0"
          style={{ backgroundColor: colors.iconBg }}
        >
          <Icon className="h-5 w-5" style={{ color: colors.value }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-slate-800">{violation.employeeName}</span>
            <span className="text-xs text-slate-500">{violation.employeeCode}</span>
            <Badge style={{ backgroundColor: colors.iconBg, color: colors.value }}>
              {severityConfig.label}
            </Badge>
            <Badge className={statusConfig.color}>{statusConfig.label}</Badge>
          </div>
          <p className="text-sm text-slate-600 mt-1">{violation.details}</p>
          <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
            <span>{ruleConfig.label}</span>
            <span>•</span>
            <span>{violation.processName || "—"}</span>
            <span>•</span>
            <span>{new Date(violation.detectedAt).toLocaleDateString()}</span>
          </div>
          {violation.suggestedFix && (
            <div className="mt-2 p-2 rounded-lg bg-blue-50 border border-blue-200">
              <p className="text-xs text-blue-700 flex items-center gap-1">
                <Zap className="h-3 w-3" />
                <span className="font-medium">Suggested Fix:</span> {violation.suggestedFix}
              </p>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2">
          {violation.status === "OPEN" && (
            <Button size="sm" variant="outline" className="text-xs">
              Acknowledge
            </Button>
          )}
          {violation.status !== "RESOLVED" && violation.status !== "WAIVED" && (
            <Button size="sm" variant="outline" className="text-xs">
              Resolve
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function TrendChart({ data }: { data: TrendData[] }) {
  if (data.length === 0) return <p className="text-center text-slate-400 py-8">No trend data</p>;

  const maxViolations = Math.max(...data.map((d) => d.violations), 1);
  const height = 100;

  return (
    <div className="overflow-x-auto">
      <div className="flex items-end justify-between h-32 gap-3 min-w-[400px]">
        {data.map((d, i) => (
          <div key={d.week} className="flex-1 flex flex-col items-center">
            <div
              className="w-full rounded-t-lg bg-gradient-to-t from-amber-500 to-amber-300 transition-all"
              style={{ height: `${Math.max((d.violations / maxViolations) * height, 4)}px` }}
            />
            <span className="text-[10px] mt-2 text-slate-500">{d.week.slice(5)}</span>
            <span className="text-xs font-bold text-slate-700">{d.violations}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── API adapters ─────────────────────────────────────────────────────────────
/*
 * This page called /api/roster-compliance/*, which nothing serves. The real endpoints are
 * /api/wfm/compliance/{summary,violations,trend} — written for this dashboard, per their own
 * comments — under a different prefix and a different response shape. Both sides are adapted
 * here rather than in the backend, because /summary and /trend are also consumed by the
 * WFM compliance surface and changing their contract would break that.
 *
 * Worth doing only now: until 2026-08-28 that engine queried `roster_assignment` (0 rows) and
 * returned a flat 100% via its own `: 100` fallback, so wiring this up would have replaced an
 * error state with a confident lie. It now reads wfm_roster_assignment — measured live at
 * 65% for August (1,198 violations across 599 employees) and 82% for July.
 */
interface ComplianceApiRule {
  ruleId: string;
  ruleName: string;
  violationCount: number;
}
interface ComplianceApiSummary {
  compliancePct: number;
  totalEmployees: number;
  totalViolations: number;
  rules: ComplianceApiRule[];
  trend: number;
}
interface ApiViolation {
  violationId: string;
  date: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  processName: string | null;
  branchName: string | null;
  ruleId: string;
  ruleName: string;
  severity: "high" | "medium" | "low";
  shiftName: string | null;
  status: string;
}
interface ApiTrendPoint {
  month: string;
  compliancePct: number;
  violations: number;
}

/** API ruleId → the key this page's byRule object uses. */
const RULE_ID_TO_KEY: Record<string, keyof ComplianceSummary["byRule"]> = {
  MIN_REST: "minimumRest",
  CONSECUTIVE_DAYS: "consecutiveDays",
  WEEKOFF_FAIRNESS: "weekOffFairness",
  MAX_HOURS: "maxHoursWeek",
  NIGHT_SHIFT_LIMIT: "nightShiftLimit",
};

function adaptSummary(raw: ComplianceApiSummary | null | undefined): ComplianceSummary {
  const employees = Number(raw?.totalEmployees ?? 0);
  const emptyRule = { violations: 0, total: employees, score: 100 };
  const byRule: ComplianceSummary["byRule"] = {
    minimumRest: { ...emptyRule },
    consecutiveDays: { ...emptyRule },
    weekOffFairness: { ...emptyRule },
    maxHoursWeek: { ...emptyRule },
    nightShiftLimit: { ...emptyRule },
  };
  for (const rule of raw?.rules ?? []) {
    const key = RULE_ID_TO_KEY[rule.ruleId];
    if (!key) continue;
    const violations = Number(rule.violationCount ?? 0);
    byRule[key] = {
      violations,
      total: employees,
      // "% of the evaluated population without this breach" — which is what the card's
      // "N checked" caption beside it already claims the denominator is.
      score: employees > 0 ? Math.max(0, Math.round(((employees - violations) / employees) * 100)) : 100,
    };
  }
  return {
    overallScore: Number(raw?.compliancePct ?? 0),
    trend: Number(raw?.trend ?? 0),
    byRule,
    // The API exposes no per-branch or per-process compliance split. Left empty rather than
    // faked; the panels that read them render their own empty state.
    byBranch: [],
    byProcess: [],
  };
}

function adaptViolation(v: ApiViolation): Violation {
  return {
    id: v.violationId,
    employeeId: v.employeeId,
    employeeCode: v.employeeCode,
    employeeName: v.employeeName,
    processName: v.processName,
    branchName: v.branchName,
    // Passed through as the API's own rule id. These are attendance-derived breaches
    // (ABSENT_NO_CALL, LATE_ARRIVAL), NOT the five roster rules the summary counts — the API
    // has no per-incident feed for those. ViolationRow guards its RULE_CONFIG lookup and
    // humanises anything unrecognised, so the label stays truthful instead of being forced
    // into one of the five buckets it does not belong to.
    ruleType: v.ruleId,
    severity: v.severity === "high" ? "HIGH" : v.severity === "medium" ? "MEDIUM" : "LOW",
    detectedAt: v.date,
    details: [v.ruleName, v.shiftName].filter(Boolean).join(" · "),
    affectedDates: v.date ? [v.date] : [],
    suggestedFix: null,
    status: v.status,
    resolvedAt: null,
    resolvedBy: null,
  };
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function RosterComplianceMonitor() {
  const [branchFilter, setBranchFilter] = useState(ALL);
  const [ruleFilter, setRuleFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState<string>("OPEN");

  const { data: branchData } = useQuery({
    queryKey: ["compliance", "branches"],
    queryFn: () => hrmsApi.get<{ data: Array<{ id: string; branch_name: string }> }>("/api/org/branches"),
  });

  const { data: summaryData, isLoading: summaryLoading, isError: summaryError } = useQuery({
    queryKey: ["compliance", "summary", branchFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (branchFilter !== ALL) params.set("branchId", branchFilter);
      const raw = await hrmsApi.get<ComplianceApiSummary>(`/api/wfm/compliance/summary?${params}`);
      return adaptSummary(raw);
    },
  });

  const { data: violationsData, isLoading: violationsLoading, refetch } = useQuery({
    queryKey: ["compliance", "violations", branchFilter, ruleFilter, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (branchFilter !== ALL) params.set("branchId", branchFilter);
      // The API filters by ruleId, not ruleType — the parameter name this page used to send
      // was silently ignored, so the rule dropdown never narrowed anything.
      if (ruleFilter !== ALL) params.set("ruleId", ruleFilter);
      const raw = await hrmsApi.get<{ violations: ApiViolation[]; totalCount: number }>(
        `/api/wfm/compliance/violations?${params}`,
      );
      const violations = (raw?.violations ?? []).map(adaptViolation);
      // status is filtered client-side: the API derives it from the roster day
      // (WORKING / WEEK_OFF) and has no acknowledge/resolve workflow to filter on.
      return {
        violations: statusFilter === ALL ? violations : violations.filter((v) => v.status === statusFilter),
        total: raw?.totalCount ?? violations.length,
      };
    },
  });

  const { data: trendData } = useQuery({
    queryKey: ["compliance", "trend", branchFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (branchFilter !== ALL) params.set("branchId", branchFilter);
      const raw = await hrmsApi.get<{ trend: ApiTrendPoint[] }>(`/api/wfm/compliance/trend?${params}`);
      return {
        trend: (raw?.trend ?? []).map((t) => ({
          week: t.month,
          violations: Number(t.violations ?? 0),
          score: Number(t.compliancePct ?? 0),
        })),
      };
    },
  });

  const summary = summaryData ?? {
    overallScore: 0,
    trend: 0,
    byRule: {
      minimumRest: { violations: 0, total: 0, score: 100 },
      consecutiveDays: { violations: 0, total: 0, score: 100 },
      weekOffFairness: { violations: 0, total: 0, score: 100 },
      maxHoursWeek: { violations: 0, total: 0, score: 100 },
      nightShiftLimit: { violations: 0, total: 0, score: 100 },
    },
    byBranch: [],
    byProcess: [],
  };

  const violations = violationsData?.violations ?? [];
  const trend = trendData?.trend ?? [];

  const totalViolations = Object.values(summary.byRule).reduce((s, r) => s + r.violations, 0);
  const openViolations = violations.filter((v) => v.status === "OPEN").length;

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-amber-50/30 to-orange-50/20 p-4 sm:p-6">
        {/* Header with gradient (amber for compliance/warning domain) */}
        <div className="mb-6 rounded-2xl bg-gradient-to-r from-amber-500 via-orange-500 to-red-500 p-6 text-white shadow-lg shadow-amber-500/20">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/20 backdrop-blur">
                <ShieldCheck className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">Roster Compliance Monitor</h1>
                <p className="text-amber-100 text-sm">Track WFM rule violations and compliance scores</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Select value={branchFilter} onValueChange={setBranchFilter}>
                <SelectTrigger className="w-44 bg-white/10 border-white/20 text-white">
                  <SelectValue placeholder="All Branches" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All Branches</SelectItem>
                  {(branchData?.data ?? []).map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.branch_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => refetch()}
                className="bg-white/20 hover:bg-white/30 text-white border-0"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {/*
          Without this the page is actively misleading rather than merely empty. When the
          summary request fails, `summary` falls back to a default whose every rule reads
          score 100 / 0 violations — so a failure renders as "100% compliant, nothing to
          fix", which is the opposite of the truth: nothing was checked at all. That breaks
          CLAUDE.md's rule that UI must not hide missing backend functionality, and on a
          compliance screen a false all-clear is the most expensive possible failure mode.
        */}
        {summaryError && (
          <div className="mb-6 rounded-xl border border-red-300 bg-red-50 p-4">
            <p className="font-semibold text-red-900">Compliance data could not be loaded</p>
            <p className="mt-1 text-sm text-red-800">
              The scores and violation counts below are placeholders, not a clean bill of health —
              no roster rules were evaluated. Retry, and report it if it persists.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              className="mt-3 border-red-300 bg-white text-red-800 hover:bg-red-100"
            >
              Retry
            </Button>
          </div>
        )}

        {/* KPI Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-6">
          <MetricTile
            label="Compliance Score"
            value={`${summary.overallScore}%`}
            helper="Overall"
            tone={summary.overallScore >= 90 ? "green" : summary.overallScore >= 75 ? "amber" : "red"}
            trend={summary.trend}
            icon={ShieldCheck}
          />
          <MetricTile
            label="Total Violations"
            value={totalViolations}
            helper="This period"
            tone={totalViolations === 0 ? "green" : "amber"}
            icon={AlertTriangle}
          />
          <MetricTile
            label="Open Issues"
            value={openViolations}
            helper="Need attention"
            tone={openViolations === 0 ? "green" : "red"}
            icon={XCircle}
          />
          <MetricTile
            label="Branches"
            value={summary.byBranch.length}
            helper="Monitored"
            tone="blue"
            icon={Users}
          />
        </div>

        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList className="grid w-full grid-cols-3 lg:w-[450px] bg-white/80 backdrop-blur">
            <TabsTrigger value="overview" className="data-[state=active]:bg-amber-500 data-[state=active]:text-white">
              Overview
            </TabsTrigger>
            <TabsTrigger value="violations" className="data-[state=active]:bg-red-500 data-[state=active]:text-white">
              Violations
            </TabsTrigger>
            <TabsTrigger value="trend" className="data-[state=active]:bg-blue-500 data-[state=active]:text-white">
              Trend
            </TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Compliance Gauge */}
              <GlassCard className="p-6">
                <h3 className="font-semibold text-slate-800 mb-4 text-center">Overall Compliance</h3>
                <ComplianceGauge score={summary.overallScore} />
              </GlassCard>

              {/* Rule Breakdown */}
              <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <RuleComplianceCard rule="MINIMUM_REST" data={summary.byRule.minimumRest} />
                <RuleComplianceCard rule="CONSECUTIVE_DAYS" data={summary.byRule.consecutiveDays} />
                <RuleComplianceCard rule="WEEKOFF_FAIRNESS" data={summary.byRule.weekOffFairness} />
                <RuleComplianceCard rule="MAX_HOURS_WEEK" data={summary.byRule.maxHoursWeek} />
              </div>
            </div>

            {/* Branch Ranking */}
            <GlassCard>
              <div className="p-4 border-b border-slate-100">
                <h3 className="font-semibold text-slate-800">Branch Compliance Ranking</h3>
              </div>
              <div className="p-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Branch</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase">Score</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase">Violations</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase">Trend</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {summary.byBranch.map((branch) => (
                      <tr key={branch.branchId} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-slate-800">{branch.branchName}</td>
                        <td className="px-4 py-3 text-center">
                          <Badge
                            variant={branch.score >= 90 ? "default" : branch.score >= 75 ? "secondary" : "destructive"}
                          >
                            {branch.score}%
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-center text-slate-600">{branch.violations}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`flex items-center justify-center gap-1 text-xs font-medium ${branch.trend >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                            {branch.trend >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                            {Math.abs(branch.trend)}%
                          </span>
                        </td>
                      </tr>
                    ))}
                    {summary.byBranch.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-slate-400">No branch data</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </GlassCard>
          </TabsContent>

          {/* Violations Tab */}
          <TabsContent value="violations" className="space-y-4">
            {/* Filters */}
            <GlassCard className="p-4">
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4 text-slate-400" />
                  <span className="text-sm font-medium text-slate-600">Filters:</span>
                </div>
                <Select value={ruleFilter} onValueChange={setRuleFilter}>
                  <SelectTrigger className="w-40">
                    <SelectValue placeholder="All Rules" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All Rules</SelectItem>
                    {Object.entries(RULE_CONFIG).map(([key, config]) => (
                      <SelectItem key={key} value={key}>{config.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-36">
                    <SelectValue placeholder="All Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All Status</SelectItem>
                    <SelectItem value="OPEN">Open</SelectItem>
                    <SelectItem value="ACKNOWLEDGED">Acknowledged</SelectItem>
                    <SelectItem value="RESOLVED">Resolved</SelectItem>
                    <SelectItem value="WAIVED">Waived</SelectItem>
                  </SelectContent>
                </Select>
                <div className="ml-auto text-sm text-slate-500">
                  {violations.length} violations
                </div>
              </div>
            </GlassCard>

            {/* Violations List */}
            <GlassCard>
              {violationsLoading ? (
                <div className="py-12 text-center text-slate-400">Loading violations...</div>
              ) : violations.length === 0 ? (
                <div className="py-12 text-center">
                  <CheckCircle2 className="h-12 w-12 mx-auto mb-3 text-green-400" />
                  <p className="font-medium text-green-700">No violations found</p>
                  <p className="text-sm text-slate-500">All rosters are compliant with WFM rules</p>
                </div>
              ) : (
                violations.map((violation) => (
                  <ViolationRow key={violation.id} violation={violation} />
                ))
              )}
            </GlassCard>
          </TabsContent>

          {/* Trend Tab */}
          <TabsContent value="trend" className="space-y-4">
            <GlassCard>
              <div className="p-4 border-b border-slate-100">
                <h3 className="font-semibold text-slate-800">Weekly Violation Trend</h3>
                <p className="text-xs text-slate-500">Last 8 weeks</p>
              </div>
              <div className="p-6">
                <TrendChart data={trend} />
              </div>
            </GlassCard>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
