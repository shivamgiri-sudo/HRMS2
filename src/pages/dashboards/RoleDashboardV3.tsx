import { useMemo, useState } from "react";
import type { ElementType, ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Award,
  BarChart3,
  BriefcaseBusiness,
  CalendarCheck2,
  CheckCircle2,
  Clock3,
  CreditCard,
  Database,
  FileCheck2,
  FileText,
  Fingerprint,
  FolderOpen,
  GraduationCap,
  Headphones,
  IndianRupee,
  Inbox,
  Landmark,
  ListChecks,
  Network,
  PieChart as PieChartIcon,
  ReceiptIndianRupee,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
  WalletCards,
} from "lucide-react";
import {
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { ScopedFilterBar, WorkInboxPanel } from "@/components/dashboard";
import { AIInsightPanel } from "@/components/ai";
import { Skeleton } from "@/components/ui/skeleton";
import { hrmsApi } from "@/lib/hrmsApi";
import { cn } from "@/lib/utils";
import { useUserRole } from "@/hooks/useUserRole";

export type RoleDashboardVariant =
  | "employee"
  | "wfm"
  | "wfm_attendance"
  | "hr"
  | "ceo"
  | "payroll"
  | "manager"
  | "super_admin"
  | "quality"
  | "operations"
  | "recruiter";

type Tone = "blue" | "green" | "amber" | "red" | "violet" | "slate";

type MetricResult = {
  value?: number | null;
  previousValue?: number | null;
  variancePct?: number | null;
  target?: number | null;
  status?: "ok" | "warn" | "critical" | "unknown";
  trend?: "up" | "down" | "stable" | null;
  detail?: Record<string, number | null | undefined>;
};

type DashboardSummary = {
  dashboardCode?: string;
  generatedAt?: string;
  workItems?: { pending_count?: number; overdue_count?: number };
  metrics?: Record<string, MetricResult>;
};

type EmployeePayload = {
  attendance: Record<string, number> | null;
  balances: Array<Record<string, unknown>>;
  onboarding: Record<string, unknown> | null;
  lms: Record<string, unknown> | null;
  engagement: Record<string, unknown> | null;
};

type CardMetric = {
  label: string;
  value: number | string | null | undefined;
  helper?: string;
  icon: ElementType;
  tone?: Tone;
  trend?: number | null;
  href?: string;
};

type AlertItem = {
  label: string;
  value: number | string | null | undefined;
  detail: string;
  tone: "red" | "amber" | "blue";
  href?: string;
};

type DashboardConfig = {
  code: string;
  title: string;
  subtitle: string;
  badge: string;
  aiContext: string;
  role: string;
};

const CONFIG: Record<RoleDashboardVariant, DashboardConfig> = {
  employee: {
    code: "EMPLOYEE_SELF_DASHBOARD",
    title: "Employee Dashboard",
    subtitle: "Your attendance, leave, learning and personal actions",
    badge: "Self Service",
    aiContext: "employee_self",
    role: "employee",
  },
  wfm: {
    code: "WFM_DASHBOARD",
    title: "WFM / Attendance Dashboard",
    subtitle: "Headcount, roster, attendance and biometric compliance in real time",
    badge: "WFM View",
    aiContext: "wfm_roster",
    role: "wfm",
  },
  hr: {
    code: "HR_DASHBOARD",
    title: "HR Dashboard",
    subtitle: "Recruitment, onboarding, BGV, privacy and exit operations",
    badge: "HR View",
    aiContext: "hr_operations",
    role: "hr",
  },
  ceo: {
    code: "CEO_DASHBOARD",
    title: "CEO Dashboard",
    subtitle: "Organisation-wide workforce, risk, quality and payroll summary",
    badge: "CEO View",
    aiContext: "executive_dashboard",
    role: "ceo",
  },
  payroll: {
    code: "PAYROLL_HR_DASHBOARD",
    title: "Finance / Payroll Dashboard",
    subtitle: "Payroll operations, employee readiness and financial compliance",
    badge: "Payroll View",
    aiContext: "payroll_readiness",
    role: "payroll",
  },
  manager: {
    code: "MANAGEMENT_DASHBOARD",
    title: "Manager Dashboard",
    subtitle: "Your team, approvals, attendance, performance and follow-ups",
    badge: "Manager View",
    aiContext: "manager_team",
    role: "manager",
  },
  super_admin: {
    code: "CEO_DASHBOARD",
    title: "Super Admin Dashboard",
    subtitle: "Entire HR ecosystem, system health, access and business operations",
    badge: "System Administrator",
    aiContext: "super_admin",
    role: "super_admin",
  },
  quality: {
    code: "QUALITY_DASHBOARD",
    title: "Quality Dashboard",
    subtitle: "Audit scores, defect categories, agent risk and coaching queue",
    badge: "QA View",
    aiContext: "quality_operations",
    role: "qa",
  },
  operations: {
    code: "OPERATIONS_DASHBOARD",
    title: "Operations Dashboard",
    subtitle: "Live call volume, SLA adherence, AHT and floor headcount",
    badge: "Ops View",
    aiContext: "operations",
    role: "operations_manager",
  },
  recruiter: {
    code: "RECRUITER_DASHBOARD",
    title: "Recruitment Dashboard",
    subtitle: "ATS pipeline, walk-ins, offers and joining funnel",
    badge: "Recruiter View",
    aiContext: "ats_recruiter",
    role: "recruiter",
  },
  wfm_attendance: {
    code: "WFM_DASHBOARD",
    title: "WFM / Attendance Dashboard",
    subtitle: "Attendance compliance, shift coverage and biometric exceptions",
    badge: "WFM View",
    aiContext: "wfm_roster",
    role: "wfm",
  },
};

const toneStyles: Record<Tone, { icon: string; value: string; soft: string; border: string }> = {
  blue: { icon: "bg-blue-50 text-blue-600", value: "text-blue-700", soft: "bg-blue-50", border: "border-blue-100" },
  green: { icon: "bg-emerald-50 text-emerald-600", value: "text-emerald-700", soft: "bg-emerald-50", border: "border-emerald-100" },
  amber: { icon: "bg-amber-50 text-amber-600", value: "text-amber-700", soft: "bg-amber-50", border: "border-amber-100" },
  red: { icon: "bg-red-50 text-red-600", value: "text-red-700", soft: "bg-red-50", border: "border-red-100" },
  violet: { icon: "bg-violet-50 text-violet-600", value: "text-violet-700", soft: "bg-violet-50", border: "border-violet-100" },
  slate: { icon: "bg-slate-100 text-slate-600", value: "text-slate-900", soft: "bg-slate-50", border: "border-slate-200" },
};

const chartColors = ["#16a34a", "#f59e0b", "#ef4444", "#2563eb", "#8b5cf6", "#64748b"];

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function metricValue(metrics: Record<string, MetricResult>, key: string): number | null {
  return asNumber(metrics[key]?.value);
}

function metricDetail(metrics: Record<string, MetricResult>, key: string, detailKey: string): number | null {
  return asNumber(metrics[key]?.detail?.[detailKey]);
}

function percent(part: number | null, total: number | null): number | null {
  if (part === null || total === null || total <= 0) return null;
  return Math.round((part / total) * 1000) / 10;
}

function formatValue(value: CardMetric["value"]): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") return value.toLocaleString("en-IN", { maximumFractionDigits: 1 });
  return String(value);
}

function formatCurrency(value: number | null): string {
  if (value === null) return "—";
  if (Math.abs(value) >= 10_000_000) return `₹ ${(value / 10_000_000).toFixed(2)} Cr`;
  if (Math.abs(value) >= 100_000) return `₹ ${(value / 100_000).toFixed(2)} L`;
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);
}

function MetricCard({ metric, loading }: { metric: CardMetric; loading: boolean }) {
  const tone = toneStyles[metric.tone ?? "blue"];
  const Icon = metric.icon;
  const content = (
    <div className={cn(
      "group h-full rounded-2xl border bg-white p-4 shadow-[0_8px_28px_rgba(15,23,42,0.045)] transition-all",
      "hover:-translate-y-0.5 hover:shadow-[0_14px_34px_rgba(15,23,42,0.08)]",
      tone.border,
    )}>
      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-10 rounded-xl" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-8 w-20" />
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-3">
            <div className={cn("flex h-11 w-11 items-center justify-center rounded-xl", tone.icon)}>
              <Icon className="h-5 w-5" />
            </div>
            {metric.trend !== null && metric.trend !== undefined && (
              <span className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-bold",
                metric.trend >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700",
              )}>
                {metric.trend >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                {Math.abs(metric.trend).toFixed(1)}%
              </span>
            )}
          </div>
          <p className="mt-3 text-xs font-bold uppercase tracking-[0.08em] text-slate-500">{metric.label}</p>
          <p className={cn("mt-1 text-3xl font-black tracking-tight", tone.value)}>{formatValue(metric.value)}</p>
          {metric.helper && <p className="mt-1 text-xs leading-5 text-slate-500">{metric.helper}</p>}
        </>
      )}
    </div>
  );

  return metric.href ? <Link to={metric.href} className="block h-full">{content}</Link> : content;
}

function SectionCard({ title, action, children, className }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-2xl border border-slate-200 bg-white shadow-[0_8px_28px_rgba(15,23,42,0.045)]", className)}>
      <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-5 py-4">
        <h2 className="text-sm font-black text-slate-900">{title}</h2>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function AlertStrip({ items }: { items: AlertItem[] }) {
  const visible = items.filter((item) => item.value !== null && item.value !== undefined);
  if (visible.length === 0) return null;
  return (
    <section className="rounded-2xl border border-red-100 bg-gradient-to-r from-red-50/80 to-white p-3 shadow-sm">
      <div className="mb-2 flex items-center gap-2 px-1 text-sm font-black text-slate-900">
        <ShieldAlert className="h-4 w-4 text-red-600" />
        Immediate Actions
      </div>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
        {visible.map((item) => {
          const itemStyle = item.tone === "red"
            ? "border-red-100 bg-white text-red-700"
            : item.tone === "amber"
              ? "border-amber-100 bg-white text-amber-700"
              : "border-blue-100 bg-white text-blue-700";
          const body = (
            <div className={cn("rounded-xl border px-3 py-2.5", itemStyle)}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-black text-slate-800">{item.label}</p>
                <span className="rounded-full bg-current/10 px-2 py-0.5 text-xs font-black">{formatValue(item.value)}</span>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">{item.detail}</p>
            </div>
          );
          return item.href ? <Link key={item.label} to={item.href}>{body}</Link> : <div key={item.label}>{body}</div>;
        })}
      </div>
    </section>
  );
}

function DistributionDonut({ data, centerLabel }: { data: Array<{ name: string; value: number }>; centerLabel: string }) {
  const clean = data.filter((item) => item.value > 0);
  const total = clean.reduce((sum, item) => sum + item.value, 0);
  return (
    <div className="grid items-center gap-4 sm:grid-cols-[190px_1fr]">
      <div className="relative h-44">
        {clean.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={clean} dataKey="value" nameKey="name" innerRadius={55} outerRadius={75} paddingAngle={2}>
                {clean.map((_, index) => <Cell key={index} fill={chartColors[index % chartColors.length]} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center rounded-full border-8 border-slate-100 text-xs text-slate-400">No data</div>
        )}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-black text-slate-900">{total.toLocaleString("en-IN")}</span>
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{centerLabel}</span>
        </div>
      </div>
      <div className="space-y-2.5">
        {clean.map((item, index) => (
          <div key={item.name} className="flex items-center justify-between gap-3 text-sm">
            <div className="flex items-center gap-2 text-slate-600">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: chartColors[index % chartColors.length] }} />
              {item.name}
            </div>
            <span className="font-black text-slate-900">{item.value.toLocaleString("en-IN")}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProgressList({ items }: { items: Array<{ label: string; value: number | null; max?: number; tone?: Tone }> }) {
  return (
    <div className="space-y-4">
      {items.map((item) => {
        const max = item.max && item.max > 0 ? item.max : 100;
        const pct = item.value === null ? 0 : Math.min(100, Math.max(0, (item.value / max) * 100));
        const style = toneStyles[item.tone ?? "blue"];
        return (
          <div key={item.label}>
            <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
              <span className="font-semibold text-slate-600">{item.label}</span>
              <span className={cn("font-black", style.value)}>{item.value === null ? "—" : item.value.toLocaleString("en-IN", { maximumFractionDigits: 1 })}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div className={cn("h-full rounded-full", style.soft, item.tone === "green" ? "bg-emerald-500" : item.tone === "amber" ? "bg-amber-500" : item.tone === "red" ? "bg-red-500" : item.tone === "violet" ? "bg-violet-500" : "bg-blue-500")} style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function QuickActions({ variant }: { variant: RoleDashboardVariant }) {
  const actions: Record<RoleDashboardVariant, Array<{ label: string; href: string; icon: ElementType }>> = {
    employee: [
      { label: "Apply Leave", href: "/leaves", icon: CalendarCheck2 },
      { label: "View Payslip", href: "/payroll/payslips", icon: FileText },
      { label: "Raise Helpdesk", href: "/helpdesk", icon: Headphones },
      { label: "My Documents", href: "/profile", icon: FolderOpen },
    ],
    wfm: [
      { label: "Roster Board", href: "/wfm/auto-roster", icon: Network },
      { label: "Mismatch Queue", href: "/wfm/mismatch-queue", icon: Fingerprint },
      { label: "Attendance", href: "/attendance", icon: UserCheck },
      { label: "Break Reports", href: "/break-reports", icon: Clock3 },
    ],
    hr: [
      { label: "Onboarding", href: "/onboarding", icon: UserPlus },
      { label: "BGV Center", href: "/ats/bgv-verification", icon: ShieldCheck },
      { label: "Employee Master", href: "/employees", icon: Users },
      { label: "Exit Management", href: "/exit/command-center", icon: UserMinus },
    ],
    ceo: [
      { label: "Executive Reports", href: "/reports", icon: BarChart3 },
      { label: "Process P&L", href: "/finance/process-pnl", icon: IndianRupee },
      { label: "Work Inbox", href: "/work-inbox", icon: Inbox },
      { label: "Quality", href: "/quality", icon: Award },
    ],
    payroll: [
      { label: "Run Payroll", href: "/payroll", icon: CreditCard },
      { label: "Readiness", href: "/payroll/branch-readiness", icon: ListChecks },
      { label: "Disbursal", href: "/payroll/disbursal", icon: Landmark },
      { label: "Compliance", href: "/payroll/statutory-filing", icon: FileCheck2 },
    ],
    manager: [
      { label: "My Team", href: "/my-team", icon: Users },
      { label: "Approvals", href: "/work-inbox", icon: ListChecks },
      { label: "Attendance", href: "/attendance", icon: UserCheck },
      { label: "Performance", href: "/performance", icon: Target },
    ],
    super_admin: [
      { label: "Add Employee", href: "/employees", icon: UserPlus },
      { label: "Access Control", href: "/settings/access-control", icon: ShieldCheck },
      { label: "Bulk Import", href: "/bulk-upload", icon: Database },
      { label: "Audit Logs", href: "/audit-log", icon: FileText },
    ],
    quality: [
      { label: "Quality Dashboard", href: "/quality/dashboard", icon: ShieldCheck },
      { label: "Scorecards", href: "/quality/dashboard", icon: FileCheck2 },
      { label: "My Quality", href: "/quality/my-dashboard", icon: Award },
      { label: "QA Reports", href: "/reports", icon: BarChart3 },
    ],
    operations: [
      { label: "Operations Dashboard", href: "/operations/dashboard", icon: Activity },
      { label: "KPI Leaderboard", href: "/operations-kpi", icon: Target },
      { label: "Quality Queue", href: "/quality/dashboard", icon: ShieldCheck },
      { label: "WFM Roster", href: "/wfm/auto-roster", icon: Network },
    ],
    recruiter: [
      { label: "Candidate Pipeline", href: "/ats/candidates", icon: Users },
      { label: "Walk-in Registry", href: "/ats/walkin-queue", icon: UserPlus },
      { label: "ATS Dashboard", href: "/ats/command-center", icon: BarChart3 },
      { label: "Work Inbox", href: "/work-inbox", icon: Inbox },
    ],
    wfm_attendance: [
      { label: "Mark Attendance", href: "/attendance", icon: UserCheck },
      { label: "Manual Punch", href: "/attendance-regularization", icon: Fingerprint },
      { label: "Mismatch Queue", href: "/wfm/mismatch-queue", icon: Clock3 },
      { label: "My Roster", href: "/my-roster", icon: CalendarCheck2 },
    ],
  };

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {actions[variant].map(({ label, href, icon: Icon }) => (
        <Link key={href} to={href} className="group rounded-xl border border-slate-200 bg-slate-50 px-3 py-4 text-center transition hover:border-blue-200 hover:bg-blue-50">
          <Icon className="mx-auto h-5 w-5 text-blue-600" />
          <p className="mt-2 text-xs font-black text-slate-700 group-hover:text-blue-700">{label}</p>
        </Link>
      ))}
    </div>
  );
}

function UpdatedStamp({ generatedAt, refreshing, onRefresh }: { generatedAt?: string; refreshing: boolean; onRefresh: () => void }) {
  const label = generatedAt
    ? new Date(generatedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
    : "Live data";
  return (
    <button onClick={onRefresh} className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-blue-700">
      <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
      {label}
    </button>
  );
}

export default function RoleDashboardV3({ variant, subheader }: { variant: RoleDashboardVariant; subheader?: React.ReactNode }) {
  const config = CONFIG[variant];
  const { data: roleData, isLoading: roleLoading } = useUserRole();
  const [branchId, setBranchId] = useState("");
  const [processId, setProcessId] = useState("");

  const params = useMemo(() => {
    const query = new URLSearchParams();
    if (branchId) query.set("branchId", branchId);
    if (processId) query.set("processId", processId);
    return query.toString() ? `?${query.toString()}` : "";
  }, [branchId, processId]);

  const summaryQuery = useQuery({
    queryKey: ["role-dashboard-v3", config.code, branchId, processId],
    queryFn: () => hrmsApi.get<{ data: DashboardSummary }>(`/api/dashboards/${config.code}/summary${params}`),
    enabled: variant !== "employee",
    staleTime: 30_000,
  });

  const employeeQuery = useQuery<EmployeePayload>({
    queryKey: ["employee-dashboard-v3", roleData?.employeeId],
    enabled: variant === "employee" && !!roleData,
    staleTime: 30_000,
    queryFn: async () => {
      const employeeId = roleData?.employeeId;
      const [attendance, leave, onboarding, lms, engagement] = await Promise.all([
        hrmsApi.get<any>("/api/wfm/my-attendance").catch(() => null),
        hrmsApi.get<any>("/api/leave/balance").catch(() => null),
        hrmsApi.get<any>("/api/ats/my-onboarding-status").catch(() => null),
        employeeId ? hrmsApi.get<any>(`/api/lms/learner-progress/${employeeId}`).catch(() => null) : Promise.resolve(null),
        hrmsApi.get<any>("/api/engagement/me").catch(() => null),
      ]);
      return {
        attendance: attendance?.data ?? attendance ?? null,
        balances: Array.isArray(leave) ? leave : leave?.balances ?? leave?.data ?? [],
        onboarding: onboarding?.data ?? onboarding ?? null,
        lms: lms?.data ?? lms ?? null,
        engagement: engagement?.data ?? engagement ?? null,
      };
    },
  });

  const atsQuery = useQuery({
    queryKey: ["role-dashboard-v3-ats", variant, branchId, processId],
    queryFn: () => hrmsApi.get<any>(`/api/ats/stats${params}`),
    enabled: ["hr", "ceo", "super_admin", "recruiter"].includes(variant),
    staleTime: 60_000,
  });

  const systemQuery = useQuery({
    queryKey: ["role-dashboard-v3-system"],
    queryFn: () => hrmsApi.get<any>("/api/management/system-dashboard"),
    enabled: variant === "super_admin",
    staleTime: 30_000,
  });

  const workforceQuery = useQuery({
    queryKey: ["role-dashboard-v3-workforce", variant, branchId, processId],
    queryFn: () => hrmsApi.get<any>(`/api/management/workforce-dashboard${params}`),
    enabled: ["ceo", "super_admin"].includes(variant),
    staleTime: 60_000,
  });

  const pnlQuery = useQuery({
    queryKey: ["role-dashboard-v3-pnl", variant, branchId, processId],
    queryFn: () => hrmsApi.get<any>(`/api/finance/pnl/summary${params}`),
    enabled: ["ceo", "payroll", "super_admin"].includes(variant),
    staleTime: 60_000,
  });

  const biometricQuery = useQuery({
    queryKey: ["role-dashboard-v3-biometric", branchId, processId],
    queryFn: () => hrmsApi.get<any>(`/api/wfm/biometric-summary/adherence-summary${params}`),
    enabled: variant === "wfm" || variant === "wfm_attendance",
    staleTime: 30_000,
  });

  const qualitySummaryQuery = useQuery({
    queryKey: ["role-dashboard-v3-quality", branchId, processId],
    queryFn: () => hrmsApi.get<any>(`/api/quality-dashboard/summary?${params.replace("?","")}`).catch(() => null),
    enabled: variant === "quality",
    staleTime: 60_000,
  });

  const qualityAgentsQuery = useQuery({
    queryKey: ["role-dashboard-v3-quality-agents", branchId, processId],
    queryFn: () => hrmsApi.get<any>(`/api/quality-dashboard/agents?${params.replace("?","")}`).catch(() => null),
    enabled: variant === "quality",
    staleTime: 60_000,
  });

  const opsPulseQuery = useQuery({
    queryKey: ["role-dashboard-v3-ops-pulse"],
    queryFn: () => hrmsApi.get<any>("/api/bi/daily-operations-pulse").catch(() => null),
    enabled: variant === "operations",
    staleTime: 30_000,
    refetchInterval: variant === "operations" ? 60_000 : false,
  });

  const ceoQualityQuery = useQuery({
    queryKey: ["role-dashboard-v3-ceo-quality", branchId, processId],
    queryFn: () => hrmsApi.get<any>("/api/executive/quality-summary?daysBack=30").catch(() => null),
    enabled: variant === "ceo",
    staleTime: 120_000,
  });

  const summary = summaryQuery.data?.data ?? null;
  const metrics = summary?.metrics ?? {};
  const workItems = summary?.workItems ?? {};
  const employee = employeeQuery.data;
  const ats = atsQuery.data?.data ?? atsQuery.data ?? {};
  const system = systemQuery.data?.data ?? systemQuery.data ?? {};
  const workforce = workforceQuery.data?.data ?? workforceQuery.data ?? {};
  const pnl = pnlQuery.data?.data ?? pnlQuery.data ?? {};
  const biometric = biometricQuery.data?.data ?? biometricQuery.data ?? {};

  const active = metricDetail(metrics, "hc", "active") ?? metricValue(metrics, "hc");
  const required = metricDetail(metrics, "hc", "required");
  const available = metricDetail(metrics, "hc", "available") ?? active;
  const present = metricDetail(metrics, "att", "present");
  const absent = metricDetail(metrics, "att", "absent");
  const late = metricDetail(metrics, "att", "late");
  const missedPunch = metricDetail(metrics, "att", "missedPunch");
  const attendanceRate = metricDetail(metrics, "att", "attendanceRate") ?? metricValue(metrics, "att");
  const onbSubmitted = metricDetail(metrics, "onb", "submitted");
  const onbPending = metricDetail(metrics, "onb", "pending") ?? metricValue(metrics, "onb");
  const onbStuck = metricDetail(metrics, "onb", "stuck");
  const bgvPending = metricDetail(metrics, "bgv", "pending") ?? metricValue(metrics, "bgv");
  const dpdpPending = metricDetail(metrics, "dpdp", "pending") ?? metricValue(metrics, "dpdp");
  const resignationPending = metricDetail(metrics, "resign", "pendingDiscussion") ?? metricValue(metrics, "resign");
  const tatBreached = metricDetail(metrics, "tat", "breached") ?? metricValue(metrics, "tat");
  const nameMismatch = metricDetail(metrics, "nm", "blocking") ?? metricValue(metrics, "nm");
  const incentivePending = metricDetail(metrics, "incentive", "pendingBatches") ?? metricValue(metrics, "incentive");
  const incentiveAmount = metricDetail(metrics, "incentive", "pendingAmount");
  const payrollReady = metricDetail(metrics, "payroll", "readyCount") ?? metricValue(metrics, "payroll");
  const payrollBlocked = metricDetail(metrics, "payroll", "blockerCount");
  const payrollTotal = payrollReady !== null && payrollBlocked !== null ? payrollReady + payrollBlocked : null;
  const payrollReadiness = percent(payrollReady, payrollTotal) ?? metricValue(metrics, "payroll");

  const employeeAttendance = employee?.attendance ?? {};
  const employeePresent = asNumber(employeeAttendance.presentDays);
  const employeeAbsent = asNumber(employeeAttendance.absentDays);
  const employeeLate = asNumber(employeeAttendance.lateDays);
  const employeeAttendancePct = asNumber(employeeAttendance.attendancePct);

  const selectedCandidates = asNumber(ats.selected_candidates ?? ats.selectedCandidates ?? ats.total_selected ?? ats.total);
  const payrollCost = asNumber(pnl?.kpis?.totalDirectCost ?? pnl?.kpis?.organisationPayrollCost ?? pnl?.payroll_liability?.total_gross);
  const revenue = asNumber(pnl?.kpis?.organisationRevenue);
  const shrinkage = asNumber(workforce?.summary?.shrinkage_pct);
  const systemMetrics = system?.metrics ?? {};

  // Quality variant derived values
  const qualityData = qualitySummaryQuery.data?.data ?? qualitySummaryQuery.data ?? {};
  const qualityAgents: any[] = qualityAgentsQuery.data?.data ?? qualityAgentsQuery.data ?? [];
  const qAvgScore = asNumber(qualityData.avg_quality_score ?? qualityData.avg_score ?? qualityData.average_score);
  const qTotalAudits = asNumber(qualityData.audited_calls ?? qualityData.total_audits ?? qualityData.audits_done);
  const qFailRate = asNumber(qualityData.fail_rate ?? qualityData.failure_rate);
  const qPendingQueue = asNumber(qualityData.pending_audits ?? qualityData.queue_size ?? qualityData.pending_count);

  // Operations variant derived values
  const opsPulse = opsPulseQuery.data?.data ?? opsPulseQuery.data ?? {};
  const opsCallsHandled = asNumber(opsPulse.total_calls ?? opsPulse.total_volume ?? opsPulse.calls_handled);
  const opsSlaAdherence = asNumber(opsPulse.login_adherence_pct ?? opsPulse.sla_pct ?? opsPulse.sla_adherence);
  const opsAht = asNumber(opsPulse.avg_aht_seconds ?? opsPulse.avg_handle_time ?? opsPulse.aht);
  const opsAgentsLoggedIn = asNumber(opsPulse.agents_logged_in ?? opsPulse.agents_scheduled);
  const opsFlags: any[] = opsPulse.intervention_flags ?? [];
  const opsVolumeTrend: any[] = opsPulse.volume_trend ?? [];

  // Recruiter variant derived values
  const atsWalkins = asNumber(ats.walkin_today ?? ats.today_walkins ?? (ats.by_stage as any)?.["walk_in"] ?? (ats.by_stage as any)?.["Walk In"]);
  const atsOffersExtended = asNumber(ats.selected_candidates ?? ats.offers_extended);
  const atsJoined = asNumber(ats.joined ?? ats.converted ?? (ats.by_stage as any)?.["converted"] ?? (ats.by_stage as any)?.["onboarded"]);
  const atsOpenPositions: any[] = ats.open_positions ?? ats.open_requisitions ?? [];
  const atsRecentCandidates: any[] = ats.recent_candidates ?? ats.pipeline ?? [];

  // WFM Attendance variant derived values
  const biometricOnLeave = asNumber(biometric.on_leave);
  const biometricWfh = asNumber(biometric.working_remotely);
  const biometricNotMarked = asNumber(biometric.not_marked ?? biometric.not_marked_count);
  const biometricRegSummary = biometric.regularization_summary ?? {};
  const biometricShiftSummary: any[] = biometric.shift_summary ?? [];
  const biometricVariance0_1 = asNumber(biometric.variance_0_1);
  const biometricVariance1_4 = asNumber(biometric.variance_1_4);
  const biometricVariance4Plus = asNumber(biometric.variance_4_plus);

  // CEO quality data
  const ceoQualityData = ceoQualityQuery.data?.data ?? ceoQualityQuery.data ?? {};

  const cards = useMemo<CardMetric[]>(() => {
    switch (variant) {
      case "employee":
        return [
          { label: "Present", value: employeePresent, helper: "Days this month", icon: CheckCircle2, tone: "green" },
          { label: "Absent", value: employeeAbsent, helper: "Days this month", icon: AlertTriangle, tone: employeeAbsent && employeeAbsent > 0 ? "red" : "green" },
          { label: "Late", value: employeeLate, helper: "Days this month", icon: Clock3, tone: employeeLate && employeeLate > 3 ? "amber" : "blue" },
          { label: "Attendance %", value: employeeAttendancePct === null ? null : `${employeeAttendancePct}%`, helper: "Month to date", icon: UserCheck, tone: employeeAttendancePct !== null && employeeAttendancePct >= 90 ? "blue" : "amber" },
        ];
      case "wfm":
        return [
          { label: "Required HC", value: required, helper: "Planned requirement today", icon: Users, tone: "blue", trend: metrics.hc?.variancePct },
          { label: "Available HC", value: available, helper: required !== null && available !== null ? `${required - available} net gap` : "Clocked-in workforce", icon: UserCheck, tone: required !== null && available !== null && available < required ? "amber" : "green" },
          { label: "Roster Adherence", value: attendanceRate === null ? null : `${attendanceRate}%`, helper: "Attendance vs planned roster", icon: Target, tone: attendanceRate !== null && attendanceRate >= 90 ? "violet" : "amber" },
          { label: "Missing Punch", value: missedPunch, helper: "Attendance exceptions today", icon: Clock3, tone: missedPunch && missedPunch > 0 ? "red" : "green" },
        ];
      case "hr":
        return [
          { label: "Selected Candidates", value: selectedCandidates, helper: "Current ATS selection count", icon: UserCheck, tone: "blue" },
          { label: "Onboarding Submitted", value: onbSubmitted, helper: "Ready for HR review", icon: FileCheck2, tone: "green" },
          { label: "Onboarding Pending", value: onbPending, helper: "Awaiting completion or review", icon: Clock3, tone: "amber" },
          { label: "Onboarding Stuck", value: onbStuck, helper: "Requires intervention", icon: AlertTriangle, tone: onbStuck && onbStuck > 0 ? "red" : "green" },
          { label: "BGV Pending", value: bgvPending, helper: "Verification cases open", icon: ShieldCheck, tone: bgvPending && bgvPending > 0 ? "red" : "green" },
          { label: "DPDP Withdrawals", value: dpdpPending, helper: "Privacy requests for review", icon: FileText, tone: dpdpPending && dpdpPending > 0 ? "violet" : "green" },
        ];
      case "ceo":
        return [
          { label: "Login Adherence", value: attendanceRate === null ? null : `${attendanceRate}%`, helper: "Organisation attendance adherence", icon: Fingerprint, tone: "blue", trend: metrics.att?.variancePct },
          { label: "Average Shrinkage", value: shrinkage === null ? null : `${shrinkage}%`, helper: "Workforce shrinkage", icon: Activity, tone: shrinkage !== null && shrinkage > 20 ? "red" : "green" },
          { label: "Revenue MTD", value: formatCurrency(revenue), helper: "Current operating period", icon: IndianRupee, tone: "violet" },
          { label: "Active Headcount", value: active, helper: "Employees in active status", icon: Users, tone: "blue", trend: metrics.hc?.variancePct },
        ];
      case "payroll":
        return [
          { label: "Total Employees", value: active, helper: "Active payroll population", icon: Users, tone: "violet" },
          { label: "Processed Payroll", value: payrollReady, helper: "Payroll-ready employees", icon: FileCheck2, tone: "green" },
          { label: "Pending Payroll", value: payrollBlocked, helper: "Readiness blockers", icon: Clock3, tone: payrollBlocked && payrollBlocked > 0 ? "amber" : "green" },
          { label: "Payroll Cost", value: formatCurrency(payrollCost), helper: "Current available period", icon: IndianRupee, tone: "blue" },
        ];
      case "manager":
        return [
          { label: "Team Members", value: active, helper: "Employees in your scope", icon: Users, tone: "blue" },
          { label: "Present Today", value: present, helper: attendanceRate === null ? "Live attendance" : `${attendanceRate}% attendance`, icon: UserCheck, tone: "green" },
          { label: "Absent", value: absent, helper: "Team members absent", icon: UserMinus, tone: absent && absent > 0 ? "red" : "green" },
          { label: "Late Arrivals", value: late, helper: "Attendance follow-up", icon: Clock3, tone: late && late > 0 ? "amber" : "green" },
          { label: "Onboarding Pending", value: onbPending, helper: "New joiners requiring action", icon: UserPlus, tone: "violet" },
          { label: "Open Actions", value: workItems.pending_count, helper: `${workItems.overdue_count ?? 0} overdue`, icon: Inbox, tone: workItems.overdue_count ? "red" : "blue" },
        ];
      case "super_admin":
        return [
          { label: "Total Employees", value: systemMetrics.activeEmployees ?? active, helper: "Active employee population", icon: Users, tone: "blue" },
          { label: "Present Today", value: present, helper: attendanceRate === null ? "Organisation attendance" : `${attendanceRate}% attendance`, icon: UserCheck, tone: "green" },
          { label: "On Leave / Absent", value: absent, helper: "Attendance exceptions", icon: UserMinus, tone: absent && absent > 0 ? "red" : "green" },
          { label: "Total Roles", value: systemMetrics.totalRoles, helper: "Configured access roles", icon: ShieldCheck, tone: "violet" },
          { label: "System Pages", value: systemMetrics.totalPages, helper: "Permission-controlled pages", icon: Network, tone: "blue" },
          { label: "Integrations", value: systemMetrics.activeIntegrations, helper: `${systemMetrics.configuredIntegrations ?? 0} configured`, icon: Database, tone: "green" },
          { label: "System Health", value: systemMetrics.systemHealth ?? "—", helper: "Application and module status", icon: Activity, tone: systemMetrics.systemHealth === "healthy" ? "green" : "amber" },
        ];
      case "quality":
        return [
          { label: "Avg Audit Score", value: qAvgScore === null ? null : `${qAvgScore.toFixed(1)}%`, helper: "Quality score average", icon: ShieldCheck, tone: qAvgScore !== null && qAvgScore >= 85 ? "green" : qAvgScore !== null && qAvgScore >= 70 ? "amber" : "red" },
          { label: "Audits Completed", value: qTotalAudits, helper: "Total calls audited", icon: FileCheck2, tone: "blue" },
          { label: "Fail Rate", value: qFailRate === null ? null : `${qFailRate.toFixed(1)}%`, helper: "Below quality threshold", icon: AlertTriangle, tone: qFailRate !== null && qFailRate <= 10 ? "green" : qFailRate !== null && qFailRate <= 20 ? "amber" : "red" },
          { label: "Pending Queue", value: qPendingQueue, helper: "Audits awaiting review", icon: Clock3, tone: qPendingQueue !== null && qPendingQueue > 20 ? "red" : qPendingQueue !== null && qPendingQueue > 0 ? "amber" : "green" },
        ];
      case "operations":
        return [
          { label: "Calls Handled", value: opsCallsHandled, helper: "Total calls today", icon: Headphones, tone: "blue" },
          { label: "SLA Adherence", value: opsSlaAdherence === null ? null : `${opsSlaAdherence.toFixed(1)}%`, helper: "Login adherence %", icon: Target, tone: opsSlaAdherence !== null && opsSlaAdherence >= 90 ? "green" : "amber" },
          { label: "Avg Handle Time", value: opsAht === null ? null : `${opsAht}s`, helper: opsAht !== null && opsAht <= 300 ? "On target (≤300s)" : "Above target", icon: Clock3, tone: opsAht !== null && opsAht <= 300 ? "green" : "amber" },
          { label: "Active Agents", value: opsAgentsLoggedIn, helper: "Currently logged in", icon: Users, tone: "violet" },
        ];
      case "recruiter":
        return [
          { label: "Total Applications", value: asNumber(ats.total_candidates ?? ats.total_applications), helper: "All candidates this period", icon: Users, tone: "blue" },
          { label: "Walk-ins Today", value: atsWalkins, helper: "Candidates arrived today", icon: UserPlus, tone: "violet" },
          { label: "Offers Extended", value: atsOffersExtended, helper: "Selected / shortlisted", icon: UserCheck, tone: "green" },
          { label: "Joined", value: atsJoined, helper: "Converted to employees", icon: Award, tone: "green" },
        ];
      case "wfm_attendance":
        return [
          { label: "Total Employees", value: active, helper: "Active headcount", icon: Users, tone: "blue" },
          { label: "Present Today", value: present, helper: attendanceRate === null ? "Live attendance" : `${attendanceRate}% attendance`, icon: UserCheck, tone: "green" },
          { label: "Late Arrivals", value: late, helper: "Attendance exceptions today", icon: Clock3, tone: late && late > 0 ? "amber" : "green" },
          { label: "Absent Today", value: absent, helper: "Unplanned absences", icon: UserMinus, tone: absent && absent > 0 ? "red" : "green" },
          { label: "On Leave", value: biometricOnLeave, helper: "Approved leave today", icon: CalendarCheck2, tone: "violet" },
          { label: "Working Remotely", value: biometricWfh, helper: "WFH / remote today", icon: Network, tone: "slate" },
        ];
    }
  }, [variant, employeePresent, employeeAbsent, employeeLate, employeeAttendancePct, required, available, attendanceRate, missedPunch, metrics, selectedCandidates, onbSubmitted, onbPending, onbStuck, bgvPending, dpdpPending, shrinkage, revenue, active, payrollReady, payrollBlocked, payrollCost, present, absent, late, workItems, systemMetrics, qAvgScore, qTotalAudits, qFailRate, qPendingQueue, opsCallsHandled, opsSlaAdherence, opsAht, opsAgentsLoggedIn, ats, atsWalkins, atsOffersExtended, atsJoined, biometricOnLeave, biometricWfh]);

  const alerts = useMemo<AlertItem[]>(() => {
    if (variant === "employee") {
      return [
        { label: "Attendance", value: employeeAttendancePct === null ? null : `${employeeAttendancePct}%`, detail: "Current month attendance", tone: employeeAttendancePct !== null && employeeAttendancePct < 75 ? "red" : "blue", href: "/attendance" },
        { label: "Late Days", value: employeeLate, detail: "Review your attendance calendar", tone: employeeLate && employeeLate > 3 ? "amber" : "blue", href: "/attendance" },
      ];
    }
    if (variant === "wfm") {
      const gap = required !== null && available !== null ? required - available : null;
      return [
        { label: "Headcount Gap", value: gap, detail: "Required versus available HC", tone: gap && gap > 0 ? "red" : "blue", href: "/wfm/auto-roster" },
        { label: "Missing Punches", value: missedPunch, detail: "Requires attendance correction", tone: missedPunch && missedPunch > 0 ? "red" : "blue", href: "/wfm/mismatch-queue" },
        { label: "Late Arrivals", value: late, detail: "Current attendance exceptions", tone: late && late > 0 ? "amber" : "blue", href: "/attendance" },
      ];
    }
    if (variant === "hr") {
      return [
        { label: "Onboarding Stuck", value: onbStuck, detail: "Cases requiring intervention", tone: "red", href: "/onboarding" },
        { label: "BGV Pending", value: bgvPending, detail: "Open verification cases", tone: "red", href: "/ats/bgv-verification" },
        { label: "DPDP Withdrawal", value: dpdpPending, detail: "Privacy requests pending", tone: "amber", href: "/compliance/dpdp-withdrawal-admin" },
        { label: "Resignation Discussions", value: resignationPending, detail: "Manager discussion pending", tone: "amber", href: "/exit/command-center" },
      ];
    }
    if (variant === "payroll") {
      return [
        { label: "Payroll Blockers", value: payrollBlocked, detail: "Employee records not payroll ready", tone: "red", href: "/payroll/branch-readiness" },
        { label: "Missing Bank", value: metricDetail(metrics, "payroll", "missingBank"), detail: "Bank details incomplete", tone: "red", href: "/payroll/validation" },
        { label: "Missing PAN", value: metricDetail(metrics, "payroll", "missingPan"), detail: "Tax identity incomplete", tone: "amber", href: "/payroll/validation" },
        { label: "Missing UAN", value: metricDetail(metrics, "payroll", "missingUan"), detail: "PF identity incomplete", tone: "amber", href: "/payroll/epf-compliance" },
      ];
    }
    if (variant === "manager") {
      return [
        { label: "Pending Actions", value: workItems.pending_count, detail: "Approvals and team follow-ups", tone: workItems.overdue_count ? "red" : "blue", href: "/work-inbox" },
        { label: "Absent Today", value: absent, detail: "Team attendance follow-up", tone: absent && absent > 0 ? "red" : "blue", href: "/attendance" },
        { label: "Missing Punch", value: missedPunch, detail: "Attendance correction required", tone: missedPunch && missedPunch > 0 ? "amber" : "blue", href: "/attendance-regularization" },
      ];
    }
    if (variant === "quality") {
      return [
        { label: "Fail Rate", value: qFailRate === null ? null : `${qFailRate.toFixed(1)}%`, detail: qFailRate !== null && qFailRate > 20 ? "High fail rate — immediate review needed" : "Quality fail rate", tone: qFailRate !== null && qFailRate > 20 ? "red" : "blue", href: "/quality/dashboard" },
        { label: "Pending Queue", value: qPendingQueue, detail: "Audits awaiting review", tone: qPendingQueue !== null && qPendingQueue > 20 ? "amber" : "blue", href: "/quality/dashboard" },
      ];
    }
    if (variant === "operations") {
      return [
        { label: "SLA Adherence", value: opsSlaAdherence === null ? null : `${opsSlaAdherence.toFixed(1)}%`, detail: opsSlaAdherence !== null && opsSlaAdherence < 90 ? "Below 90% target" : "Login adherence", tone: opsSlaAdherence !== null && opsSlaAdherence < 90 ? "red" : "blue", href: "/operations/dashboard" },
        { label: "Intervention Flags", value: opsFlags.length || null, detail: "Operations flags requiring action", tone: opsFlags.length > 0 ? "amber" : "blue", href: "/operations/dashboard" },
      ];
    }
    if (variant === "recruiter") {
      return [
        { label: "Walk-ins Today", value: atsWalkins, detail: "Candidates arrived for interview", tone: "blue", href: "/ats/candidates" },
        { label: "Open Actions", value: workItems.pending_count, detail: "Pending recruiter follow-ups", tone: workItems.overdue_count ? "red" : "blue", href: "/work-inbox" },
      ];
    }
    if (variant === "wfm_attendance") {
      const gap = required !== null && available !== null ? required - available : null;
      return [
        { label: "Missing Punches", value: missedPunch, detail: "Requires attendance correction", tone: missedPunch && missedPunch > 0 ? "red" : "blue", href: "/wfm/mismatch-queue" },
        { label: "Headcount Gap", value: gap, detail: "Required vs available HC", tone: gap && gap > 0 ? "red" : "blue", href: "/wfm/auto-roster" },
        { label: "Late Arrivals", value: late, detail: "Attendance exceptions today", tone: late && late > 0 ? "amber" : "blue", href: "/attendance" },
      ];
    }
    return [
      { label: "TAT Breached", value: tatBreached, detail: "Items waiting beyond SLA", tone: "red", href: "/work-inbox" },
      { label: "BGV Pending", value: bgvPending, detail: "Verification approvals pending", tone: "red", href: "/ats/bgv-verification" },
      { label: "Name Mismatch", value: nameMismatch, detail: "Blocking employee/candidate records", tone: "red", href: "/ats/name-consistency" },
      { label: "Incentive Pending", value: incentivePending, detail: incentiveAmount === null ? "Pending approval batches" : `${formatCurrency(incentiveAmount)} pending`, tone: "amber", href: "/payroll/incentives" },
      { label: "Payroll Readiness", value: payrollReadiness === null ? null : `${payrollReadiness}%`, detail: "Employee data ready for payroll", tone: payrollReadiness !== null && payrollReadiness < 90 ? "amber" : "blue", href: "/payroll/branch-readiness" },
    ];
  }, [variant, employeeAttendancePct, employeeLate, required, available, missedPunch, late, onbStuck, bgvPending, dpdpPending, resignationPending, payrollBlocked, metrics, workItems, absent, tatBreached, nameMismatch, incentivePending, incentiveAmount, payrollReadiness]);

  const attendanceDistribution = variant === "employee"
    ? [
        { name: "Present", value: employeePresent ?? 0 },
        { name: "Absent", value: employeeAbsent ?? 0 },
        { name: "Late", value: employeeLate ?? 0 },
      ]
    : variant === "wfm_attendance"
    ? [
        { name: "Present", value: present ?? 0 },
        { name: "Late", value: late ?? 0 },
        { name: "Absent", value: absent ?? 0 },
        { name: "On Leave", value: biometricOnLeave ?? 0 },
        { name: "WFH", value: biometricWfh ?? 0 },
        { name: "Not Marked", value: biometricNotMarked ?? 0 },
      ]
    : [
        { name: "Present", value: present ?? 0 },
        { name: "Late", value: late ?? 0 },
        { name: "Absent", value: absent ?? 0 },
        { name: "Missing Punch", value: missedPunch ?? 0 },
      ];

  const trendData = useMemo(() => {
    const movement = workforce?.movement;
    if (Array.isArray(movement) && movement.length > 0) {
      return movement.slice(-8).map((point: any) => ({ label: point.period, value: Number(point.headcount ?? point.value ?? 0) }));
    }
    const current = active ?? present ?? employeePresent;
    if (current === null) return [];
    return [{ label: "Current", value: current }];
  }, [workforce, active, present, employeePresent]);

  const leaveBalances = employee?.balances ?? [];
  const loading = roleLoading || (
    variant === "employee" ? employeeQuery.isLoading
    : variant === "quality" ? qualitySummaryQuery.isLoading
    : variant === "operations" ? opsPulseQuery.isLoading
    : summaryQuery.isLoading
  );
  const refreshing = summaryQuery.isFetching || employeeQuery.isFetching || systemQuery.isFetching
    || qualitySummaryQuery.isFetching || opsPulseQuery.isFetching;
  const generatedAt = summary?.generatedAt;
  const dashboardError = summaryQuery.error ?? employeeQuery.error;

  const refreshAll = () => {
    if (variant === "employee") void employeeQuery.refetch();
    else if (variant === "quality") { void qualitySummaryQuery.refetch(); void qualityAgentsQuery.refetch(); }
    else if (variant === "operations") void opsPulseQuery.refetch();
    else void summaryQuery.refetch();
    if (variant === "super_admin") void systemQuery.refetch();
    if (["ceo", "super_admin"].includes(variant)) void workforceQuery.refetch();
  };

  const displayName = roleData?.employeeName ?? "User";

  return (
    <DashboardLayout subheader={subheader}>
      <div className="min-h-full bg-[#f8fafc] pb-8">
        <div className="space-y-5">
          <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-3xl font-black tracking-tight text-slate-950">
                  {variant === "employee" ? `Welcome, ${displayName}` : config.title}
                </h1>
                <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-black text-blue-700">{config.badge}</span>
              </div>
              <p className="mt-1 text-sm text-slate-500">{config.subtitle}</p>
            </div>
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
              {variant !== "employee" && (
                <ScopedFilterBar
                  onBranchChange={setBranchId}
                  onProcessChange={setProcessId}
                  onDateRangeChange={() => {}}
                  showDateRange={false}
                  className="border-0 bg-transparent p-0 shadow-none"
                />
              )}
              <UpdatedStamp generatedAt={generatedAt} refreshing={refreshing} onRefresh={refreshAll} />
            </div>
          </header>

          {dashboardError && (
            <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <AlertTriangle className="h-4 w-4" />
              Dashboard data could not be fully loaded. Available sections are still shown.
            </div>
          )}

          <AlertStrip items={alerts} />

          <section className={cn("grid gap-3", cards.length >= 7 ? "sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7" : cards.length >= 6 ? "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6" : "sm:grid-cols-2 xl:grid-cols-4")}>
            {cards.map((metric) => <MetricCard key={metric.label} metric={metric} loading={loading} />)}
          </section>

          <section className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
            <SectionCard title={variant === "employee" ? "My Attendance This Month" : variant === "wfm" || variant === "wfm_attendance" ? "Live Attendance Status" : variant === "payroll" ? "Payroll Readiness" : variant === "hr" ? "HR Operations Snapshot" : variant === "manager" ? "Team Attendance" : variant === "super_admin" ? "Organisation Attendance" : variant === "quality" ? "Quality Score Trend" : variant === "operations" ? "Volume Trend" : variant === "recruiter" ? "Hiring Funnel" : "Workforce Overview"}>
              {variant === "quality" ? (
                <div className="h-48">
                  {qualitySummaryQuery.isLoading ? (
                    <div className="flex h-full items-center justify-center"><Skeleton className="h-32 w-full" /></div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={[]} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                        <Tooltip />
                        <Line type="monotone" dataKey="value" stroke="#6366f1" strokeWidth={3} dot={{ r: 3 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                  <p className="mt-2 text-xs text-center text-slate-400">Score trend from audit data</p>
                </div>
              ) : variant === "operations" ? (
                <div className="h-48">
                  {opsVolumeTrend.length > 1 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={opsVolumeTrend.map((p: any) => ({ label: p.period ?? p.hour ?? p.label, value: Number(p.volume ?? p.calls ?? p.value ?? 0) }))}>
                        <Tooltip />
                        <Line type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={3} dot={{ r: 3 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center text-slate-400">
                      <PieChartIcon className="h-8 w-8" />
                      <p className="mt-2 text-sm">Volume trend will appear as data accumulates.</p>
                    </div>
                  )}
                </div>
              ) : variant === "recruiter" ? (
                <RecruiterFunnelPanel ats={ats} />
              ) : variant === "payroll" ? (
                <div className="grid gap-5 md:grid-cols-[220px_1fr]">
                  <DistributionDonut data={[
                    { name: "Ready", value: payrollReady ?? 0 },
                    { name: "Blocked", value: payrollBlocked ?? 0 },
                  ]} centerLabel="Employees" />
                  <ProgressList items={[
                    { label: "Payroll readiness %", value: payrollReadiness, max: 100, tone: payrollReadiness !== null && payrollReadiness >= 90 ? "green" : "amber" },
                    { label: "Missing bank details", value: metricDetail(metrics, "payroll", "missingBank"), max: payrollTotal ?? 100, tone: "red" },
                    { label: "Missing PAN", value: metricDetail(metrics, "payroll", "missingPan"), max: payrollTotal ?? 100, tone: "amber" },
                    { label: "Missing UAN", value: metricDetail(metrics, "payroll", "missingUan"), max: payrollTotal ?? 100, tone: "violet" },
                  ]} />
                </div>
              ) : variant === "hr" ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {[
                    ["Submitted", onbSubmitted, "green"],
                    ["Pending", onbPending, "amber"],
                    ["Stuck", onbStuck, "red"],
                    ["BGV Pending", bgvPending, "red"],
                    ["DPDP Requests", dpdpPending, "violet"],
                    ["Resignation Discussion", resignationPending, "amber"],
                  ].map(([label, value, tone]) => (
                    <div key={String(label)} className={cn("rounded-xl border p-4", toneStyles[tone as Tone].soft, toneStyles[tone as Tone].border)}>
                      <p className="text-xs font-bold text-slate-500">{label}</p>
                      <p className={cn("mt-2 text-2xl font-black", toneStyles[tone as Tone].value)}>{formatValue(value as number | null)}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <DistributionDonut data={attendanceDistribution} centerLabel={variant === "employee" ? "Days" : "Employees"} />
              )}
            </SectionCard>


            <SectionCard title={variant === "employee" ? "My Training & Onboarding" : variant === "wfm" || variant === "wfm_attendance" ? "Biometric Compliance" : variant === "payroll" ? "Payment Summary" : variant === "super_admin" ? "System Health" : variant === "hr" ? "Hiring Pipeline" : variant === "manager" ? "Team Leave Summary" : variant === "quality" ? "Agents Needing Coaching" : variant === "operations" ? "Intervention Flags" : variant === "recruiter" ? "Open Positions" : "Operational Indicators"}>
              {variant === "employee" ? (
                <ProgressList items={[
                  { label: "Course completion", value: asNumber(employee?.lms?.completion_pct), max: 100, tone: "violet" },
                  { label: "MCQ best score", value: asNumber(employee?.lms?.mcq_best_score), max: 100, tone: "green" },
                  { label: "Readiness score", value: asNumber(employee?.lms?.readiness_score), max: 100, tone: "amber" },
                  { label: "Onboarding completion", value: asNumber(employee?.onboarding?.percentComplete), max: 100, tone: "blue" },
                ]} />
              ) : variant === "wfm" ? (
                <ProgressList items={[
                  { label: "Adherence %", value: asNumber(biometric.adherence_pct ?? attendanceRate), max: 100, tone: "green" },
                  { label: "Late %", value: asNumber(biometric.late_pct), max: 100, tone: "amber" },
                  { label: "Shrinkage %", value: asNumber(biometric.shrinkage_pct), max: 100, tone: "violet" },
                  { label: "Absent count", value: asNumber(biometric.absent_count ?? absent), max: active ?? 100, tone: "red" },
                ]} />
              ) : variant === "payroll" ? (
                <div className="space-y-3">
                  {[
                    ["Payroll population", payrollTotal],
                    ["Payroll ready", payrollReady],
                    ["Pending / blocked", payrollBlocked],
                    ["Pending incentive amount", incentiveAmount === null ? null : formatCurrency(incentiveAmount)],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="flex items-center justify-between border-b border-slate-100 pb-3 last:border-0 last:pb-0">
                      <span className="text-sm text-slate-500">{label}</span>
                      <span className="text-sm font-black text-slate-900">{formatValue(value as number | string | null)}</span>
                    </div>
                  ))}
                </div>
              ) : variant === "super_admin" ? (
                <div className="space-y-3">
                  {(Array.isArray(system?.modules) ? system.modules : []).slice(0, 6).map((module: any) => (
                    <div key={module.module} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 px-3 py-2.5">
                      <div>
                        <p className="text-sm font-bold text-slate-800">{module.module}</p>
                        <p className="text-[11px] text-slate-400">{Number(module.recordCount ?? 0).toLocaleString("en-IN")} records</p>
                      </div>
                      <span className={cn("rounded-full px-2 py-1 text-[10px] font-black uppercase", module.status === "operational" ? "bg-emerald-50 text-emerald-700" : module.status === "down" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700")}>{module.status}</span>
                    </div>
                  ))}
                  {(!Array.isArray(system?.modules) || system.modules.length === 0) && <p className="py-8 text-center text-sm text-slate-400">System module data is unavailable.</p>}
                </div>
              ) : variant === "hr" ? (
                <div className="space-y-3">
                  {[
                    { label: "Walk-ins today", value: asNumber(ats.walkin_today ?? ats.today_walkins), tone: "blue" as Tone },
                    { label: "Screened", value: asNumber(ats.screened ?? ats.hr_screened), tone: "violet" as Tone },
                    { label: "Selected", value: asNumber(ats.selected_candidates ?? ats.total_selected), tone: "green" as Tone },
                    { label: "In onboarding", value: onbPending, tone: "amber" as Tone },
                  ].map(({ label, value, tone }) => (
                    <div key={label} className="flex items-center justify-between border-b border-slate-100 pb-2.5 last:border-0 last:pb-0">
                      <span className="text-sm text-slate-500">{label}</span>
                      <span className={cn("text-sm font-black", toneStyles[tone].value)}>{formatValue(value)}</span>
                    </div>
                  ))}
                </div>
              ) : variant === "wfm_attendance" ? (
                <ProgressList items={[
                  { label: "Regularization Pending", value: asNumber(biometricRegSummary.pending), max: (asNumber(biometricRegSummary.pending) ?? 0) + (asNumber(biometricRegSummary.approved) ?? 0) + 1, tone: "amber" },
                  { label: "Approved", value: asNumber(biometricRegSummary.approved), max: asNumber(active) ?? 100, tone: "green" },
                  { label: "Rejected", value: asNumber(biometricRegSummary.rejected), max: asNumber(active) ?? 100, tone: "red" },
                  { label: "Biometric Compliance %", value: asNumber(biometric.biometric_compliance_pct), max: 100, tone: "violet" },
                ]} />
              ) : variant === "quality" ? (
                <div className="space-y-2">
                  {qualityAgents
                    .filter((a: any) => Number(a.avg_score ?? a.quality ?? 0) < 70)
                    .slice(0, 5)
                    .map((a: any) => (
                      <div key={a.agent_name ?? a.agent_code} className="flex items-center justify-between rounded-xl border border-red-100 bg-red-50 px-3 py-2">
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-800 truncate">{a.agent_name ?? a.agent_code ?? "—"}</p>
                          <p className="text-[11px] text-slate-500">{a.band ?? a.process ?? "—"}</p>
                        </div>
                        <span className="text-sm font-black text-red-700 flex-shrink-0 ml-2">{Number(a.avg_score ?? a.quality ?? 0).toFixed(1)}%</span>
                      </div>
                    ))}
                  {qualityAgents.filter((a: any) => Number(a.avg_score ?? a.quality ?? 0) < 70).length === 0 && (
                    <p className="py-6 text-center text-sm text-emerald-600 font-semibold">All agents above 70%</p>
                  )}
                </div>
              ) : variant === "operations" ? (
                <div className="space-y-2">
                  {opsFlags.length > 0 ? opsFlags.slice(0, 6).map((f: any, i: number) => (
                    <div key={i} className={cn("flex items-start gap-2 rounded-xl border px-3 py-2", f.severity === "critical" ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50")}>
                      <AlertTriangle className={cn("h-4 w-4 mt-0.5 flex-shrink-0", f.severity === "critical" ? "text-red-500" : "text-amber-500")} />
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-800 truncate">{f.title ?? f.flag_type ?? "Flag"}</p>
                        <p className="text-[11px] text-slate-500">{f.process ?? f.area ?? "Operations"}</p>
                      </div>
                    </div>
                  )) : (
                    <p className="py-6 text-center text-sm text-emerald-600 font-semibold">No active intervention flags</p>
                  )}
                </div>
              ) : variant === "recruiter" ? (
                <div className="space-y-2">
                  {atsOpenPositions.length > 0 ? atsOpenPositions.slice(0, 5).map((p: any, i: number) => (
                    <div key={i} className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-800 truncate">{p.role ?? p.designation ?? p.title ?? "Open Position"}</p>
                        <p className="text-[11px] text-slate-500">{p.branch ?? p.department ?? p.process ?? "—"}</p>
                      </div>
                      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold flex-shrink-0 ml-2", (p.urgency === "Urgent" || p.priority === "high") ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700")}>{p.openings ?? p.count ?? 1}</span>
                    </div>
                  )) : (
                    <p className="py-6 text-center text-sm text-slate-400">No open positions data</p>
                  )}
                </div>
              ) : variant === "manager" ? (
                <ManagerTeamLeavePanel />
              ) : (
                <div className="h-48">
                  {trendData.length > 1 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={trendData}>
                        <Tooltip />
                        <Line type="monotone" dataKey="value" stroke="#2563eb" strokeWidth={3} dot={{ r: 3 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center text-center text-slate-400">
                      <PieChartIcon className="h-8 w-8" />
                      <p className="mt-2 text-sm">Historical trend will appear as snapshots accumulate.</p>
                    </div>
                  )}
                </div>
              )}
            </SectionCard>
          </section>

          <section className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
            <AIInsightPanel
              contextType={config.aiContext}
              role={config.role}
              title={variant === "employee" ? "Attendance & Leave AI Brief" : variant === "hr" ? "HR Operations AI Briefing" : variant === "ceo" ? "Executive AI Briefing" : variant === "wfm" || variant === "wfm_attendance" ? "Workforce AI Analysis" : variant === "payroll" ? "Payroll Readiness AI Brief" : variant === "manager" ? "Team Management AI Brief" : variant === "quality" ? "Quality AI Brief" : variant === "operations" ? "Operations AI Brief" : variant === "recruiter" ? "Recruitment AI Brief" : "System & Business AI Brief"}
              enabled={!loading}
              data={{
                variant,
                headcount: active,
                required_hc: required,
                available_hc: available,
                attendance_pct: variant === "employee" ? employeeAttendancePct : attendanceRate,
                present,
                absent,
                late,
                missing_punch: missedPunch,
                onboarding_pending: onbPending,
                onboarding_stuck: onbStuck,
                bgv_pending: bgvPending,
                dpdp_pending: dpdpPending,
                payroll_readiness_pct: payrollReadiness,
                payroll_blocked: payrollBlocked,
                tat_breached: tatBreached,
                pending_work_items: workItems.pending_count,
              }}
            />

            <SectionCard title="Quick Actions">
              <QuickActions variant={variant} />
            </SectionCard>
          </section>

          {variant === "employee" && leaveBalances.length > 0 && (
            <SectionCard title="My Leave Balance" action={<Link to="/leaves" className="inline-flex items-center gap-1 text-xs font-bold text-blue-600">View policy <ArrowRight className="h-3 w-3" /></Link>}>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {leaveBalances.slice(0, 8).map((balance: any, index) => {
                  const name = String(balance.leave_name ?? balance.leaveType ?? balance.leave_type ?? balance.name ?? `Leave ${index + 1}`);
                  const remaining = asNumber(balance.available_days ?? balance.balance ?? balance.remaining ?? balance.available);
                  const total = asNumber(balance.allocated_days ?? balance.total ?? balance.entitled ?? balance.allocated);
                  return (
                    <div key={`${name}-${index}`} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-xs font-bold text-slate-500">{name}</p>
                      <p className="mt-2 text-2xl font-black text-emerald-700">{formatValue(remaining)}</p>
                      <p className="mt-1 text-[11px] text-slate-400">{total === null ? "Available balance" : `of ${total} entitled`}</p>
                    </div>
                  );
                })}
              </div>
            </SectionCard>
          )}

          <WorkInboxPanel maxItems={variant === "employee" ? 6 : 8} />

          {variant === "employee" && <CompanyFeedWidget />}

          {variant === "ceo" && (
            <>
              <section className="grid gap-5 lg:grid-cols-3">
                <SectionCard title="Executive Financial Snapshot" className="lg:col-span-2">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {[
                      { label: "Revenue MTD", value: formatCurrency(revenue), icon: WalletCards, tone: "green" as Tone },
                      { label: "Payroll / Direct Cost", value: formatCurrency(payrollCost), icon: ReceiptIndianRupee, tone: "blue" as Tone },
                      { label: "Payroll Readiness", value: payrollReadiness === null ? null : `${payrollReadiness}%`, icon: CreditCard, tone: "violet" as Tone },
                      { label: "Active HC", value: active, icon: Users, tone: "slate" as Tone },
                    ].map((item) => <MetricCard key={item.label} metric={item} loading={loading} />)}
                  </div>
                </SectionCard>
                <SectionCard title="Good / Bad Signals">
                  <CeoSignals
                    attendanceRate={attendanceRate}
                    payrollReadiness={payrollReadiness}
                    bgvPending={bgvPending}
                    payrollBlocked={payrollBlocked}
                    tatBreached={tatBreached}
                    nameMismatch={nameMismatch}
                  />
                </SectionCard>
              </section>

              {/* CEO: Quality Overview */}
              {ceoQualityData && Object.keys(ceoQualityData).length > 0 && (
                <section className="grid gap-5 lg:grid-cols-3">
                  <SectionCard title="Quality Overview — Last 30 Days" className="lg:col-span-2">
                    <div className="grid gap-3 sm:grid-cols-3 mb-4">
                      {[
                        { label: "Org Quality Score", value: ceoQualityData.avg_quality !== undefined ? `${Number(ceoQualityData.avg_quality ?? 0).toFixed(1)}%` : "—", tone: "blue" as Tone },
                        { label: "Quality Target", value: ceoQualityData.target !== undefined ? `${Number(ceoQualityData.target ?? 80).toFixed(0)}%` : "80%", tone: "green" as Tone },
                        { label: "Risk Agents", value: ceoQualityData.risk_agents ?? ceoQualityData.agents_below_threshold ?? "—", tone: "red" as Tone },
                      ].map(({ label, value, tone }) => (
                        <div key={label} className={cn("rounded-xl border p-4", toneStyles[tone].soft, toneStyles[tone].border)}>
                          <p className="text-xs font-bold text-slate-500">{label}</p>
                          <p className={cn("mt-2 text-xl font-black", toneStyles[tone].value)}>{String(value)}</p>
                        </div>
                      ))}
                    </div>
                    {Array.isArray(ceoQualityData.scorecard ?? ceoQualityData.processes) && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead><tr className="border-b text-xs text-slate-400">{["Process", "Avg Score", "Status"].map(h => <th key={h} className="pb-2 text-left font-semibold">{h}</th>)}</tr></thead>
                          <tbody>
                            {(ceoQualityData.scorecard ?? ceoQualityData.processes ?? []).slice(0, 5).map((r: any, i: number) => (
                              <tr key={i} className="border-b last:border-0">
                                <td className="py-2 font-medium text-slate-800">{r.process_name ?? r.process ?? "—"}</td>
                                <td className="py-2 font-black text-slate-700">{Number(r.avg_score ?? r.quality ?? 0).toFixed(1)}%</td>
                                <td className="py-2"><span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", Number(r.avg_score ?? 0) >= 80 ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700")}>{Number(r.avg_score ?? 0) >= 80 ? "On Track" : "At Risk"}</span></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </SectionCard>
                  <SectionCard title="Certified Learners">
                    <div className="space-y-3">
                      {[
                        { label: "Certified Learners", value: formatValue(workforce?.training?.certified_learners) },
                        { label: "In Training", value: formatValue(workforce?.training?.analysts_in_training ?? workforce?.training?.lms_in_progress) },
                        { label: "LMS Trainees", value: formatValue(workforce?.training?.lms_total_trainees) },
                        { label: "Onboarding Active", value: formatValue(workforce?.training?.onboarding_in_progress) },
                      ].map(({ label, value }) => (
                        <div key={label} className="flex items-center justify-between border-b border-slate-100 pb-2.5 last:border-0 last:pb-0">
                          <span className="text-sm text-slate-500">{label}</span>
                          <span className="text-sm font-black text-slate-900">{value}</span>
                        </div>
                      ))}
                    </div>
                  </SectionCard>
                </section>
              )}
            </>
          )}

          {/* Super Admin: Recent Joiners + Branch Snapshot + Approval Queue */}
          {variant === "super_admin" && workforce && Object.keys(workforce).length > 0 && (
            <>
              <section className="grid gap-5 lg:grid-cols-2">
                <SectionCard title="Recent Joiners" action={<Link to="/employees" className="inline-flex items-center gap-1 text-xs font-bold text-blue-600">View all <ArrowRight className="h-3 w-3" /></Link>}>
                  {(Array.isArray(workforce.recent_joiners) && workforce.recent_joiners.length > 0) ? (
                    <div className="space-y-2">
                      {workforce.recent_joiners.slice(0, 6).map((j: any, i: number) => (
                        <div key={i} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-slate-800 truncate">{j.employee_name ?? j.full_name ?? "New Employee"}</p>
                            <p className="text-[11px] text-slate-400">{j.designation_id ?? j.designation ?? "—"} · Joined {j.joining_date?.slice(0, 10) ?? "—"}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="py-6 text-center text-sm text-slate-400">No recent joiners in the last 30 days</p>
                  )}
                </SectionCard>

                <SectionCard title="Branch / Process Snapshot" action={<Link to="/reports" className="inline-flex items-center gap-1 text-xs font-bold text-blue-600">Reports <ArrowRight className="h-3 w-3" /></Link>}>
                  {(Array.isArray(workforce.branches) && workforce.branches.length > 0) ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead><tr className="border-b text-xs text-slate-400">{["Branch", "Emp.", "Present %", "Status"].map(h => <th key={h} className="pb-2 text-left font-semibold">{h}</th>)}</tr></thead>
                        <tbody>
                          {workforce.branches.slice(0, 8).map((b: any, i: number) => (
                            <tr key={i} className="border-b last:border-0">
                              <td className="py-2 font-medium text-slate-800 truncate max-w-[120px]">{b.branch_name ?? "—"}</td>
                              <td className="py-2 text-slate-600">{b.employee_count ?? "—"}</td>
                              <td className="py-2 font-black text-slate-700">{b.present_pct !== undefined ? `${Number(b.present_pct).toFixed(0)}%` : "—"}</td>
                              <td className="py-2"><span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", Number(b.present_pct ?? 0) >= 80 ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700")}>{Number(b.present_pct ?? 0) >= 80 ? "Healthy" : "Warning"}</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="py-6 text-center text-sm text-slate-400">Branch data not available</p>
                  )}
                </SectionCard>
              </section>

              <SectionCard title="Approval Queue">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    { label: "Leave Requests", value: workforce.pending_leave_requests, href: "/leaves", tone: "amber" as Tone },
                    { label: "Timesheet Approvals", value: workItems.pending_count, href: "/work-inbox", tone: "blue" as Tone },
                    { label: "Expense Claims", value: workforce.pending_expense_claims, href: "/expenses/approvals", tone: "violet" as Tone },
                    { label: "Job Requisitions", value: asNumber(ats.pending_requisitions ?? ats.open_positions), href: "/ats/command-center", tone: "green" as Tone },
                  ].map(({ label, value, href, tone }) => (
                    <Link key={label} to={href} className={cn("rounded-xl border p-4 hover:opacity-90 transition", toneStyles[tone].soft, toneStyles[tone].border)}>
                      <p className="text-xs font-bold text-slate-500">{label}</p>
                      <p className={cn("mt-2 text-2xl font-black", toneStyles[tone].value)}>{formatValue(value as number | null)}</p>
                    </Link>
                  ))}
                </div>
              </SectionCard>
            </>
          )}

          {/* WFM Attendance Variant: Variance Buckets */}
          {variant === "wfm_attendance" && (
            <section className="grid gap-4 sm:grid-cols-3">
              {[
                { label: "0–1 hr Late (Minor)", value: biometricVariance0_1, tone: "green" as Tone, detail: "Late by 30–60 mins" },
                { label: "1–4 hr Variance (Moderate)", value: biometricVariance1_4, tone: "amber" as Tone, detail: "Late 1–4 hours" },
                { label: "4+ hr Variance (Critical)", value: biometricVariance4Plus, tone: "red" as Tone, detail: "Late more than 4 hours" },
              ].map(({ label, value, tone, detail }) => (
                <div key={label} className={cn("rounded-xl border p-4", toneStyles[tone].soft, toneStyles[tone].border)}>
                  <p className="text-xs font-bold text-slate-500">{label}</p>
                  <p className={cn("mt-2 text-3xl font-black", toneStyles[tone].value)}>{formatValue(value)}</p>
                  <p className="mt-1 text-[11px] text-slate-400">{detail}</p>
                </div>
              ))}
            </section>
          )}

          {/* WFM Variance Buckets (standard wfm variant) */}
          {variant === "wfm" && (biometricVariance0_1 !== null || biometricVariance1_4 !== null || biometricVariance4Plus !== null) && (
            <section className="grid gap-4 sm:grid-cols-3">
              {[
                { label: "0–1 hr Late (Minor)", value: biometricVariance0_1, tone: "green" as Tone },
                { label: "1–4 hr Variance (Moderate)", value: biometricVariance1_4, tone: "amber" as Tone },
                { label: "4+ hr Variance (Critical)", value: biometricVariance4Plus, tone: "red" as Tone },
              ].map(({ label, value, tone }) => (
                <div key={label} className={cn("rounded-xl border p-4", toneStyles[tone].soft, toneStyles[tone].border)}>
                  <p className="text-xs font-bold text-slate-500">{label}</p>
                  <p className={cn("mt-2 text-3xl font-black", toneStyles[tone].value)}>{formatValue(value)}</p>
                </div>
              ))}
            </section>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

// ── CompanyFeedWidget ──────────────────────────────────────────────────────────

interface FeedPost {
  id: string;
  content_text: string | null;
  author_name: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  media: { file_id: string; sort_order: number }[];
}

function timeAgoShort(iso: string | null): string {
  if (!iso) return "";
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  } catch {
    return "";
  }
}

function CompanyFeedWidget() {
  const feedQuery = useQuery({
    queryKey: ["company-feed-dashboard"],
    queryFn: () => hrmsApi.get<{ success: boolean; data: FeedPost[] }>("/api/engagement/company-posts/feed"),
    staleTime: 120_000,
  });

  const posts: FeedPost[] = (feedQuery.data?.data ?? []).slice(0, 3);

  return (
    <SectionCard
      title="Company Updates"
      action={
        <Link to="/engagement/company-feed" className="inline-flex items-center gap-1 text-xs font-bold text-blue-600">
          View all <ArrowRight className="h-3 w-3" />
        </Link>
      }
    >
      {feedQuery.isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="flex gap-3">
              <Skeleton className="h-8 w-8 rounded-full flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            </div>
          ))}
        </div>
      ) : posts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center text-slate-400">
          <Sparkles className="h-7 w-7 mb-2 text-slate-300" />
          <p className="text-sm">No company updates yet</p>
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {posts.map(post => (
            <div key={post.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
              {post.media.length > 0 ? (
                <img
                  src={`/api/files/${post.media[0].file_id}`}
                  alt=""
                  className="h-12 w-12 flex-shrink-0 rounded-lg object-cover border border-slate-200"
                />
              ) : (
                <div className="h-12 w-12 flex-shrink-0 rounded-lg bg-blue-50 flex items-center justify-center">
                  <Sparkles className="h-5 w-5 text-blue-400" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-bold text-slate-700 truncate">{post.author_name ?? "MAS Callnet"}</p>
                  <span className="text-[11px] text-slate-400 flex-shrink-0">{timeAgoShort(post.approved_at ?? post.submitted_at)}</span>
                </div>
                <p className="mt-0.5 text-sm text-slate-600 line-clamp-2">{post.content_text ?? ""}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

// ── CeoSignals ─────────────────────────────────────────────────────────────────

interface CeoSignalsProps {
  attendanceRate: number | null;
  payrollReadiness: number | null;
  bgvPending: number | null;
  payrollBlocked: number | null;
  tatBreached: number | null;
  nameMismatch: number | null;
}

function CeoSignals({ attendanceRate, payrollReadiness, bgvPending, payrollBlocked, tatBreached, nameMismatch }: CeoSignalsProps) {
  const positive: string[] = [];
  const attention: string[] = [];

  if (attendanceRate !== null) {
    if (attendanceRate >= 90) positive.push(`Attendance ${attendanceRate}% — on target`);
    else attention.push(`Attendance ${attendanceRate}% — below 90% target`);
  }
  if (payrollReadiness !== null) {
    if (payrollReadiness >= 90) positive.push(`Payroll readiness ${payrollReadiness}%`);
    else attention.push(`Payroll readiness ${payrollReadiness}% — below 90%`);
  }
  if (!bgvPending || bgvPending === 0) positive.push("No BGV cases pending");
  else attention.push(`${bgvPending} BGV case${bgvPending > 1 ? "s" : ""} pending`);
  if (!payrollBlocked || payrollBlocked === 0) positive.push("No payroll blockers");
  else attention.push(`${payrollBlocked} payroll blocker${payrollBlocked > 1 ? "s" : ""}`);
  if (tatBreached && tatBreached > 0) attention.push(`${tatBreached} TAT breach${tatBreached > 1 ? "es" : ""}`);
  if (nameMismatch && nameMismatch > 0) attention.push(`${nameMismatch} name mismatch${nameMismatch > 1 ? "es" : ""}`);

  return (
    <div className="space-y-3 text-sm">
      {positive.length > 0 && (
        <div className="rounded-xl bg-emerald-50 p-3">
          <p className="font-black text-emerald-800 mb-1.5">Positive</p>
          <ul className="space-y-1">
            {positive.map(s => (
              <li key={s} className="flex items-center gap-1.5 text-xs text-emerald-700">
                <CheckCircle2 className="h-3 w-3 flex-shrink-0" />{s}
              </li>
            ))}
          </ul>
        </div>
      )}
      {attention.length > 0 && (
        <div className="rounded-xl bg-red-50 p-3">
          <p className="font-black text-red-800 mb-1.5">Needs attention</p>
          <ul className="space-y-1">
            {attention.map(s => (
              <li key={s} className="flex items-center gap-1.5 text-xs text-red-700">
                <AlertTriangle className="h-3 w-3 flex-shrink-0" />{s}
              </li>
            ))}
          </ul>
        </div>
      )}
      {positive.length === 0 && attention.length === 0 && (
        <p className="py-6 text-center text-slate-400 text-xs">Dashboard data loading…</p>
      )}
    </div>
  );
}

// ── ManagerTeamLeavePanel ──────────────────────────────────────────────────────

interface LeaveRequest {
  employee_name?: string;
  full_name?: string;
  leave_type?: string;
  leave_name?: string;
  from_date?: string;
  start_date?: string;
  status?: string;
}

// ── RecruiterFunnelPanel ───────────────────────────────────────────────────────

function RecruiterFunnelPanel({ ats }: { ats: any }) {
  const byStage = ats.by_stage ?? {};
  const applied = Number(ats.total_candidates ?? ats.total_applications ?? 0);
  const screened = Number(byStage.screened ?? byStage["HR Screening"] ?? byStage["hr_screening"] ?? 0);
  const interviewed = Number(byStage.interviewed ?? byStage["Interview"] ?? byStage["interview"] ?? 0);
  const offered = Number(ats.selected_candidates ?? byStage.selected ?? byStage["Selected"] ?? 0);
  const joined = Number(ats.joined ?? byStage.joined ?? byStage["Joined"] ?? byStage["converted"] ?? 0);

  const stages = [
    { label: "Applied", value: applied, color: "#3b82f6" },
    { label: "Screened", value: screened, color: "#8b5cf6" },
    { label: "Interviewed", value: interviewed, color: "#06b6d4" },
    { label: "Offered", value: offered, color: "#f59e0b" },
    { label: "Joined", value: joined, color: "#22c55e" },
  ];

  const max = Math.max(...stages.map(s => s.value), 1);

  return (
    <div className="space-y-2.5">
      {stages.map(s => (
        <div key={s.label} className="flex items-center gap-3">
          <span className="w-20 text-xs font-semibold text-slate-600 flex-shrink-0">{s.label}</span>
          <div className="flex-1 h-6 rounded-lg bg-slate-100 overflow-hidden">
            <div className="h-full rounded-lg flex items-center pl-2 transition-all duration-700"
              style={{ width: `${Math.max((s.value / max) * 100, s.value > 0 ? 8 : 0)}%`, backgroundColor: s.color }}>
              {s.value > 0 && <span className="text-[11px] font-black text-white">{s.value}</span>}
            </div>
          </div>
          {s.value === 0 && <span className="text-xs text-slate-300 font-black w-6">0</span>}
        </div>
      ))}
    </div>
  );
}

function ManagerTeamLeavePanel() {
  const leaveQuery = useQuery({
    queryKey: ["manager-team-leave-panel"],
    queryFn: () => hrmsApi.get<any>("/api/leave/requests?scope=team&status=pending&limit=5").catch(() => null),
    staleTime: 60_000,
  });

  const raw = leaveQuery.data;
  const requests: LeaveRequest[] = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : Array.isArray(raw?.requests) ? raw.requests : [];
  const pendingCount = requests.length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
        <span className="text-sm text-slate-500">Pending approvals</span>
        <span className={cn("text-sm font-black", pendingCount > 0 ? "text-amber-600" : "text-emerald-600")}>{leaveQuery.isLoading ? "…" : pendingCount}</span>
      </div>
      {leaveQuery.isLoading ? (
        <div className="space-y-2">
          {[1, 2].map(i => <Skeleton key={i} className="h-8 w-full rounded-lg" />)}
        </div>
      ) : requests.length === 0 ? (
        <p className="py-4 text-center text-xs text-slate-400">No pending leave requests</p>
      ) : (
        <ul className="space-y-2">
          {requests.slice(0, 4).map((r, i) => (
            <li key={i} className="flex items-center justify-between rounded-lg bg-amber-50 px-3 py-2">
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-700 truncate">{r.employee_name ?? r.full_name ?? "Employee"}</p>
                <p className="text-[11px] text-slate-400">{r.leave_type ?? r.leave_name ?? "Leave"}</p>
              </div>
              <Link to="/approvals/leave" className="text-[11px] font-bold text-amber-600 flex-shrink-0 ml-2">Review</Link>
            </li>
          ))}
        </ul>
      )}
      <Link to="/approvals/leave" className="flex items-center gap-1 text-xs font-bold text-blue-600 pt-1">
        All leave requests <ArrowRight className="h-3 w-3" />
      </Link>
    </div>
  );
}
