import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Award,
  BarChart3,
  Building2,
  Calendar,
  CalendarCheck,
  CheckCircle2,
  Clock,
  CreditCard,
  FileText,
  Flame,
  GraduationCap,
  Heart,
  IndianRupee,
  Inbox,
  Minus,
  ShieldCheck,
  Sparkles,
  Star,
  TrendingDown,
  TrendingUp,
  Trophy,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
  Zap,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { hrmsApi } from "@/lib/hrmsApi";
import { useAuth } from "@/contexts/AuthContext";
import { useIsAdminOrHR, useUserRole } from "@/hooks/useUserRole";
import type {
  EngagementSummary,
  LeaderboardEntry,
  ApiResponse,
} from "@/components/engagement/types";

// ── Types ────────────────────────────────────────────────────────────────────

type MetricStatus = "ok" | "warn" | "critical" | "unknown";

type MetricResult = {
  value: number | null;
  previousValue: number | null;
  target: number | null;
  variancePct: number | null;
  status: MetricStatus;
  trend: "up" | "down" | "stable" | null;
};

type DashboardSummary = {
  workItems: { pending_count: number; overdue_count: number };
  metrics: {
    hc: MetricResult;
    att: MetricResult;
    payroll: MetricResult;
    resign: MetricResult;
    bgv: MetricResult;
    onb: MetricResult;
  };
};

type MovementPoint = { period: string; headcount: number; joins: number; exits: number };
type ChartPoint = { label: string; value: number };

type WorkforceDashboard = {
  summary: {
    active_headcount: number;
    new_joiners_30d: number;
    exits_30d: number;
    attrition_rate_30d: number;
    open_pipeline: number;
    shrinkage_pct: number | null;
    attendance_pct: number | null;
  };
  movement: MovementPoint[];
  attendance: { statuses: ChartPoint[] };
  pipeline: Array<{ stage: string; value: number }>;
  training: {
    analysts_in_training: number;
    onboarding_in_progress: number;
    lms_in_progress: number;
  };
};

type CeoMetrics = {
  payroll_liability: {
    total_gross: number;
    total_net: number;
    employer_statutory: number;
    employee_count: number;
    run_month: string | null;
  };
  revenue_at_risk: {
    total_daily_estimate: number;
    by_process: Array<{
      process_name: string;
      shrinkage_pct: number;
      daily_revenue_at_risk: number;
    }>;
  };
  hiring_pipeline: { open_candidates: number; offers_pending_joining: number; in_pipeline: number };
};

// ── Constants ────────────────────────────────────────────────────────────────

const ATTENDANCE_COLORS: Record<string, string> = {
  present: "#22C55E",
  half_day: "#F59E0B",
  absent: "#EF4444",
  leave_approved: "#818CF8",
  holiday: "#22D3EE",
  week_off: "#64748B",
  unreconciled: "#D97706",
};

const PIPELINE_COLORS = ["#1B6AB5", "#2D86D4", "#40A3F5", "#7CC2FF", "#B3DAFF", "#D6ECFF"];

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatINR(val: number): string {
  if (val >= 10_000_000) return `₹${(val / 10_000_000).toFixed(1)}Cr`;
  if (val >= 100_000) return `₹${(val / 100_000).toFixed(1)}L`;
  if (val >= 1_000) return `₹${(val / 1_000).toFixed(1)}K`;
  return `₹${val}`;
}

function getHourGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function statusGlow(status: MetricStatus): string {
  return {
    ok: "shadow-[0_0_18px_rgba(34,197,94,0.25)] ring-1 ring-emerald-500/30",
    warn: "shadow-[0_0_18px_rgba(245,158,11,0.25)] ring-1 ring-amber-400/30",
    critical: "shadow-[0_0_18px_rgba(239,68,68,0.30)] ring-1 ring-red-500/40",
    unknown: "",
  }[status];
}

function statusDot(status: MetricStatus): string {
  return {
    ok: "bg-emerald-400",
    warn: "bg-amber-400",
    critical: "bg-red-500 animate-pulse",
    unknown: "bg-slate-600",
  }[status];
}

// ── KPI Tile ─────────────────────────────────────────────────────────────────

type KpiTileProps = {
  label: string;
  value: string | number;
  helper: string;
  icon: React.ReactNode;
  metric?: MetricResult | null;
  accent?: string;
};

function KpiTile({ label, value, helper, icon, metric, accent = "#1B6AB5" }: KpiTileProps) {
  const status: MetricStatus = metric?.status ?? "unknown";
  const trend = metric?.trend ?? null;
  const variancePct = metric?.variancePct ?? null;

  const TrendIcon =
    trend === "up" ? ArrowUpRight : trend === "down" ? ArrowDownRight : Minus;
  const trendColor =
    trend === "up" ? "text-emerald-400" : trend === "down" ? "text-red-400" : "text-slate-500";

  return (
    <div
      className={`group relative overflow-hidden rounded-2xl bg-slate-900 border border-slate-800 p-5 transition-all duration-300 hover:scale-[1.025] hover:-translate-y-0.5 cursor-pointer ${statusGlow(status)}`}
    >
      {/* Status dot */}
      <span className={`absolute top-4 right-4 h-2 w-2 rounded-full ${statusDot(status)}`} />

      <div className="flex items-start gap-3">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-lg"
          style={{ backgroundColor: accent, boxShadow: `0 4px 16px ${accent}40` }}
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">{label}</p>
          <p
            className="mt-1.5 text-3xl font-black text-slate-50 tabular-nums"
            style={{ fontFamily: "'Fira Code', monospace" }}
          >
            {value}
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <p className="text-xs font-medium text-slate-500 truncate pr-2">{helper}</p>
        {variancePct !== null && (
          <span className={`flex items-center gap-0.5 text-xs font-bold shrink-0 ${trendColor}`}>
            <TrendIcon className="h-3 w-3" />
            {Math.abs(variancePct).toFixed(1)}%
          </span>
        )}
      </div>
    </div>
  );
}

// ── Employee KPI tiles ────────────────────────────────────────────────────────

type EmployeeKpiData = {
  myAttendancePct: number;
  leaveBalance: number;
  myTasks: number;
  points: number;
  tierName: string;
  badges: number;
};

function EmployeeKpiRow({ data }: { data: EmployeeKpiData }) {
  const tiles = [
    { label: "My Attendance MTD", value: `${data.myAttendancePct}%`, helper: "month to date", icon: <UserCheck className="h-5 w-5" />, accent: "#22C55E" },
    { label: "Leave Balance", value: data.leaveBalance, helper: "days remaining", icon: <Calendar className="h-5 w-5" />, accent: "#F59E0B" },
    { label: "My Tasks", value: data.myTasks, helper: "open work items", icon: <Inbox className="h-5 w-5" />, accent: "#1B6AB5" },
    { label: "My Points", value: data.points.toLocaleString(), helper: "engagement score", icon: <Star className="h-5 w-5" />, accent: "#8B5CF6" },
    { label: "Current Tier", value: data.tierName, helper: "loyalty level", icon: <Trophy className="h-5 w-5" />, accent: "#D97706" },
    { label: "Badges Earned", value: data.badges, helper: "achievements", icon: <Award className="h-5 w-5" />, accent: "#EC4899" },
  ];
  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
      {tiles.map((t) => (
        <KpiTile key={t.label} {...t} />
      ))}
    </section>
  );
}

// ── Admin KPI row ─────────────────────────────────────────────────────────────

function AdminKpiRow({
  summary,
  wfData,
  atsTotal,
}: {
  summary: DashboardSummary | undefined;
  wfData: WorkforceDashboard | undefined;
  atsTotal: number;
}) {
  const hc = summary?.metrics.hc;
  const att = summary?.metrics.att;
  const payroll = summary?.metrics.payroll;
  const resign = summary?.metrics.resign;
  const pending = summary?.workItems.pending_count ?? 0;

  const tiles: KpiTileProps[] = [
    {
      label: "Active Headcount",
      value: hc?.value ?? wfData?.summary.active_headcount ?? 0,
      helper: "total active employees",
      icon: <Users className="h-5 w-5" />,
      metric: hc ?? null,
      accent: "#1B6AB5",
    },
    {
      label: "Attendance Today",
      value: att?.value !== null && att?.value !== undefined ? `${att.value}%` : (wfData?.summary.attendance_pct ? `${wfData.summary.attendance_pct.toFixed(1)}%` : "—"),
      helper: "present vs expected",
      icon: <UserCheck className="h-5 w-5" />,
      metric: att ?? null,
      accent: "#22C55E",
    },
    {
      label: "Pending Actions",
      value: pending,
      helper: `${summary?.workItems.overdue_count ?? 0} overdue`,
      icon: <Inbox className="h-5 w-5" />,
      metric: pending > 10 ? { value: pending, previousValue: null, target: 5, variancePct: null, status: "warn", trend: null } : null,
      accent: "#F59E0B",
    },
    {
      label: "Payroll Readiness",
      value: payroll?.value !== null && payroll?.value !== undefined ? `${payroll.value}%` : "—",
      helper: "data completeness",
      icon: <CreditCard className="h-5 w-5" />,
      metric: payroll ?? null,
      accent: "#8B5CF6",
    },
    {
      label: "Attrition 30d",
      value: wfData?.summary.attrition_rate_30d !== undefined ? `${wfData.summary.attrition_rate_30d.toFixed(1)}%` : (resign?.value !== null && resign?.value !== undefined ? resign.value : "—"),
      helper: `${wfData?.summary.exits_30d ?? 0} exits this month`,
      icon: <UserMinus className="h-5 w-5" />,
      metric: resign ?? null,
      accent: "#EF4444",
    },
    {
      label: "Open Positions",
      value: atsTotal,
      helper: "ATS pipeline candidates",
      icon: <Zap className="h-5 w-5" />,
      accent: "#22D3EE",
    },
  ];

  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
      {tiles.map((t) => (
        <KpiTile key={t.label} {...t} />
      ))}
    </section>
  );
}

// ── Engagement strip (reused, repositioned to bottom) ─────────────────────────

function useLoginStreak() {
  const [streak, setStreak] = useState(() => {
    const today = new Date().toISOString().slice(0, 10);
    const raw = localStorage.getItem("hrms_streak");
    let data = raw ? JSON.parse(raw) : { lastDate: "", count: 0 };
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    if (data.lastDate === today) return data.count as number;
    if (data.lastDate === yesterday) {
      data = { lastDate: today, count: data.count + 1 };
      localStorage.setItem("hrms_streak", JSON.stringify(data));
      return data.count as number;
    }
    data = { lastDate: today, count: 1 };
    localStorage.setItem("hrms_streak", JSON.stringify(data));
    return 1;
  });
  return streak;
}

function EngagementStrip() {
  const streak = useLoginStreak();

  const { data: engData } = useQuery({
    queryKey: ["dashboard-engagement-summary"],
    queryFn: () => hrmsApi.get<ApiResponse<EngagementSummary>>("/api/engagement/me"),
    staleTime: 60_000 * 5,
  });

  const { data: lbData } = useQuery({
    queryKey: ["dashboard-leaderboard"],
    queryFn: () =>
      hrmsApi.get<ApiResponse<LeaderboardEntry[]>>(
        "/api/engagement/leaderboard?period=month&limit=3"
      ),
    staleTime: 60_000 * 5,
  });

  const summary = engData?.data;
  const leaders = lbData?.data ?? [];

  const streakGrad =
    streak >= 30
      ? "from-amber-500 to-orange-600"
      : streak >= 7
      ? "from-orange-400 to-red-500"
      : streak >= 3
      ? "from-yellow-400 to-orange-400"
      : "from-slate-600 to-slate-700";

  const streakLabel =
    streak >= 30
      ? "Monthly Legend"
      : streak >= 7
      ? "Week Warrior"
      : streak >= 3
      ? "On a Roll"
      : "Just Started";

  return (
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {/* Streak */}
      <Card className={`overflow-hidden rounded-2xl bg-gradient-to-br ${streakGrad} text-white shadow-lg border-0`}>
        <CardContent className="p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-white/70">Login Streak</p>
              <p className="mt-1 text-4xl font-black" style={{ fontFamily: "'Fira Code', monospace" }}>{streak}</p>
              <p className="text-sm font-semibold text-white/80">days</p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/20">
              <Flame className="h-6 w-6" />
            </div>
          </div>
          <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-xs font-bold">
            {streakLabel}
          </div>
        </CardContent>
      </Card>

      {/* Points & tier */}
      <Card className="overflow-hidden rounded-2xl border-0 bg-gradient-to-br from-violet-700 to-indigo-800 text-white shadow-lg">
        <CardContent className="p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-white/70">My Points</p>
              <p className="mt-1 text-4xl font-black" style={{ fontFamily: "'Fira Code', monospace" }}>
                {(summary?.total_points ?? 0).toLocaleString()}
              </p>
              <p className="text-sm font-semibold text-white/80">{summary?.current_tier?.tier_name ?? "Starter"}</p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/20">
              <Star className="h-6 w-6" />
            </div>
          </div>
          {summary != null && (
            <div className="mt-3">
              <Progress value={summary.progress_percentage} className="h-1.5 bg-white/20 [&>div]:bg-white" />
              <p className="mt-1 text-[11px] text-white/60">
                {summary.points_to_next_tier != null ? `${summary.points_to_next_tier} pts to next tier` : "Top tier!"}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick engage */}
      <Card className="overflow-hidden rounded-2xl bg-slate-900 border border-slate-800">
        <CardContent className="p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Quick Engage</p>
          <div className="mt-3 flex flex-col gap-2">
            <Link to="/engagement/kudos" className="flex items-center gap-3 rounded-xl border border-pink-900/40 bg-pink-950/40 px-3 py-2.5 text-sm font-semibold text-pink-300 transition hover:bg-pink-900/50">
              <Heart className="h-4 w-4" /> Give Kudos
            </Link>
            <Link to="/engagement/badges" className="flex items-center gap-3 rounded-xl border border-amber-900/40 bg-amber-950/40 px-3 py-2.5 text-sm font-semibold text-amber-300 transition hover:bg-amber-900/50">
              <Award className="h-4 w-4" /> My Badges ({summary?.badges_earned.length ?? 0})
            </Link>
            <Link to="/career-planning" className="flex items-center gap-3 rounded-xl border border-blue-900/40 bg-blue-950/40 px-3 py-2.5 text-sm font-semibold text-blue-300 transition hover:bg-blue-900/50">
              <TrendingUp className="h-4 w-4" /> Career Path
            </Link>
          </div>
        </CardContent>
      </Card>

      {/* Mini leaderboard */}
      <Card className="overflow-hidden rounded-2xl bg-slate-900 border border-slate-800">
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Top This Month</p>
            <Link to="/engagement/leaderboard" className="text-[11px] font-bold text-[#1B6AB5] hover:underline">Full board →</Link>
          </div>
          <div className="space-y-2">
            {leaders.length === 0 && <p className="text-xs text-slate-500">Loading…</p>}
            {leaders.map((entry, i) => (
              <div key={entry.employee_id} className="flex items-center gap-3">
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-black ${i === 0 ? "bg-amber-900/50 text-amber-400" : i === 1 ? "bg-slate-800 text-slate-400" : "bg-orange-950/50 text-orange-400"}`}>
                  {i === 0 ? "1" : i === 1 ? "2" : "3"}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-200">{entry.employee_name}</span>
                <span className="text-xs font-black text-violet-400">{entry.total_points.toLocaleString()}</span>
              </div>
            ))}
          </div>
          <Link to="/engagement" className="mt-4 flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-700 to-indigo-700 px-3 py-2 text-xs font-bold text-white transition hover:opacity-90">
            <Trophy className="h-3.5 w-3.5" /> Open Engagement Hub
          </Link>
        </CardContent>
      </Card>
    </section>
  );
}

// ── Action card ───────────────────────────────────────────────────────────────

function ActionCard({ icon, title, desc, href, overdue = false }: { icon: React.ReactNode; title: string; desc: string; href: string; overdue?: boolean }) {
  return (
    <Link to={href} className="group flex items-center gap-4 rounded-xl border border-slate-800 bg-slate-950/60 p-4 transition hover:-translate-y-0.5 hover:border-slate-700 hover:bg-slate-800/60">
      <div className={`flex h-10 w-10 items-center justify-center rounded-xl border ${overdue ? "border-red-800/60 bg-red-950/60 text-red-400" : "border-slate-700 bg-slate-800 text-slate-400"}`}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-slate-200">{title}</p>
        <p className="mt-0.5 truncate text-xs font-medium text-slate-500">{desc}</p>
      </div>
      <ArrowUpRight className="h-4 w-4 text-slate-600 transition group-hover:text-[#1B6AB5]" />
    </Link>
  );
}

// ── Quick Nav tile ────────────────────────────────────────────────────────────

function QuickNavTile({ icon, title, desc, href, accent }: { icon: React.ReactNode; title: string; desc: string; href: string; accent: string }) {
  return (
    <Link to={href} className="group rounded-2xl border border-slate-800 bg-slate-900 p-4 transition hover:-translate-y-1 hover:border-slate-700 hover:shadow-lg hover:shadow-slate-950/50">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl text-white shadow-lg" style={{ backgroundColor: accent }}>
        {icon}
      </div>
      <p className="mt-4 text-sm font-black text-slate-100">{title}</p>
      <p className="mt-1 text-xs font-medium leading-5 text-slate-500">{desc}</p>
      <div className="mt-3 flex items-center text-xs font-bold text-[#1B6AB5]">
        Open <ArrowUpRight className="ml-1 h-3.5 w-3.5 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
      </div>
    </Link>
  );
}

// ── Role resolver ─────────────────────────────────────────────────────────────
import { CeoLayout }      from "@/components/dashboard/layouts/CeoLayout";
import { HrAdminLayout }  from "@/components/dashboard/layouts/HrAdminLayout";
import { RecruiterLayout } from "@/components/dashboard/layouts/RecruiterLayout";
import { OpsLayout }      from "@/components/dashboard/layouts/OpsLayout";
import { FinanceLayout }  from "@/components/dashboard/layouts/FinanceLayout";
import { EmployeeLayout } from "@/components/dashboard/layouts/EmployeeLayout";
import { ManagerLayout }  from "@/components/dashboard/layouts/ManagerLayout";

type RoleLayout = "ceo" | "hr" | "recruiter" | "ops" | "finance" | "manager" | "employee";

function resolveLayout(role?: string): RoleLayout {
  if (!role) return "employee";
  const r = role.toLowerCase().replace(/_/g, "");
  if (r === "ceo" || r === "superadmin") return "ceo";
  if (r === "hr" || r === "admin" || r === "hradmin") return "hr";
  if (r === "recruiter" || r === "recruitment") return "recruiter";
  if (r === "processmanager" || r === "branchhead" || r === "operationsmanager" || r === "ops") return "ops";
  if (r === "finance" || r === "payroll") return "finance";
  if (r === "manager" || r === "teamleader" || r === "tl") return "manager";
  return "employee";
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function Index() {
  const { user } = useAuth();
  const { data: roleData } = useUserRole();
  const layout = resolveLayout(roleData?.primaryRole || undefined);

  let content: React.ReactNode;
  switch (layout) {
    case "ceo":       content = <CeoLayout />; break;
    case "hr":        content = <HrAdminLayout />; break;
    case "recruiter": content = <RecruiterLayout />; break;
    case "ops":       content = <OpsLayout />; break;
    case "finance":   content = <FinanceLayout />; break;
    case "manager":   content = <ManagerLayout />; break;
    default:          content = <EmployeeLayout />;
  }
  return <DashboardLayout>{content}</DashboardLayout>;
}

// ── Legacy (unused, kept for reference) ──────────────────────────────────────
function _LegacyIndex() {
  const { user } = useAuth();
  const { isAdminOrHR } = useIsAdminOrHR();
  const greeting = getHourGreeting();
  const userName = user?.email?.split("@")[0] ?? "there";

  // ── Data fetching ──────────────────────────────────────────────────────────
  const { data: summaryData } = useQuery<{ data: DashboardSummary }>({
    queryKey: ["dashboard-summary-v2"],
    queryFn: () => hrmsApi.get("/api/dashboards/hr/summary"),
    staleTime: 1000 * 60 * 2,
  });

  const { data: wfRaw } = useQuery<{ data: WorkforceDashboard }>({
    queryKey: ["dashboard-workforce-v2"],
    queryFn: () => hrmsApi.get("/api/management/workforce-dashboard"),
    staleTime: 1000 * 60 * 5,
    enabled: isAdminOrHR,
  });

  const { data: ceoRaw } = useQuery<{ data: CeoMetrics }>({
    queryKey: ["dashboard-ceo-v2"],
    queryFn: () => hrmsApi.get("/api/management/ceo-metrics"),
    staleTime: 1000 * 60 * 5,
    enabled: isAdminOrHR,
  });

  const { data: atsRaw } = useQuery<any>({
    queryKey: ["dashboard-ats-v2"],
    queryFn: () => hrmsApi.get("/api/ats/stats"),
    staleTime: 1000 * 60 * 5,
  });

  const { data: engData } = useQuery({
    queryKey: ["dashboard-engagement-summary"],
    queryFn: () => hrmsApi.get<ApiResponse<EngagementSummary>>("/api/engagement/me"),
    staleTime: 60_000 * 5,
  });

  const summary = summaryData?.data;
  const wfData = wfRaw?.data;
  const ceo = ceoRaw?.data;
  const atsTotal = atsRaw?.data?.total ?? atsRaw?.data?.open_candidates ?? 0;
  const engSummary = engData?.data;

  // ── Derived ────────────────────────────────────────────────────────────────
  const movementData = useMemo(() => wfData?.movement?.slice(-8) ?? [], [wfData]);

  const attendanceDonut = useMemo(
    () =>
      (wfData?.attendance?.statuses ?? [])
        .filter((s) => s.value > 0)
        .map((s) => ({ name: s.label, value: s.value, fill: ATTENDANCE_COLORS[s.label] ?? "#64748B" })),
    [wfData]
  );

  const pipelineData = useMemo(
    () =>
      (wfData?.pipeline ?? []).map((p, i) => ({
        stage: p.stage,
        value: p.value,
        fill: PIPELINE_COLORS[i % PIPELINE_COLORS.length],
      })),
    [wfData]
  );

  const overdue = summary?.workItems.overdue_count ?? 0;
  const pending = summary?.workItems.pending_count ?? 0;

  // Employee fallback data
  const employeeKpiData: EmployeeKpiData = {
    myAttendancePct: Math.round((wfData?.summary.attendance_pct ?? 0) * 10) / 10,
    leaveBalance: 0,
    myTasks: pending,
    points: engSummary?.total_points ?? 0,
    tierName: engSummary?.current_tier?.tier_name ?? "Starter",
    badges: engSummary?.badges_earned?.length ?? 0,
  };

  return (
    <DashboardLayout>
      <div className="space-y-5 pb-8">

        {/* ── ZONE 1 — Command Banner ──────────────────────────────────────── */}
        <section className="relative overflow-hidden rounded-[28px] border border-slate-800 bg-gradient-to-br from-slate-950 via-[#0d1829] to-[#0a1020] p-6 text-white shadow-2xl">
          {/* Ambient glows */}
          <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-[#1B6AB5]/20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-16 left-1/4 h-64 w-64 rounded-full bg-[#22C55E]/10 blur-3xl" />
          <div className="pointer-events-none absolute bottom-0 right-1/3 h-48 w-48 rounded-full bg-[#8B5CF6]/10 blur-3xl" />

          <div className="relative grid gap-6 xl:grid-cols-[1.5fr_0.5fr]">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <Badge className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-white hover:bg-white/10">
                  <Sparkles className="mr-1.5 h-3.5 w-3.5 text-[#5aa0dd]" />
                  MCN PeopleOS
                </Badge>
                {overdue > 0 && (
                  <Badge className="rounded-full border border-red-800/60 bg-red-950/60 px-3 py-1 text-red-300 hover:bg-red-950/60">
                    <AlertTriangle className="mr-1.5 h-3 w-3" />
                    {overdue} overdue
                  </Badge>
                )}
              </div>

              <h1 className="mt-4 text-3xl font-black tracking-tight md:text-4xl">
                {greeting},{" "}
                <span className="bg-gradient-to-r from-[#5aa0dd] to-[#22C55E] bg-clip-text text-transparent">
                  {userName}
                </span>
                .
              </h1>
              <p className="mt-2 max-w-xl text-sm font-medium leading-6 text-slate-400">
                Your workforce command center — headcount, attendance, payroll, ATS and live operations in one view.
              </p>

              <div className="mt-5 flex flex-wrap gap-3">
                {isAdminOrHR ? (
                  <>
                    <Button asChild className="rounded-xl bg-[#1B6AB5] px-5 font-bold text-white shadow-lg shadow-[#1B6AB5]/30 hover:bg-[#155e9f]">
                      <Link to="/employees"><UserPlus className="mr-2 h-4 w-4" />Add Employee</Link>
                    </Button>
                    <Button asChild variant="outline" className="rounded-xl border-white/15 bg-white/8 px-5 font-bold text-white hover:bg-white/15 hover:text-white">
                      <Link to="/reports"><BarChart3 className="mr-2 h-4 w-4" />Reports</Link>
                    </Button>
                    <Button asChild variant="outline" className="rounded-xl border-white/15 bg-white/8 px-5 font-bold text-white hover:bg-white/15 hover:text-white">
                      <Link to="/payroll"><CreditCard className="mr-2 h-4 w-4" />Payroll</Link>
                    </Button>
                  </>
                ) : (
                  <>
                    <Button asChild className="rounded-xl bg-[#1B6AB5] px-5 font-bold text-white shadow-lg shadow-[#1B6AB5]/30 hover:bg-[#155e9f]">
                      <Link to="/leaves"><Calendar className="mr-2 h-4 w-4" />Apply Leave</Link>
                    </Button>
                    <Button asChild variant="outline" className="rounded-xl border-white/15 bg-white/8 px-5 font-bold text-white hover:bg-white/15 hover:text-white">
                      <Link to="/attendance"><Clock className="mr-2 h-4 w-4" />Attendance</Link>
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* Micro stats panel */}
            <div className="rounded-2xl border border-white/8 bg-white/5 p-5 backdrop-blur">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Live Snapshot</p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                {[
                  { v: wfData?.summary.active_headcount ?? summary?.metrics.hc?.value ?? "—", l: "Headcount" },
                  { v: pending, l: "Pending Tasks" },
                  { v: wfData?.summary.new_joiners_30d ?? "—", l: "New Joiners" },
                  { v: wfData?.summary.exits_30d ?? "—", l: "Exits 30d" },
                  { v: atsTotal, l: "ATS Pipeline" },
                  { v: wfData?.training?.analysts_in_training ?? "—", l: "In Training" },
                ].map((item) => (
                  <div key={item.l} className="rounded-xl bg-slate-950/60 p-3 border border-slate-800/60">
                    <p className="text-xl font-black text-slate-50" style={{ fontFamily: "'Fira Code', monospace" }}>{item.v}</p>
                    <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{item.l}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── ZONE 2 — Role-Adaptive KPI Tiles ────────────────────────────── */}
        {isAdminOrHR ? (
          <AdminKpiRow summary={summary} wfData={wfData} atsTotal={atsTotal} />
        ) : (
          <EmployeeKpiRow data={employeeKpiData} />
        )}

        {/* ── ZONE 3 — Bento Main Grid ─────────────────────────────────────── */}
        {isAdminOrHR && (
          <section className="grid gap-4 xl:grid-cols-3">
            {/* Z3a — Movement chart (col-span-2) */}
            <Card className="xl:col-span-2 overflow-hidden rounded-2xl bg-slate-900 border border-slate-800">
              <CardHeader className="flex flex-row items-start justify-between gap-4 border-b border-slate-800 pb-4">
                <div>
                  <CardTitle className="text-base font-bold text-slate-100">Workforce Movement</CardTitle>
                  <p className="mt-0.5 text-xs text-slate-500">Headcount, joins & exits — last 8 periods</p>
                </div>
                <Badge className="rounded-full bg-emerald-950/60 border border-emerald-800/60 text-emerald-400 hover:bg-emerald-950/60 text-[11px]">Live</Badge>
              </CardHeader>
              <CardContent className="p-4">
                {movementData.length === 0 ? (
                  <div className="flex h-48 items-center justify-center text-sm text-slate-600">No movement data available</div>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={movementData} barGap={2}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                      <XAxis dataKey="period" tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "#0f172a", border: "1px solid #1e293b", borderRadius: "12px", color: "#f1f5f9" }}
                        cursor={{ fill: "rgba(255,255,255,0.04)" }}
                      />
                      <Legend wrapperStyle={{ color: "#64748b", fontSize: 11, paddingTop: 8 }} />
                      <Bar dataKey="joins" name="Joins" fill="#22C55E" radius={[4, 4, 0, 0]} maxBarSize={28} />
                      <Bar dataKey="exits" name="Exits" fill="#EF4444" radius={[4, 4, 0, 0]} maxBarSize={28} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* Z3b — Attendance donut */}
            <Card className="overflow-hidden rounded-2xl bg-slate-900 border border-slate-800">
              <CardHeader className="border-b border-slate-800 pb-4">
                <CardTitle className="text-base font-bold text-slate-100">Attendance Today</CardTitle>
                <p className="text-xs text-slate-500">Status distribution</p>
              </CardHeader>
              <CardContent className="p-4">
                {attendanceDonut.length === 0 ? (
                  <div className="flex h-48 items-center justify-center text-sm text-slate-600">No attendance data</div>
                ) : (
                  <>
                    <ResponsiveContainer width="100%" height={170}>
                      <PieChart>
                        <Pie data={attendanceDonut} cx="50%" cy="50%" innerRadius={50} outerRadius={78} paddingAngle={3} dataKey="value">
                          {attendanceDonut.map((entry, i) => (
                            <Cell key={i} fill={entry.fill} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{ backgroundColor: "#0f172a", border: "1px solid #1e293b", borderRadius: "10px", color: "#f1f5f9", fontSize: 12 }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="mt-2 grid grid-cols-2 gap-1.5">
                      {attendanceDonut.map((d) => (
                        <div key={d.name} className="flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: d.fill }} />
                          <span className="text-[10px] text-slate-400 truncate capitalize">{d.name.replace(/_/g, " ")}</span>
                          <span className="ml-auto text-[10px] font-bold text-slate-300">{d.value}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Z3c — ATS Pipeline */}
            <Card className="xl:col-span-2 overflow-hidden rounded-2xl bg-slate-900 border border-slate-800">
              <CardHeader className="flex flex-row items-start justify-between border-b border-slate-800 pb-4">
                <div>
                  <CardTitle className="text-base font-bold text-slate-100">ATS Hiring Pipeline</CardTitle>
                  <p className="mt-0.5 text-xs text-slate-500">Candidates by stage</p>
                </div>
                <Link to="/ats" className="text-[11px] font-bold text-[#1B6AB5] hover:underline">View ATS →</Link>
              </CardHeader>
              <CardContent className="p-4">
                {pipelineData.length === 0 ? (
                  <div className="flex h-36 items-center justify-center text-sm text-slate-600">No pipeline data</div>
                ) : (
                  <ResponsiveContainer width="100%" height={160}>
                    <BarChart data={pipelineData} layout="vertical" barSize={14}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                      <XAxis type="number" tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis type="category" dataKey="stage" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} width={110} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "#0f172a", border: "1px solid #1e293b", borderRadius: "10px", color: "#f1f5f9", fontSize: 12 }}
                        cursor={{ fill: "rgba(255,255,255,0.04)" }}
                      />
                      <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                        {pipelineData.map((entry, i) => (
                          <Cell key={i} fill={entry.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* Z3d — Action Required */}
            <Card className="overflow-hidden rounded-2xl bg-slate-900 border border-slate-800">
              <CardHeader className="border-b border-slate-800 pb-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base font-bold text-slate-100">Action Required</CardTitle>
                    <p className="mt-0.5 text-xs text-slate-500">Items needing attention</p>
                  </div>
                  {(pending + overdue) > 0 && (
                    <Badge className={`rounded-full text-[11px] ${overdue > 0 ? "bg-red-950/60 border border-red-800/60 text-red-400" : "bg-amber-950/60 border border-amber-800/60 text-amber-400"} hover:bg-inherit`}>
                      {pending} open
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-2 p-4">
                <ActionCard icon={<CalendarCheck className="h-4 w-4" />} title="Leave Approvals" desc={`${summary?.metrics.hc?.value ?? 0} pending requests`} href="/leaves" overdue={overdue > 0} />
                <ActionCard icon={<UserPlus className="h-4 w-4" />} title="Onboarding" desc="Review new joiners pending setup" href="/onboarding" />
                <ActionCard icon={<ShieldCheck className="h-4 w-4" />} title="BGV Pending" desc={`${summary?.metrics.bgv?.value ?? 0} background verifications`} href="/employees" overdue={(summary?.metrics.bgv?.value ?? 0) > 5} />
                <ActionCard icon={<FileText className="h-4 w-4" />} title="Document Review" desc="Profile completeness checks" href="/employees" />
              </CardContent>
            </Card>
          </section>
        )}

        {/* ── ZONE 4 — Analytics Row ───────────────────────────────────────── */}
        {isAdminOrHR && (
          <section className="grid gap-4 xl:grid-cols-3">
            {/* Z4a — Payroll */}
            <Card className="overflow-hidden rounded-2xl bg-slate-900 border border-slate-800">
              <CardHeader className="border-b border-slate-800 pb-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#8B5CF6]/20 text-[#8B5CF6]">
                    <IndianRupee className="h-4 w-4" />
                  </div>
                  <div>
                    <CardTitle className="text-sm font-bold text-slate-100">Payroll Liability</CardTitle>
                    <p className="text-[10px] text-slate-500">{ceo?.payroll_liability?.run_month ?? "Latest run"}</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-4 space-y-3">
                {[
                  { label: "Net Pay", value: ceo?.payroll_liability?.total_net ?? 0, color: "text-emerald-400" },
                  { label: "Gross Pay", value: ceo?.payroll_liability?.total_gross ?? 0, color: "text-slate-200" },
                  { label: "Employer Statutory", value: ceo?.payroll_liability?.employer_statutory ?? 0, color: "text-amber-400" },
                ].map((row) => (
                  <div key={row.label} className="flex items-center justify-between">
                    <span className="text-xs text-slate-500">{row.label}</span>
                    <span className={`text-sm font-black tabular-nums ${row.color}`} style={{ fontFamily: "'Fira Code', monospace" }}>
                      {formatINR(row.value)}
                    </span>
                  </div>
                ))}
                <div className="pt-1 border-t border-slate-800">
                  <p className="text-[10px] text-slate-600">{ceo?.payroll_liability?.employee_count ?? 0} employees in this run</p>
                </div>
                <Link to="/payroll" className="flex items-center justify-center gap-2 rounded-xl bg-[#8B5CF6]/15 border border-[#8B5CF6]/25 px-3 py-2 text-xs font-bold text-[#a78bfa] hover:bg-[#8B5CF6]/25 transition">
                  Open Payroll <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              </CardContent>
            </Card>

            {/* Z4b — Training */}
            <Card className="overflow-hidden rounded-2xl bg-slate-900 border border-slate-800">
              <CardHeader className="border-b border-slate-800 pb-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#22D3EE]/20 text-[#22D3EE]">
                    <GraduationCap className="h-4 w-4" />
                  </div>
                  <div>
                    <CardTitle className="text-sm font-bold text-slate-100">Training & Onboarding</CardTitle>
                    <p className="text-[10px] text-slate-500">Current batch status</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-4 space-y-3">
                {[
                  { label: "Analysts in Training", value: wfData?.training?.analysts_in_training ?? 0 },
                  { label: "Onboarding in Progress", value: wfData?.training?.onboarding_in_progress ?? 0 },
                  { label: "LMS Active Learners", value: wfData?.training?.lms_in_progress ?? 0 },
                  { label: "BGV Pending", value: summary?.metrics.bgv?.value ?? 0 },
                ].map((row) => (
                  <div key={row.label} className="flex items-center justify-between">
                    <span className="text-xs text-slate-500">{row.label}</span>
                    <span className="text-sm font-black text-slate-200 tabular-nums" style={{ fontFamily: "'Fira Code', monospace" }}>
                      {row.value}
                    </span>
                  </div>
                ))}
                <Link to="/lms" className="flex items-center justify-center gap-2 rounded-xl bg-[#22D3EE]/10 border border-[#22D3EE]/20 px-3 py-2 text-xs font-bold text-[#67e8f9] hover:bg-[#22D3EE]/20 transition">
                  LMS Dashboard <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              </CardContent>
            </Card>

            {/* Z4c — Revenue at Risk */}
            <Card className="overflow-hidden rounded-2xl bg-slate-900 border border-slate-800">
              <CardHeader className="border-b border-slate-800 pb-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#EF4444]/20 text-[#EF4444]">
                    <TrendingDown className="h-4 w-4" />
                  </div>
                  <div>
                    <CardTitle className="text-sm font-bold text-slate-100">Revenue at Risk</CardTitle>
                    <p className="text-[10px] text-slate-500">
                      Daily est: {formatINR(ceo?.revenue_at_risk?.total_daily_estimate ?? 0)}
                    </p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-4 space-y-3">
                {(ceo?.revenue_at_risk?.by_process ?? []).slice(0, 4).map((proc) => (
                  <div key={proc.process_name}>
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-xs text-slate-400 truncate max-w-[55%]">{proc.process_name}</span>
                      <span className="text-xs font-bold text-red-400">{proc.shrinkage_pct.toFixed(1)}% shrink</span>
                    </div>
                    <Progress value={Math.min(proc.shrinkage_pct, 100)} className="h-1.5 bg-slate-800 [&>div]:bg-red-500" />
                  </div>
                ))}
                {(ceo?.revenue_at_risk?.by_process?.length ?? 0) === 0 && (
                  <p className="text-xs text-slate-600 text-center py-4">No risk data available</p>
                )}
                <Link to="/reports" className="flex items-center justify-center gap-2 rounded-xl bg-[#EF4444]/10 border border-[#EF4444]/20 px-3 py-2 text-xs font-bold text-[#fca5a5] hover:bg-[#EF4444]/20 transition">
                  View Reports <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              </CardContent>
            </Card>
          </section>
        )}

        {/* ── ZONE 5 — Quick Navigation ────────────────────────────────────── */}
        <section className="grid gap-4 xl:grid-cols-[1fr_auto]">
          <Card className="overflow-hidden rounded-2xl bg-slate-900 border border-slate-800">
            <CardHeader className="border-b border-slate-800 pb-4">
              <CardTitle className="text-base font-bold text-slate-100">HR Operations</CardTitle>
              <p className="text-xs text-slate-500">High-frequency workflows</p>
            </CardHeader>
            <CardContent className="grid gap-3 p-4 sm:grid-cols-2 md:grid-cols-4">
              <QuickNavTile icon={<Users className="h-5 w-5" />} title="Employees" desc="Profiles, departments, roles" href="/employees" accent="#1B6AB5" />
              <QuickNavTile icon={<Clock className="h-5 w-5" />} title="Attendance" desc="Daily presence & exceptions" href="/attendance" accent="#22C55E" />
              <QuickNavTile icon={<Calendar className="h-5 w-5" />} title="Leave" desc="Apply, approve, balance" href="/leaves" accent="#F59E0B" />
              <QuickNavTile icon={<CreditCard className="h-5 w-5" />} title="Payroll" desc="Salary, payslips, statutory" href="/payroll" accent="#8B5CF6" />
            </CardContent>
          </Card>

          {/* Health signal */}
          <Card className="overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 to-[#0d1829] border border-slate-800 min-w-[200px]">
            <CardContent className="flex flex-col items-center justify-center gap-4 p-6 h-full">
              <div className={`flex h-14 w-14 items-center justify-center rounded-2xl ${overdue > 0 ? "bg-red-950/60 text-red-400" : "bg-emerald-950/60 text-emerald-400"}`}>
                {overdue > 0 ? <AlertTriangle className="h-7 w-7" /> : <CheckCircle2 className="h-7 w-7" />}
              </div>
              <div className="text-center">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-500">HR Health</p>
                <p className={`mt-1 text-xl font-black ${overdue > 0 ? "text-red-400" : "text-emerald-400"}`}>
                  {overdue > 0 ? "Needs Attention" : "Healthy"}
                </p>
                <p className="mt-1 text-[11px] text-slate-600">{pending} open · {overdue} overdue</p>
              </div>
              <Button asChild size="sm" className="w-full rounded-xl bg-slate-800 text-slate-200 hover:bg-[#1B6AB5] hover:text-white text-xs font-bold">
                <Link to="/reports">View Reports <ArrowUpRight className="ml-1.5 h-3 w-3" /></Link>
              </Button>
            </CardContent>
          </Card>
        </section>

        {/* ── ZONE 6 — Engagement (bottom, low hierarchy) ──────────────────── */}
        <EngagementStrip />

      </div>
    </DashboardLayout>
  );
}
