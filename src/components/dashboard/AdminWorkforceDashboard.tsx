import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowRight,
  BriefcaseBusiness,
  Building2,
  CalendarCheck2,
  CheckCircle2,
  CircleGauge,
  Clock3,
  Database,
  DollarSign,
  GraduationCap,
  IndianRupee,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
  UserMinus,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { UpdateNotification } from "@/components/dashboard/UpdateNotification";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { hrmsApi } from "@/lib/hrmsApi";
import { cn } from "@/lib/utils";

type ChartPoint = {
  label: string;
  value: number;
};

type MovementPoint = {
  period: string;
  headcount: number;
  joins: number;
  exits: number;
};

type CeoMetricsData = {
  payroll_liability: {
    run_month: string | null;
    total_gross: number;
    total_net: number;
    employer_statutory: number;
    employee_count: number;
  };
  hc_gap: {
    total_gap: number;
    processes_understaffed: number;
    by_process: Array<{
      process_name: string;
      mandated_hc: number;
      required_hc: number;
      active_hc: number;
      gap: number;
    }>;
  };
  revenue_at_risk: {
    total_daily_estimate: number;
    by_process: Array<{
      process_name: string;
      shrinkage_pct: number;
      absent_hc: number;
      daily_revenue_at_risk: number;
      snapshot_date: string | null;
    }>;
  };
  billing: {
    last_month_billed: number;
    billing_month: string | null;
    process_count: number;
  };
  attrition_cost: {
    exits_30d: number;
    replacement_cost_estimate: number;
  };
  hiring_pipeline: {
    open_candidates: number;
    offers_pending_joining: number;
    in_pipeline: number;
  };
  ff_liability: {
    pending_count: number;
    pending_amount: number;
  };
};

type WorkforceDashboardData = {
  generated_at: string;
  summary: {
    active_headcount: number;
    new_joiners_30d: number;
    exits_30d: number;
    attrition_rate_30d: number;
    open_pipeline: number;
    analysts_in_training: number;
    shrinkage_pct: number | null;
    attendance_pct: number | null;
  };
  movement: MovementPoint[];
  headcount_by_department: ChartPoint[];
  headcount_by_branch: ChartPoint[];
  employment_mix: ChartPoint[];
  pipeline: Array<{ stage: string; value: number }>;
  attendance: {
    record_date: string | null;
    data_age_days: number | null;
    total: number;
    statuses: ChartPoint[];
  };
  training: {
    analysts_in_training: number;
    ats_training: number;
    training_stage_candidates: number;
    training_needs_in_progress: number;
    lms_in_progress: number;
    onboarding_in_progress: number;
  };
  actions: {
    pending_leave_approvals: number;
    critical_performance_alerts: number;
    missing_manager: number;
    missing_department: number;
    missing_process: number;
    missing_bank_details: number;
  };
  mandate: {
    active_mandates: number;
    mandated_hc: number;
    required_hc: number;
    gap: number;
  };
  data_readiness: {
    attendance_available: boolean;
    attendance_fresh: boolean;
    training_records_available: boolean;
    workforce_mandates_available: boolean;
  };
};

type SummaryCardProps = {
  label: string;
  value: string;
  helper: string;
  icon: ReactNode;
  href: string;
  tone: "blue" | "green" | "rose" | "amber" | "cyan" | "indigo";
};

const toneClasses: Record<SummaryCardProps["tone"], { panel: string; icon: string; value: string }> = {
  blue: {
    panel: "border-blue-200 bg-blue-50",
    icon: "bg-blue-600 text-white",
    value: "text-blue-950",
  },
  green: {
    panel: "border-emerald-200 bg-emerald-50",
    icon: "bg-emerald-600 text-white",
    value: "text-emerald-950",
  },
  rose: {
    panel: "border-rose-200 bg-rose-50",
    icon: "bg-rose-600 text-white",
    value: "text-rose-950",
  },
  amber: {
    panel: "border-amber-200 bg-amber-50",
    icon: "bg-amber-500 text-white",
    value: "text-amber-950",
  },
  cyan: {
    panel: "border-cyan-200 bg-cyan-50",
    icon: "bg-cyan-600 text-white",
    value: "text-cyan-950",
  },
  indigo: {
    panel: "border-indigo-200 bg-indigo-50",
    icon: "bg-indigo-600 text-white",
    value: "text-indigo-950",
  },
};

const CHART_COLORS = ["#1B6AB5", "#3BAD49", "#F59E0B", "#E11D48", "#0891B2", "#4F46E5"];
const ATTENDANCE_COLORS: Record<string, string> = {
  present: "#3BAD49",
  half_day: "#F59E0B",
  absent: "#E11D48",
  leave_approved: "#4F46E5",
  holiday: "#0891B2",
  week_off: "#64748B",
  unreconciled: "#D97706",
};

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-IN").format(value);
}

function formatLabel(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatMonth(period: string): string {
  const [year, month] = period.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", { month: "short" }).format(new Date(year, month - 1, 1));
}

function inr(value: number): string {
  if (value >= 10_000_000) return `₹${(value / 10_000_000).toFixed(2)} Cr`;
  if (value >= 100_000) return `₹${(value / 100_000).toFixed(2)} L`;
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);
}

type ImpactCardProps = {
  label: string;
  value: string;
  sub: string;
  icon: ReactNode;
  tone: "rose" | "amber" | "blue" | "violet";
};

const impactTone: Record<ImpactCardProps["tone"], { panel: string; icon: string }> = {
  rose:   { panel: "border-rose-800/40 bg-rose-950/60",   icon: "bg-rose-700 text-white" },
  amber:  { panel: "border-amber-700/40 bg-amber-950/60", icon: "bg-amber-600 text-white" },
  blue:   { panel: "border-blue-700/40 bg-blue-950/60",   icon: "bg-blue-700 text-white" },
  violet: { panel: "border-violet-700/40 bg-violet-950/60", icon: "bg-violet-700 text-white" },
};

function BusinessImpactCard({ label, value, sub, icon, tone }: ImpactCardProps) {
  const s = impactTone[tone];
  return (
    <div className={cn("rounded-2xl border p-4", s.panel)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
          <p className="mt-2 text-2xl font-bold tabular-nums text-white">{value}</p>
        </div>
        <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", s.icon)}>
          {icon}
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-400">{sub}</p>
    </div>
  );
}

function SummaryCard({ label, value, helper, icon, href, tone }: SummaryCardProps) {
  const styles = toneClasses[tone];

  return (
    <Link
      to={href}
      className={cn(
        "group block rounded-2xl border p-4 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B6AB5] focus-visible:ring-offset-2",
        styles.panel,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-700">{label}</p>
          <p className={cn("mt-2 text-3xl font-bold tabular-nums", styles.value)}>{value}</p>
        </div>
        <div className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl", styles.icon)}>
          {icon}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="line-clamp-1 text-xs font-medium text-slate-600">{helper}</p>
        <ArrowRight className="size-4 shrink-0 text-slate-500 group-hover:text-slate-900" />
      </div>
    </Link>
  );
}

function ChartCard({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("rounded-2xl border-slate-200 shadow-sm", className)}>
      <CardHeader className="flex flex-row items-start justify-between gap-4 pb-2">
        <div>
          <CardTitle className="text-balance text-base font-bold text-slate-950">{title}</CardTitle>
          <p className="mt-1 text-pretty text-xs leading-5 text-slate-500">{description}</p>
        </div>
        {action}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function EmptyChart({ message, href, action }: { message: string; href: string; action: string }) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
      <Database className="size-8 text-slate-400" />
      <p className="mt-3 max-w-sm text-pretty text-sm font-medium text-slate-700">{message}</p>
      <Button asChild variant="outline" size="sm" className="mt-4 rounded-xl">
        <Link to={href}>{action}</Link>
      </Button>
    </div>
  );
}

function AdminDashboardSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-44 rounded-2xl" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-36 rounded-2xl" />
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <Skeleton className="h-96 rounded-2xl" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    </div>
  );
}

export function AdminWorkforceDashboard() {
  const query = useQuery({
    queryKey: ["admin-workforce-dashboard"],
    queryFn: async () => {
      const response = await hrmsApi.get<{ data: WorkforceDashboardData }>(
        "/api/management/workforce-dashboard",
      );
      return response.data;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const ceoQuery = useQuery({
    queryKey: ["ceo-metrics"],
    queryFn: async () => {
      const response = await hrmsApi.get<{ data: CeoMetricsData }>("/api/management/ceo-metrics");
      return response.data;
    },
    refetchInterval: 120_000,
    staleTime: 60_000,
  });

  if (query.isLoading) return <AdminDashboardSkeleton />;

  if (query.isError || !query.data) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6" role="alert">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 size-5 shrink-0 text-rose-700" />
          <div>
            <h1 className="text-balance text-lg font-bold text-rose-950">Admin analytics could not load</h1>
            <p className="mt-1 text-pretty text-sm text-rose-800">
              The workforce data endpoint is unavailable. Existing HRMS modules remain accessible.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-4 rounded-xl border-rose-300 bg-white"
              onClick={() => query.refetch()}
            >
              Try again
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const data = query.data;
  const shrinkageValue = data.summary.shrinkage_pct;
  const attendanceStale = !data.data_readiness.attendance_fresh;
  const attendanceData = data.attendance.statuses.map((item) => ({
    ...item,
    label: formatLabel(item.label),
    color: ATTENDANCE_COLORS[item.label] ?? "#64748B",
  }));
  const pipelineData = data.pipeline.slice(0, 8).map((item) => ({
    label: formatLabel(item.stage),
    value: item.value,
  }));
  const actionItems = [
    {
      label: "Pending leave approvals",
      value: data.actions.pending_leave_approvals,
      href: "/leave-approvals",
      icon: CalendarCheck2,
      tone: "text-amber-700 bg-amber-50 border-amber-200",
    },
    {
      label: "Critical performance alerts",
      value: data.actions.critical_performance_alerts,
      href: "/management/dashboard",
      icon: ShieldAlert,
      tone: "text-rose-700 bg-rose-50 border-rose-200",
    },
    {
      label: "Employees without manager",
      value: data.actions.missing_manager,
      href: "/employees",
      icon: Users,
      tone: "text-blue-700 bg-blue-50 border-blue-200",
    },
    {
      label: "Missing department or process",
      value: data.actions.missing_department + data.actions.missing_process,
      href: "/employees",
      icon: Building2,
      tone: "text-indigo-700 bg-indigo-50 border-indigo-200",
    },
    {
      label: "Bank details incomplete",
      value: data.actions.missing_bank_details,
      href: "/employees",
      icon: AlertCircle,
      tone: "text-cyan-700 bg-cyan-50 border-cyan-200",
    },
  ];

  return (
    <div className="space-y-5">
      <UpdateNotification />

      <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 text-white shadow-md">
        <div className="grid gap-0 xl:grid-cols-[1.25fr_0.75fr]">
          <div className="p-6 sm:p-7">
            <Badge className="border-blue-400/30 bg-blue-400/10 text-blue-100 hover:bg-blue-400/10">
              <CircleGauge className="mr-1.5 size-3.5" />
              Admin workforce command center
            </Badge>
            <h1 className="mt-4 max-w-3xl text-balance text-3xl font-bold sm:text-4xl">
              Know where the workforce stands, and what needs action.
            </h1>
            <p className="mt-3 max-w-2xl text-pretty text-sm leading-6 text-slate-300">
              Headcount, hiring, training, attrition and attendance are brought together with operational
              queues so the dashboard leads to decisions, not just reports.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button asChild className="rounded-xl bg-[#1B6AB5] text-white hover:bg-[#155A9A]">
                <Link to="/employees">
                  <Users className="mr-2 size-4" />
                  Open workforce
                </Link>
              </Button>
              <Button asChild variant="outline" className="rounded-xl border-slate-600 bg-slate-900 text-white hover:bg-slate-800 hover:text-white">
                <Link to="/reports">
                  <TrendingUp className="mr-2 size-4" />
                  Detailed reports
                </Link>
              </Button>
            </div>
          </div>

          <div className="border-t border-slate-800 bg-slate-900 p-6 xl:border-l xl:border-t-0">
            <p className="text-sm font-semibold text-slate-200">Data confidence</p>
            <div className="mt-4 space-y-3">
              {[
                {
                  label: "Attendance feed",
                  ready: data.data_readiness.attendance_fresh,
                  detail: data.attendance.record_date
                    ? `Last record ${data.attendance.record_date}`
                    : "No attendance records",
                },
                {
                  label: "Training integration",
                  ready: data.data_readiness.training_records_available,
                  detail: data.data_readiness.training_records_available
                    ? "Active records available"
                    : "Awaiting ATS/LMS training records",
                },
                {
                  label: "Workforce mandates",
                  ready: data.data_readiness.workforce_mandates_available,
                  detail: data.data_readiness.workforce_mandates_available
                    ? `${data.mandate.active_mandates} active mandate(s)`
                    : "Capacity targets not configured",
                },
              ].map((item) => (
                <div key={item.label} className="flex items-start gap-3 rounded-xl border border-slate-700 bg-slate-950 p-3">
                  {item.ready ? (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" />
                  ) : (
                    <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-400" />
                  )}
                  <div>
                    <p className="text-xs font-semibold text-white">{item.label}</p>
                    <p className="mt-0.5 text-xs text-slate-400">{item.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section aria-label="Key workforce indicators" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <SummaryCard
          label="Active headcount"
          value={formatNumber(data.summary.active_headcount)}
          helper={`${formatNumber(data.mandate.required_hc)} required by active mandates`}
          icon={<Users className="size-5" />}
          href="/employees"
          tone="blue"
        />
        <SummaryCard
          label="Joined in 30 days"
          value={formatNumber(data.summary.new_joiners_30d)}
          helper="New employees entering ramp"
          icon={<UserPlus className="size-5" />}
          href="/onboarding"
          tone="green"
        />
        <SummaryCard
          label="Exited in 30 days"
          value={formatNumber(data.summary.exits_30d)}
          helper={`${data.summary.attrition_rate_30d.toFixed(1)}% rolling attrition`}
          icon={<UserMinus className="size-5" />}
          href="/exit-management"
          tone="rose"
        />
        <SummaryCard
          label="Attendance shrinkage"
          value={shrinkageValue === null ? "N/A" : `${shrinkageValue.toFixed(1)}%`}
          helper={attendanceStale ? "Attendance feed needs refresh" : "Latest attendance-based view"}
          icon={<TrendingDown className="size-5" />}
          href="/wfm/extensions"
          tone="amber"
        />
        <SummaryCard
          label="Analysts in training"
          value={formatNumber(data.summary.analysts_in_training)}
          helper={`${formatNumber(data.training.onboarding_in_progress)} onboarding cases in progress`}
          icon={<GraduationCap className="size-5" />}
          href="/lms/admin"
          tone="cyan"
        />
        <SummaryCard
          label="Open talent pipeline"
          value={formatNumber(data.summary.open_pipeline)}
          helper="Active candidates across ATS stages"
          icon={<BriefcaseBusiness className="size-5" />}
          href="/ats/dashboard"
          tone="indigo"
        />
      </section>

      {/* ── Business Impact ─────────────────────────────────────────── */}
      {ceoQuery.data && (
        <section aria-label="Business impact indicators">
          <div className="mb-3 flex items-center gap-2">
            <IndianRupee className="size-4 text-slate-400" />
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Business Impact</h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <BusinessImpactCard
              label="Daily Revenue at Risk"
              value={inr(ceoQuery.data.revenue_at_risk.total_daily_estimate)}
              sub={`${ceoQuery.data.hc_gap.processes_understaffed} process(es) with absent HC today`}
              icon={<TrendingDown className="size-5" />}
              tone="rose"
            />
            <BusinessImpactCard
              label="HC Shortfall"
              value={`${ceoQuery.data.hc_gap.total_gap} heads`}
              sub={`Across ${ceoQuery.data.hc_gap.processes_understaffed} understaffed process(es)`}
              icon={<Users className="size-5" />}
              tone="amber"
            />
            <BusinessImpactCard
              label="Payroll Liability"
              value={inr(ceoQuery.data.payroll_liability.total_gross)}
              sub={
                ceoQuery.data.payroll_liability.run_month
                  ? `${ceoQuery.data.payroll_liability.employee_count} employees · ${ceoQuery.data.payroll_liability.run_month}`
                  : "Latest draft run"
              }
              icon={<Wallet className="size-5" />}
              tone="blue"
            />
            <BusinessImpactCard
              label="Attrition Cost (30d)"
              value={inr(ceoQuery.data.attrition_cost.replacement_cost_estimate)}
              sub={`${ceoQuery.data.attrition_cost.exits_30d} exits · est. replacement cost`}
              icon={<DollarSign className="size-5" />}
              tone="violet"
            />
          </div>

          {ceoQuery.data.hc_gap.by_process.filter(p => p.gap > 0).length > 0 && (
            <div className="mt-4 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
              <div className="flex items-center justify-between gap-4 px-5 py-3">
                <p className="text-sm font-bold text-slate-200">HC Gap by Process</p>
                <Badge className="border-rose-500/30 bg-rose-500/10 text-rose-300">
                  {ceoQuery.data.hc_gap.total_gap} heads short
                </Badge>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-t border-slate-800 text-left text-slate-400">
                      <th className="px-5 py-2 font-semibold">Process</th>
                      <th className="px-4 py-2 text-right font-semibold">Mandated</th>
                      <th className="px-4 py-2 text-right font-semibold">Required</th>
                      <th className="px-4 py-2 text-right font-semibold">Active</th>
                      <th className="px-4 py-2 text-right font-semibold">Gap</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ceoQuery.data.hc_gap.by_process
                      .filter(p => p.gap > 0)
                      .slice(0, 8)
                      .map(p => (
                        <tr key={p.process_name} className="border-t border-slate-800/60 hover:bg-slate-800/40">
                          <td className="px-5 py-2.5 font-medium text-slate-200">{p.process_name}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-slate-400">{p.mandated_hc}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-slate-400">{p.required_hc}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-slate-400">{p.active_hc}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-bold text-rose-400">{p.gap}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      <section className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <ChartCard
          title="Workforce movement"
          description="Six-month headcount trend with joiners and exits. Use it to spot whether hiring is keeping pace with losses."
          action={
            <Button asChild variant="ghost" size="sm" className="rounded-xl text-xs">
              <Link to="/reports">View report</Link>
            </Button>
          }
        >
          <div className="h-80" aria-label="Workforce movement chart">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data.movement} margin={{ top: 20, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="period" tickFormatter={formatMonth} tick={{ fill: "#64748B", fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="movement" tick={{ fill: "#64748B", fontSize: 12 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis yAxisId="headcount" orientation="right" tick={{ fill: "#64748B", fontSize: 12 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip
                  formatter={(value: number, name: string) => [formatNumber(value), formatLabel(name)]}
                  labelFormatter={(label) => `Month: ${formatMonth(String(label))}`}
                  contentStyle={{ borderRadius: 12, borderColor: "#CBD5E1", boxShadow: "0 10px 15px -3px rgb(15 23 42 / 0.1)" }}
                />
                <Legend formatter={(value) => formatLabel(value)} />
                <Bar yAxisId="movement" dataKey="joins" fill="#3BAD49" radius={[5, 5, 0, 0]} isAnimationActive={false} />
                <Bar yAxisId="movement" dataKey="exits" fill="#E11D48" radius={[5, 5, 0, 0]} isAnimationActive={false} />
                <Line yAxisId="headcount" type="monotone" dataKey="headcount" stroke="#1B6AB5" strokeWidth={3} dot={{ r: 3, fill: "#1B6AB5" }} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard
          title="Headcount by department"
          description="Largest active departments, including unassigned records that require HR cleanup."
          action={
            <Badge variant="outline" className="tabular-nums">
              {formatNumber(data.summary.active_headcount)} total
            </Badge>
          }
        >
          {data.headcount_by_department.length > 0 ? (
            <div className="h-80" aria-label="Department headcount chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.headcount_by_department} layout="vertical" margin={{ top: 8, right: 20, left: 8, bottom: 0 }}>
                  <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={{ fill: "#64748B", fontSize: 12 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <YAxis dataKey="label" type="category" width={110} tick={{ fill: "#475569", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    formatter={(value: number) => [formatNumber(value), "Employees"]}
                    contentStyle={{ borderRadius: 12, borderColor: "#CBD5E1" }}
                  />
                  <Bar dataKey="value" fill="#1B6AB5" radius={[0, 6, 6, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyChart message="Department assignments are not available yet." href="/org-masters" action="Configure departments" />
          )}
        </ChartCard>
      </section>

      <section className="grid gap-5 xl:grid-cols-3">
        <ChartCard
          title="Talent pipeline"
          description="Candidate volume by current ATS stage. Large early-stage queues need recruiter capacity and ageing checks."
        >
          {pipelineData.length > 0 ? (
            <div className="h-72" aria-label="Talent pipeline chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={pipelineData} margin={{ top: 12, right: 8, left: 0, bottom: 44 }}>
                  <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" angle={-28} textAnchor="end" height={72} interval={0} tick={{ fill: "#64748B", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#64748B", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip formatter={(value: number) => [formatNumber(value), "Candidates"]} contentStyle={{ borderRadius: 12, borderColor: "#CBD5E1" }} />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]} isAnimationActive={false}>
                    {pipelineData.map((item, index) => (
                      <Cell key={item.label} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyChart message="No active ATS pipeline records are available." href="/ats/dashboard" action="Open ATS" />
          )}
        </ChartCard>

        <ChartCard
          title="Attendance composition"
          description={
            data.attendance.record_date
              ? `Latest processed date: ${data.attendance.record_date}${attendanceStale ? " (stale)" : ""}.`
              : "No attendance processing date is available."
          }
          action={
            attendanceStale ? (
              <Badge className="border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-50">
                <Clock3 className="mr-1 size-3" />
                Refresh needed
              </Badge>
            ) : undefined
          }
        >
          {attendanceData.length > 0 ? (
            <div className="h-72" aria-label="Attendance composition chart">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={attendanceData}
                    dataKey="value"
                    nameKey="label"
                    cx="50%"
                    cy="46%"
                    innerRadius={60}
                    outerRadius={94}
                    paddingAngle={2}
                    isAnimationActive={false}
                  >
                    {attendanceData.map((item) => (
                      <Cell key={item.label} fill={item.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number) => [formatNumber(value), "Employees"]} contentStyle={{ borderRadius: 12, borderColor: "#CBD5E1" }} />
                  <Legend verticalAlign="bottom" height={40} formatter={(value) => formatLabel(value)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyChart message="Attendance records have not been processed yet." href="/attendance" action="Open attendance" />
          )}
        </ChartCard>

        <ChartCard
          title="Employment mix"
          description="Active workforce composition by employee category or employment type."
        >
          {data.employment_mix.length > 0 ? (
            <div className="h-72" aria-label="Employment mix chart">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.employment_mix}
                    dataKey="value"
                    nameKey="label"
                    cx="50%"
                    cy="46%"
                    innerRadius={46}
                    outerRadius={92}
                    isAnimationActive={false}
                  >
                    {data.employment_mix.map((item, index) => (
                      <Cell key={item.label} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number) => [formatNumber(value), "Employees"]} contentStyle={{ borderRadius: 12, borderColor: "#CBD5E1" }} />
                  <Legend verticalAlign="bottom" height={40} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyChart message="Employment category data is not available." href="/employees" action="Review employees" />
          )}
        </ChartCard>
      </section>

      <section className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <ChartCard
          title="Training and ramp pipeline"
          description="Separates hiring-stage training, employee learning and onboarding so zero records are visible rather than hidden."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { label: "ATS analysts in training", value: data.training.analysts_in_training, icon: GraduationCap, color: "bg-cyan-50 text-cyan-700 border-cyan-200" },
              { label: "LMS courses in progress", value: data.training.lms_in_progress, icon: TrendingUp, color: "bg-blue-50 text-blue-700 border-blue-200" },
              { label: "Training needs active", value: data.training.training_needs_in_progress, icon: CircleGauge, color: "bg-indigo-50 text-indigo-700 border-indigo-200" },
              { label: "Onboarding in progress", value: data.training.onboarding_in_progress, icon: UserPlus, color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
            ].map((item) => (
              <div key={item.label} className={cn("rounded-xl border p-4", item.color)}>
                <div className="flex items-center justify-between gap-3">
                  <item.icon className="size-5" />
                  <span className="text-2xl font-bold tabular-nums">{formatNumber(item.value)}</span>
                </div>
                <p className="mt-3 text-xs font-semibold">{item.label}</p>
              </div>
            ))}
          </div>
          {!data.data_readiness.training_records_available && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
              ATS payroll training and LMS progress feeds currently contain no active records. Configure those
              integrations before using training count as a staffing commitment.
            </div>
          )}
        </ChartCard>

        <ChartCard
          title="Admin action queue"
          description="The highest-value items to resolve now. Every row opens the module where action can be completed."
        >
          <div className="space-y-2">
            {actionItems.map((item) => (
              <Link
                key={item.label}
                to={item.href}
                className="group flex items-center justify-between gap-4 rounded-xl border border-slate-200 p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B6AB5]"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl border", item.tone)}>
                    <item.icon className="size-4" />
                  </div>
                  <p className="truncate text-sm font-semibold text-slate-800">{item.label}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold tabular-nums text-slate-950">{formatNumber(item.value)}</span>
                  <ArrowRight className="size-4 text-slate-400 group-hover:text-slate-900" />
                </div>
              </Link>
            ))}
          </div>
        </ChartCard>
      </section>
    </div>
  );
}
