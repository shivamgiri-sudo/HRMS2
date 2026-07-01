import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowUpRight,
  Award,
  BadgeCheck,
  BarChart3,
  Calendar,
  CalendarCheck,
  Clock,
  CreditCard,
  FileText,
  Flame,
  Heart,
  ShieldCheck,
  Sparkles,
  Star,
  TrendingUp,
  Trophy,
  UserCheck,
  UserPlus,
  Users,
} from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { hrmsApi } from "@/lib/hrmsApi";
import { useAuth } from "@/contexts/AuthContext";
import { useIsAdminOrHR } from "@/hooks/useUserRole";
import type { EngagementSummary, LeaderboardEntry, ApiResponse } from "@/components/engagement/types";

type MetricCardProps = {
  label: string;
  value: string | number;
  helper: string;
  icon: React.ReactNode;
  tone: "rose" | "emerald" | "blue" | "amber" | "violet" | "slate";
};

// SmartHR-inspired tone mapping with primary blue (#4361ee)
const toneMap = {
  rose: {
    card: "from-red-50 to-white border-red-100",
    icon: "bg-[#ef4444] text-white shadow-red-500/20",
    text: "text-[#ef4444]",
    bgLight: "bg-red-50",
  },
  emerald: {
    card: "from-green-50 to-white border-green-100",
    icon: "bg-[#10b981] text-white shadow-green-500/20",
    text: "text-[#10b981]",
    bgLight: "bg-green-50",
  },
  blue: {
    card: "from-blue-50 to-white border-blue-100",
    icon: "bg-[#1B6AB5] text-white shadow-blue-500/20",
    text: "text-[#1B6AB5]",
    bgLight: "bg-blue-50",
  },
  amber: {
    card: "from-orange-50 to-white border-orange-100",
    icon: "bg-[#f59e0b] text-white shadow-orange-500/20",
    text: "text-[#f59e0b]",
    bgLight: "bg-orange-50",
  },
  violet: {
    card: "from-purple-50 to-white border-purple-100",
    icon: "bg-[#8b5cf6] text-white shadow-purple-500/20",
    text: "text-[#8b5cf6]",
    bgLight: "bg-purple-50",
  },
  slate: {
    card: "from-slate-50 to-white border-slate-100",
    icon: "bg-slate-900 text-white shadow-slate-900/20",
    text: "text-slate-700",
    bgLight: "bg-slate-50",
  },
};

function MetricCard({ label, value, helper, icon, tone }: MetricCardProps) {
  const style = toneMap[tone];

  return (
    <Card className={`smarthr-stat-card overflow-hidden border bg-gradient-to-br ${style.card} transition-all duration-200 hover:shadow-lg hover:-translate-y-1 cursor-pointer`}>
      <CardContent className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <p className="smarthr-stat-label text-slate-500">
              {label}
            </p>
            <div className="mt-3 flex items-end gap-2">
              <p className="smarthr-stat-value" style={{ fontFamily: "'Fira Code', monospace" }}>
                {value}
              </p>
              <TrendingUp className={`mb-1.5 h-4 w-4 ${style.text}`} />
            </div>
            <p className="mt-2 text-xs font-medium text-slate-600">{helper}</p>
          </div>

          <div className={`flex h-14 w-14 items-center justify-center rounded-xl shadow-md ${style.icon}`}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function MiniBar({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="font-bold text-slate-600">{label}</span>
        <span className="font-black text-slate-950">{value}%</span>
      </div>
      <Progress value={value} className={`h-2 ${tone}`} />
    </div>
  );
}

// ── Login streak (localStorage) ──────────────────────────────────────────────
function useLoginStreak() {
  const [streak, setStreak] = useState(0);
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    const raw = localStorage.getItem("hrms_streak");
    let data = raw ? JSON.parse(raw) : { lastDate: "", count: 0 };
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    if (data.lastDate === today) {
      setStreak(data.count);
    } else if (data.lastDate === yesterday) {
      data = { lastDate: today, count: data.count + 1 };
      localStorage.setItem("hrms_streak", JSON.stringify(data));
      setStreak(data.count);
    } else {
      data = { lastDate: today, count: 1 };
      localStorage.setItem("hrms_streak", JSON.stringify(data));
      setStreak(1);
    }
  }, []);
  return streak;
}

// ── Engagement strip ──────────────────────────────────────────────────────────
function EngagementStrip() {
  const streak = useLoginStreak();

  const { data: engData } = useQuery({
    queryKey: ["dashboard-engagement-summary"],
    queryFn: () => hrmsApi.get<ApiResponse<EngagementSummary>>("/api/engagement/me"),
    staleTime: 60_000 * 5,
  });

  const { data: lbData } = useQuery({
    queryKey: ["dashboard-leaderboard"],
    queryFn: () => hrmsApi.get<ApiResponse<LeaderboardEntry[]>>("/api/engagement/leaderboard?period=month&limit=3"),
    staleTime: 60_000 * 5,
  });

  const summary = engData?.data;
  const leaders = lbData?.data ?? [];

  const streakLabel = streak >= 30 ? "Monthly Legend" : streak >= 7 ? "Week Warrior" : streak >= 3 ? "On a Roll" : "Just Started";
  const streakColor = streak >= 30 ? "from-amber-500 to-orange-600" : streak >= 7 ? "from-orange-400 to-red-500" : streak >= 3 ? "from-yellow-400 to-orange-400" : "from-slate-400 to-slate-500";

  return (
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">

      {/* Streak card */}
      <Card className={`overflow-hidden rounded-[22px] bg-gradient-to-br ${streakColor} text-white shadow-lg border-0`}>
        <CardContent className="p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-white/70">Login Streak</p>
              <p className="mt-1 text-4xl font-black">{streak}</p>
              <p className="mt-1 text-sm font-semibold text-white/80">days</p>
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
      <Card className="overflow-hidden rounded-[22px] border-0 bg-gradient-to-br from-violet-600 to-indigo-700 text-white shadow-lg">
        <CardContent className="p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-white/70">My Points</p>
              <p className="mt-1 text-4xl font-black">{(summary?.total_points ?? 0).toLocaleString()}</p>
              <p className="mt-1 text-sm font-semibold text-white/80">
                {summary?.current_tier?.tier_name ?? "Starter"}
              </p>
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

      {/* Quick actions */}
      <Card className="overflow-hidden rounded-[22px] border border-slate-100 bg-white shadow-sm">
        <CardContent className="p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Quick Engage</p>
          <div className="mt-3 flex flex-col gap-2">
            <Link to="/engagement/kudos"
              className="flex items-center gap-3 rounded-xl border border-pink-100 bg-pink-50 px-3 py-2.5 text-sm font-semibold text-pink-700 transition hover:bg-pink-100">
              <Heart className="h-4 w-4" /> Give Kudos
            </Link>
            <Link to="/engagement/badges"
              className="flex items-center gap-3 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2.5 text-sm font-semibold text-amber-700 transition hover:bg-amber-100">
              <Award className="h-4 w-4" /> My Badges ({summary?.badges_earned.length ?? 0})
            </Link>
            <Link to="/career-planning"
              className="flex items-center gap-3 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2.5 text-sm font-semibold text-blue-700 transition hover:bg-blue-100">
              <TrendingUp className="h-4 w-4" /> Career Path
            </Link>
          </div>
        </CardContent>
      </Card>

      {/* Mini leaderboard */}
      <Card className="overflow-hidden rounded-[22px] border border-slate-100 bg-white shadow-sm">
        <CardContent className="p-5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Top This Month</p>
            <Link to="/engagement/leaderboard" className="text-[11px] font-bold text-[#1B6AB5] hover:underline">
              Full board →
            </Link>
          </div>
          <div className="mt-3 space-y-2">
            {leaders.length === 0 && (
              <p className="text-xs text-slate-400">Leaderboard loading…</p>
            )}
            {leaders.map((entry, i) => (
              <div key={entry.employee_id} className="flex items-center gap-3">
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-black ${
                  i === 0 ? "bg-amber-100 text-amber-700" : i === 1 ? "bg-slate-100 text-slate-600" : "bg-orange-50 text-orange-500"
                }`}>
                  {i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉"}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">{entry.employee_name}</span>
                <span className="text-xs font-black text-violet-600">{entry.total_points.toLocaleString()}</span>
              </div>
            ))}
          </div>
          <Link to="/engagement" className="mt-4 flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-3 py-2 text-xs font-bold text-white transition hover:opacity-90">
            <Trophy className="h-3.5 w-3.5" /> Open Engagement Hub
          </Link>
        </CardContent>
      </Card>
    </section>
  );
}

async function getDashboardStats() {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const [empRes, leaveRes, approvedLeaveRes, deptRes, wfmRes, atsRes, payrollRes] = await Promise.allSettled([
      hrmsApi.get<any>('/api/employees?limit=1'),
      hrmsApi.get<any>('/api/leave/requests?status=pending&limit=1'),
      hrmsApi.get<any>('/api/leave/requests?status=approved&limit=1'),
      hrmsApi.get<any>('/api/org/departments'),
      hrmsApi.get<any>(`/api/wfm/live?date=${today}`),
      hrmsApi.get<any>('/api/ats/stats'),
      hrmsApi.get<any>('/api/payroll/runs?limit=1'),
    ]);
    return {
      employees: empRes.status === 'fulfilled' ? (empRes.value.total ?? empRes.value.data?.length ?? 0) : 0,
      pendingLeaves: leaveRes.status === 'fulfilled' ? (leaveRes.value.data?.length ?? 0) : 0,
      approvedLeaves: approvedLeaveRes.status === 'fulfilled' ? (approvedLeaveRes.value.data?.length ?? 0) : 0,
      departments: deptRes.status === 'fulfilled' ? (deptRes.value.data?.length ?? 0) : 0,
      attendanceToday: wfmRes.status === 'fulfilled' ? (wfmRes.value.data?.summary?.present_count ?? wfmRes.value.data?.summary?.logged_in ?? 0) : 0,
      attendanceRate: empRes.status === 'fulfilled' && wfmRes.status === 'fulfilled'
        ? Math.round(((wfmRes.value.data?.summary?.present_count ?? wfmRes.value.data?.summary?.logged_in ?? 0) / Math.max(1, empRes.value.total ?? 1)) * 100)
        : 0,
      atsCandidates: atsRes.status === 'fulfilled' ? (atsRes.value.data?.total ?? 0) : 0,
      onboarding: 0,
      assets: 0,
      payroll: payrollRes.status === 'fulfilled' ? (payrollRes.value.data?.length ?? 0) : 0,
    };
  } catch {
    return { employees: 0, pendingLeaves: 0, approvedLeaves: 0, departments: 0, attendanceToday: 0, attendanceRate: 0, atsCandidates: 0, onboarding: 0, assets: 0, payroll: 0 };
  }
}

export default function Dashboard() {
  const { user } = useAuth();
  const { isAdminOrHR } = useIsAdminOrHR();

  const { data, isLoading } = useQuery({
    queryKey: ["mcn-premium-dashboard"],
    queryFn: getDashboardStats,
    staleTime: 1000 * 60 * 2,
  });

  const stats = data ?? {
    employees: 0,
    departments: 0,
    pendingLeaves: 0,
    approvedLeaves: 0,
    attendanceToday: 0,
    attendanceRate: 0,
    atsCandidates: 0,
    onboarding: 0,
    assets: 0,
    payroll: 0,
  };

  const attendanceRate = useMemo(() => {
    return Math.min(100, Math.round(stats.attendanceRate));
  }, [stats.attendanceRate]);

  const approvalHealth = useMemo(() => {
    const total = stats.pendingLeaves + stats.approvedLeaves;
    if (total === 0) return 100;
    return Math.round((stats.approvedLeaves / total) * 100);
  }, [stats.pendingLeaves, stats.approvedLeaves]);

  const workforceCoverage = useMemo(() => {
    if (stats.employees === 0 || stats.departments === 0) return 0;
    return Math.round((stats.attendanceToday / stats.employees) * 100);
  }, [stats.attendanceToday, stats.employees, stats.departments]);

  const userName =
    user?.email?.split("@")[0] ||
    "there";

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <section className="overflow-hidden rounded-[28px] border border-slate-100 bg-gradient-to-br from-slate-950 via-slate-900 to-[#172033] p-6 text-white shadow-[0_24px_80px_rgba(15,23,42,0.18)]">
          <div className="relative">
            <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-[#1B6AB5]/25 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-20 left-1/3 h-56 w-56 rounded-full bg-[#3BAD49]/15 blur-3xl" />

            <div className="relative grid gap-6 xl:grid-cols-[1.4fr_0.6fr]">
              <div>
                <Badge className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-white hover:bg-white/10">
                  <Sparkles className="mr-1.5 h-3.5 w-3.5 text-[#5aa0dd]" />
                  MCN HRMS Command Center
                </Badge>

                <h1 className="mt-5 max-w-3xl text-3xl font-black tracking-tight md:text-4xl">
                  Good day, {userName}. Your workforce cockpit is ready.
                </h1>

                <p className="mt-3 max-w-2xl text-sm font-medium leading-6 text-slate-300 md:text-base">
                  Monitor employees, attendance, leaves, approvals, onboarding, assets, payroll and daily HR actions from one premium control room.
                </p>

                <div className="mt-6 flex flex-wrap gap-3">
                  {isAdminOrHR ? (
                    <>
                      <Button asChild className="rounded-2xl bg-[#1B6AB5] px-5 font-black text-white shadow-lg shadow-[#1B6AB5]/30 hover:bg-[#155e9f]">
                        <Link to="/employees">
                          <UserPlus className="mr-2 h-4 w-4" />
                          Add Employee
                        </Link>
                      </Button>

                      <Button asChild variant="outline" className="rounded-2xl border-white/15 bg-white/10 px-5 font-black text-white hover:bg-white/15 hover:text-white">
                        <Link to="/reports">
                          <BarChart3 className="mr-2 h-4 w-4" />
                          View Reports
                        </Link>
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button asChild className="rounded-2xl bg-[#1B6AB5] px-5 font-black text-white shadow-lg shadow-[#1B6AB5]/30 hover:bg-[#155e9f]">
                        <Link to="/leaves">
                          <Calendar className="mr-2 h-4 w-4" />
                          Apply Leave
                        </Link>
                      </Button>

                      <Button asChild variant="outline" className="rounded-2xl border-white/15 bg-white/10 px-5 font-black text-white hover:bg-white/15 hover:text-white">
                        <Link to="/attendance">
                          <Clock className="mr-2 h-4 w-4" />
                          Mark Attendance
                        </Link>
                      </Button>
                    </>
                  )}
                </div>
              </div>

              <div className="rounded-[24px] border border-white/10 bg-white/10 p-5 backdrop-blur">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                  Today at a glance
                </p>

                <div className="mt-5 grid grid-cols-2 gap-3">
                  <div className="rounded-2xl bg-white p-4 text-slate-950">
                    <p className="text-2xl font-black">{stats.attendanceToday}</p>
                    <p className="mt-1 text-xs font-bold text-slate-500">Marked Today</p>
                  </div>
                  <div className="rounded-2xl bg-white p-4 text-slate-950">
                    <p className="text-2xl font-black">{stats.pendingLeaves}</p>
                    <p className="mt-1 text-xs font-bold text-slate-500">Pending Leaves</p>
                  </div>
                  <div className="rounded-2xl bg-white p-4 text-slate-950">
                    <p className="text-2xl font-black">{stats.onboarding}</p>
                    <p className="mt-1 text-xs font-bold text-slate-500">Onboarding</p>
                  </div>
                  <div className="rounded-2xl bg-white p-4 text-slate-950">
                    <p className="text-2xl font-black">{stats.departments}</p>
                    <p className="mt-1 text-xs font-bold text-slate-500">Departments</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Engagement strip ──────────────────────────────────────── */}
        <EngagementStrip />

        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            {[1, 2, 3, 4, 5].map((item) => (
              <Card key={item} className="h-36 animate-pulse rounded-[22px] border-slate-100 bg-slate-100/80" />
            ))}
          </div>
        ) : (
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <MetricCard
              label="Total Employees"
              value={stats.employees}
              helper="+ workforce records"
              tone="rose"
              icon={<Users className="h-5 w-5" />}
            />
            <MetricCard
              label="Present Today"
              value={stats.attendanceToday}
              helper={`${attendanceRate}% attendance coverage`}
              tone="emerald"
              icon={<UserCheck className="h-5 w-5" />}
            />
            <MetricCard
              label="Pending Leaves"
              value={stats.pendingLeaves}
              helper="requires approval action"
              tone="amber"
              icon={<CalendarCheck className="h-5 w-5" />}
            />
            <MetricCard
              label="Departments"
              value={stats.departments}
              helper="active org units"
              tone="blue"
              icon={<BuildingIcon />}
            />
            <MetricCard
              label="ATS Candidates"
              value={stats.atsCandidates}
              helper="in recruitment pipeline"
              tone="violet"
              icon={<BadgeCheck className="h-5 w-5" />}
            />
          </section>
        )}

        <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <Card className="overflow-hidden rounded-[26px] border-slate-100 bg-white shadow-sm">
            <CardHeader className="flex flex-row items-start justify-between gap-4 border-b border-slate-100 pb-5">
              <div>
                <CardTitle className="text-xl font-black tracking-tight text-slate-950">
                  Attendance Summary
                </CardTitle>
                <p className="mt-1 text-sm font-medium text-slate-500">
                  Snapshot of today’s workforce attendance health.
                </p>
              </div>

              <Badge className="rounded-full bg-emerald-50 px-3 py-1 font-black text-emerald-700 hover:bg-emerald-50">
                Live
              </Badge>
            </CardHeader>

            <CardContent className="p-6">
              <div className="grid gap-4 md:grid-cols-4">
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Total</p>
                  <p className="mt-2 text-2xl font-black text-slate-950">{stats.employees}</p>
                </div>
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-500">Present</p>
                  <p className="mt-2 text-2xl font-black text-emerald-700">{stats.attendanceToday}</p>
                </div>
                <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-amber-500">Unmarked</p>
                  <p className="mt-2 text-2xl font-black text-amber-700">
                    {Math.max(stats.employees - stats.attendanceToday, 0)}
                  </p>
                </div>
                <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-blue-500">Coverage</p>
                  <p className="mt-2 text-2xl font-black text-blue-700">{attendanceRate}%</p>
                </div>
              </div>

              <div className="mt-6 space-y-5 rounded-[22px] border border-slate-100 bg-white p-5">
                <MiniBar label="Attendance Completion" value={attendanceRate} tone="bg-emerald-100" />
                <MiniBar label="Approval Health" value={approvalHealth} tone="bg-rose-100" />
                <MiniBar label="Workforce Coverage" value={workforceCoverage} tone="bg-blue-100" />
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden rounded-[26px] border-slate-100 bg-white shadow-sm">
            <CardHeader className="border-b border-slate-100 pb-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="text-xl font-black tracking-tight text-slate-950">
                    Action Required
                  </CardTitle>
                  <p className="mt-1 text-sm font-medium text-slate-500">
                    Items needing HR or manager attention.
                  </p>
                </div>

                <Badge className="rounded-full bg-[#fde8e7] px-3 py-1 font-black text-[#E8231A] hover:bg-[#fde8e7]">
                  {stats.pendingLeaves + stats.onboarding} Open
                </Badge>
              </div>
            </CardHeader>

            <CardContent className="space-y-3 p-6">
              <ActionCard
                icon={<CalendarCheck className="h-5 w-5" />}
                title="Pending leave requests"
                desc={`${stats.pendingLeaves} request(s) waiting for approval`}
                href="/leaves"
                tone="rose"
              />
              <ActionCard
                icon={<UserPlus className="h-5 w-5" />}
                title="Onboarding requests"
                desc={`${stats.onboarding} onboarding record(s) available`}
                href="/onboarding"
                tone="blue"
              />
              <ActionCard
                icon={<ShieldCheck className="h-5 w-5" />}
                title="Employee records"
                desc="Review profile completeness and HR documents"
                href="/employees"
                tone="emerald"
              />
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-6 xl:grid-cols-3">
          <Card className="rounded-[26px] border-slate-100 bg-white shadow-sm xl:col-span-2">
            <CardHeader className="border-b border-slate-100 pb-5">
              <CardTitle className="text-xl font-black tracking-tight text-slate-950">
                HR Operations Cockpit
              </CardTitle>
              <p className="text-sm font-medium text-slate-500">
                Quick navigation to high-frequency HR workflows.
              </p>
            </CardHeader>

            <CardContent className="grid gap-4 p-6 md:grid-cols-2">
              <QuickTile
                icon={<Users className="h-5 w-5" />}
                title="Employee Directory"
                desc="Manage employee profiles, departments and roles"
                href="/employees"
                color="rose"
              />
              <QuickTile
                icon={<Clock className="h-5 w-5" />}
                title="Attendance"
                desc="Track daily presence and exceptions"
                href="/attendance"
                color="emerald"
              />
              <QuickTile
                icon={<Calendar className="h-5 w-5" />}
                title="Leave Management"
                desc="Apply, approve and monitor leave balances"
                href="/leaves"
                color="amber"
              />
              <QuickTile
                icon={<CreditCard className="h-5 w-5" />}
                title="Payroll"
                desc="Review salary structures and payslips"
                href="/payroll"
                color="blue"
              />
            </CardContent>
          </Card>

          <Card className="rounded-[26px] border-slate-100 bg-gradient-to-br from-[#e8f2fc] via-white to-white shadow-sm">
            <CardHeader>
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#1B6AB5] text-white shadow-lg shadow-[#1B6AB5]/25">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <CardTitle className="mt-4 text-xl font-black tracking-tight text-slate-950">
                Management Insight
              </CardTitle>
            </CardHeader>

            <CardContent>
              <p className="text-sm font-semibold leading-6 text-slate-600">
                Keep pending approvals below 5 and daily attendance coverage above 90% to maintain clean HR operations.
              </p>

              <div className="mt-5 rounded-2xl border border-rose-100 bg-white p-4">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-rose-400">
                  Current Signal
                </p>
                <p className="mt-2 text-2xl font-black text-slate-950">
                  {stats.pendingLeaves > 5 ? "Needs Attention" : "Healthy"}
                </p>
              </div>

              <Button asChild className="mt-5 w-full rounded-2xl bg-slate-950 font-black text-white hover:bg-[#1B6AB5]">
                <Link to="/reports">
                  Open Reports
                  <ArrowUpRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </section>
      </div>
    </DashboardLayout>
  );
}

function BuildingIcon() {
  return <FileText className="h-5 w-5" />;
}

function ActionCard({
  icon,
  title,
  desc,
  href,
  tone,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  href: string;
  tone: "rose" | "blue" | "emerald";
}) {
  const toneClass = {
    rose: "bg-[#e8f2fc] text-[#1B6AB5] border-[#c4dcf5]",
    blue: "bg-blue-50 text-blue-600 border-blue-100",
    emerald: "bg-emerald-50 text-emerald-600 border-emerald-100",
  }[tone];

  return (
    <Link
      to={href}
      className="group flex items-center gap-4 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className={`flex h-11 w-11 items-center justify-center rounded-2xl border ${toneClass}`}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-black text-slate-950">{title}</p>
        <p className="mt-1 truncate text-xs font-semibold text-slate-500">{desc}</p>
      </div>
      <ArrowUpRight className="h-4 w-4 text-slate-300 transition group-hover:text-[#1B6AB5]" />
    </Link>
  );
}

function QuickTile({
  icon,
  title,
  desc,
  href,
  color,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  href: string;
  color: "rose" | "emerald" | "amber" | "blue";
}) {
  const colorClass = {
    rose: "bg-[#E8231A] shadow-[#E8231A]/25",
    emerald: "bg-emerald-500 shadow-emerald-500/25",
    amber: "bg-amber-500 shadow-amber-500/25",
    blue: "bg-blue-500 shadow-blue-500/25",
  }[color];

  return (
    <Link
      to={href}
      className="group rounded-[22px] border border-slate-100 bg-slate-50/70 p-5 transition hover:-translate-y-1 hover:bg-white hover:shadow-lg"
    >
      <div className={`flex h-12 w-12 items-center justify-center rounded-2xl text-white shadow-lg ${colorClass}`}>
        {icon}
      </div>
      <p className="mt-5 text-base font-black text-slate-950">{title}</p>
      <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">{desc}</p>
      <div className="mt-4 flex items-center text-sm font-black text-[#1B6AB5]">
        Open module
        <ArrowUpRight className="ml-2 h-4 w-4 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
      </div>
    </Link>
  );
}
