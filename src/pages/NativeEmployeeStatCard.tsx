import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRightLeft,
  Award,
  CalendarDays,
  FileText,
  Eye,
  EyeOff,
  IndianRupee,
  LogOut,
  Package,
  Search,
  Star,
  TrendingUp,
  UserCircle,
  UserPlus,
  Zap,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { useIsAdminOrHR } from "@/hooks/useUserRole";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { EmployeeJourneyTimeline } from "@/components/employees/EmployeeJourneyTimeline";

// ── Types ────────────────────────────────────────────────────────────────────

interface Employee {
  id: string;
  employee_code: string;
  full_name: string;
  first_name: string;
  last_name: string | null;
  email: string | null;
  mobile: string | null;
  gender: string | null;
  date_of_joining: string;
  date_of_exit: string | null;
  employment_status: string;
  employment_type: string;
  designation_name: string | null;
  branch_name: string | null;
  call_centre_code: string | null;
  process_name: string | null;
  dept_name: string | null;
  cost_centre_name: string | null;
  reporting_manager_name: string | null;
  days_employed: number;
  avatar_url?: string | null;
  photo_url?: string | null;
}

interface LeaveBalance {
  leave_code: string;
  leave_name: string | null;
  available_days: number;
  used_days: number;
}

interface AttendanceSummary {
  present_days: number;
  working_days: number;
  attendance_pct: number | null;
}

interface PerformanceSummary {
  overall_score: number;
  period: string;
}

interface GamificationTier {
  tier_name: string;
  total_points: number;
}

interface JourneyEvent {
  id?: string;
  event_type: string;
  event_date: string;
  description: string | null;
  module: string | null;
  old_value?: string | null;
  new_value?: string | null;
  actor_name?: string | null;
  status?: string | null;
  source?: string | null;
}

interface StatCardData {
  employee: Employee;
  leave_balances: LeaveBalance[];
  attendance: AttendanceSummary;
  performance: PerformanceSummary | null;
  active_assets: number;
  pending_docs: number;
  gamification_tier: GamificationTier | null;
  journey: JourneyEvent[];
  salary: {
    structure_name: string;
    ctc_annual: number;
    monthly_ctc: number;
    basic: number;
    hra: number;
    other_allowances: number;
    effective_from: string;
  } | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function calcTenure(dateOfJoining: string): string {
  const join = new Date(dateOfJoining);
  const now = new Date();
  let years = now.getFullYear() - join.getFullYear();
  let months = now.getMonth() - join.getMonth();
  if (months < 0) { years -= 1; months += 12; }
  if (years === 0 && months === 0) return "< 1 month";
  const parts: string[] = [];
  if (years > 0) parts.push(`${years} yr${years !== 1 ? "s" : ""}`);
  if (months > 0) parts.push(`${months} mo${months !== 1 ? "s" : ""}`);
  return parts.join(" ");
}

function fmtDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// ── Journey event icon / colour mapping ──────────────────────────────────────

const JOURNEY_CONFIG: Record<string, { icon: React.ReactNode; colour: string; label: string }> = {
  hired:       { icon: <UserPlus className="h-4 w-4" />,       colour: "bg-emerald-100 text-emerald-700 ring-emerald-200", label: "Hired" },
  promoted:    { icon: <TrendingUp className="h-4 w-4" />,     colour: "bg-blue-100 text-blue-700 ring-blue-200",         label: "Promoted" },
  transferred: { icon: <ArrowRightLeft className="h-4 w-4" />, colour: "bg-violet-100 text-violet-700 ring-violet-200",   label: "Transferred" },
  exit:        { icon: <LogOut className="h-4 w-4" />,         colour: "bg-red-100 text-red-700 ring-red-200",            label: "Exit" },
  document:    { icon: <FileText className="h-4 w-4" />,       colour: "bg-amber-100 text-amber-700 ring-amber-200",      label: "Document" },
  award:       { icon: <Award className="h-4 w-4" />,          colour: "bg-yellow-100 text-yellow-700 ring-yellow-200",   label: "Award" },
  default:     { icon: <Zap className="h-4 w-4" />,            colour: "bg-slate-100 text-slate-600 ring-slate-200",      label: "Event" },
};

function journeyConfig(eventType: string) {
  const key = eventType?.toLowerCase() ?? "default";
  return JOURNEY_CONFIG[key] ?? JOURNEY_CONFIG.default;
}

// ── Star rating display ───────────────────────────────────────────────────────

function StarRating({ score, max = 5 }: { score: number; max?: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: max }).map((_, i) => (
        <Star
          key={i}
          className={cn("h-4 w-4", i < Math.round(score) ? "fill-amber-400 text-amber-400" : "text-slate-200")}
        />
      ))}
      <span className="ml-1 text-sm font-semibold text-slate-700">{score.toFixed(1)}</span>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function NativeEmployeeStatCard() {
  const { id: urlId } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const { isAdminOrHR } = useIsAdminOrHR();

  const [searchInput, setSearchInput] = useState("");
  const [targetId, setTargetId] = useState<string | null>(urlId ?? null);
  const [salaryVisible, setSalaryVisible] = useState(false);

  // If not admin/HR, always load own record via /me first
  const { data: meData } = useQuery({
    queryKey: ["employee-me"],
    queryFn: () => hrmsApi.get<{ success: boolean; data: { id: string } }>("/api/employees/me"),
    enabled: !isAdminOrHR && !targetId,
  });

  const resolvedId = targetId ?? meData?.data?.id ?? null;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["employee-stat-card", resolvedId],
    queryFn: () => hrmsApi.get<{ data: StatCardData }>(`/api/employees/${resolvedId}/stat-card`),
    enabled: !!resolvedId,
  });

  const card = data?.data;

  function handleSearch() {
    const trimmed = searchInput.trim();
    if (!trimmed) return;
    setTargetId(trimmed);
    navigate(`/employee-stat-card/${trimmed}`, { replace: true });
  }

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-7xl space-y-6">

        {/* ── Page header ────────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Employee Journey</h1>
            <p className="text-sm text-slate-500 mt-0.5">Full profile, stats and timeline for any employee</p>
          </div>
          {isAdminOrHR && (
            <div className="flex gap-2 items-center">
              <Input
                placeholder="Employee ID..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="w-52"
              />
              <Button onClick={handleSearch} size="sm" className="shrink-0">
                <Search className="h-4 w-4 mr-1.5" /> Load
              </Button>
            </div>
          )}
        </div>

        {/* ── Loading / error states ─────────────────────────────────────────── */}
        {!resolvedId && !isLoading && (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
              <UserCircle className="h-12 w-12 opacity-30" />
              <p className="text-sm">
                {isAdminOrHR
                  ? "Enter an Employee ID above to load their stat card."
                  : "Loading your profile…"}
              </p>
            </CardContent>
          </Card>
        )}

        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600" />
          </div>
        )}

        {error && (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="py-6 text-center text-red-700 text-sm">
              {(error as Error).message ?? "Failed to load employee data."}
              <Button variant="ghost" size="sm" className="ml-3 text-red-600" onClick={() => refetch()}>
                Retry
              </Button>
            </CardContent>
          </Card>
        )}

        {card && (
          <>
            {/* ── Identity header ───────────────────────────────────────────── */}
            <Card className="overflow-hidden border-0 bg-[#073f78] text-white shadow-lg">
              <CardContent className="p-7">
                <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:gap-7">
                  {/* Avatar */}
                  <Avatar className="size-36 shrink-0 border-4 border-white shadow-xl ring-2 ring-green-300">
                    <AvatarImage
                      src={card.employee.avatar_url || card.employee.photo_url || undefined}
                      alt={`${card.employee.full_name} profile photo`}
                    />
                    <AvatarFallback className="bg-[#1B6AB5] text-3xl font-black text-white">
                      {card.employee.first_name?.[0]?.toUpperCase() ?? "?"}
                      {card.employee.last_name?.[0]?.toUpperCase() ?? ""}
                    </AvatarFallback>
                  </Avatar>

                  {/* Details */}
                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-balance text-3xl font-black text-white">{card.employee.full_name}</h2>
                      <Badge
                        className={cn(
                          "text-xs font-semibold",
                          card.employee.employment_status?.toLowerCase() === "active"
                            ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100"
                            : "bg-red-100 text-red-700 hover:bg-red-100"
                        )}
                      >
                        {card.employee.employment_status ?? "Unknown"}
                      </Badge>
                    </div>

                    <p className="text-base text-blue-100">
                      <span className="font-bold text-white">{card.employee.employee_code}</span>
                      {card.employee.designation_name && (
                        <> &bull; {card.employee.designation_name}</>
                      )}
                    </p>

                    <div className="flex flex-wrap gap-2 mt-1">
                      {card.employee.call_centre_code && (
                        <Badge variant="outline" className="text-xs font-mono">
                          {card.employee.call_centre_code}
                        </Badge>
                      )}
                      {card.employee.branch_name && (
                        <Badge variant="secondary" className="text-xs">
                          {card.employee.branch_name}
                        </Badge>
                      )}
                      {card.employee.process_name && (
                        <Badge variant="secondary" className="text-xs">
                          {card.employee.process_name}
                        </Badge>
                      )}
                      {card.employee.dept_name && (
                        <Badge variant="secondary" className="text-xs">
                          {card.employee.dept_name}
                        </Badge>
                      )}
                      {card.employee.cost_centre_name && (
                        <Badge variant="secondary" className="text-xs">
                          {card.employee.cost_centre_name}
                        </Badge>
                      )}
                    </div>

                    <div className="mt-2 flex items-center gap-1.5 text-sm text-blue-100">
                      <CalendarDays className="h-3.5 w-3.5" />
                      <span>
                        Joined {fmtDate(card.employee.date_of_joining)} &bull;{" "}
                        <span className="font-bold text-white">
                          {calcTenure(card.employee.date_of_joining)}
                        </span>{" "}
                        tenure
                      </span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-blue-100 bg-gradient-to-br from-white to-blue-50/60">
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <IndianRupee className="h-5 w-5 text-[#1B6AB5]" />
                    Salary Components
                  </CardTitle>
                  <p className="mt-1 text-xs text-slate-500">
                    Confidential compensation data is hidden by default.
                  </p>
                </div>
                {card.salary && (
                  <Button variant="outline" size="sm" onClick={() => setSalaryVisible((visible) => !visible)}>
                    {salaryVisible ? <EyeOff className="mr-2 h-4 w-4" /> : <Eye className="mr-2 h-4 w-4" />}
                    {salaryVisible ? "Hide salary" : "View salary"}
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                {!card.salary ? (
                  <p className="text-sm text-slate-500">No active salary assignment is available.</p>
                ) : !salaryVisible ? (
                  <div className="grid gap-3 sm:grid-cols-4">
                    {["Annual CTC", "Monthly CTC", "Basic", "Allowances"].map((label) => (
                      <div key={label} className="rounded-xl border bg-white p-4">
                        <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</p>
                        <p className="mt-2 select-none text-xl font-black tracking-[0.2em] text-slate-300 blur-sm">₹00,000</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                    {[
                      ["Annual CTC", card.salary.ctc_annual],
                      ["Monthly CTC", card.salary.monthly_ctc],
                      ["Basic", card.salary.basic],
                      ["HRA", card.salary.hra],
                      ["Other Allowances", card.salary.other_allowances],
                    ].map(([label, value]) => (
                      <div key={String(label)} className="rounded-xl border bg-white p-4">
                        <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</p>
                        <p className="mt-2 text-lg font-black text-slate-900">
                          ₹{Number(value).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                        </p>
                      </div>
                    ))}
                    <div className="sm:col-span-2 lg:col-span-5 text-xs text-slate-500">
                      Structure: <b>{card.salary.structure_name}</b> · Effective {fmtDate(card.salary.effective_from)}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ── 6-stat grid ───────────────────────────────────────────────── */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">

              {/* 1. Leave Balance */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold text-slate-600 flex items-center gap-2">
                    <CalendarDays className="h-4 w-4 text-blue-500" />
                    Leave Balances
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {card.leave_balances.length === 0 ? (
                    <p className="text-xs text-slate-400">No leave data for this year.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {card.leave_balances.map((lb) => (
                        <div key={lb.leave_code} className="flex items-center justify-between text-sm">
                          <span className="text-slate-600 font-medium">
                            {lb.leave_name ?? lb.leave_code}
                          </span>
                          <span className="font-bold text-slate-900">{Number(lb.available_days).toFixed(1)} days</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* 2. Attendance % */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold text-slate-600 flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-emerald-500" />
                    Attendance (This Month)
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-end justify-between">
                    <span className="text-3xl font-bold text-slate-900">
                      {card.attendance.attendance_pct != null
                        ? `${card.attendance.attendance_pct}%`
                        : "—"}
                    </span>
                    <span className="text-xs text-slate-500">
                      {card.attendance.present_days}/{card.attendance.working_days} days
                    </span>
                  </div>
                  <Progress
                    value={card.attendance.attendance_pct ?? 0}
                    className="h-2"
                  />
                </CardContent>
              </Card>

              {/* 3. Performance Rating */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold text-slate-600 flex items-center gap-2">
                    <Star className="h-4 w-4 text-amber-500" />
                    Latest Performance
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {card.performance ? (
                    <>
                      <StarRating score={card.performance.overall_score} />
                      <p className="text-xs text-slate-400">Period: {card.performance.period}</p>
                    </>
                  ) : (
                    <p className="text-xs text-slate-400">No performance data yet.</p>
                  )}
                </CardContent>
              </Card>

              {/* 4. Active Assets */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold text-slate-600 flex items-center gap-2">
                    <Package className="h-4 w-4 text-violet-500" />
                    Active Assets
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <span className="text-3xl font-bold text-slate-900">{card.active_assets}</span>
                  <p className="text-xs text-slate-400 mt-1">
                    {card.active_assets === 0 ? "No assets assigned." : `Asset${card.active_assets !== 1 ? "s" : ""} currently assigned.`}
                  </p>
                </CardContent>
              </Card>

              {/* 5. Gamification */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold text-slate-600 flex items-center gap-2">
                    <Award className="h-4 w-4 text-yellow-500" />
                    Engagement Tier
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1">
                  {card.gamification_tier ? (
                    <>
                      <p className="text-xl font-bold text-slate-900">{card.gamification_tier.tier_name}</p>
                      <p className="text-xs text-slate-500">
                        {card.gamification_tier.total_points.toLocaleString()} total points
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-slate-400">Not enrolled in gamification.</p>
                  )}
                </CardContent>
              </Card>

              {/* 6. Pending Docs */}
              <Card className={card.pending_docs > 0 ? "border-amber-300 bg-amber-50" : ""}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold text-slate-600 flex items-center gap-2">
                    <FileText className={cn("h-4 w-4", card.pending_docs > 0 ? "text-amber-500" : "text-slate-400")} />
                    Pending Documents
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <span className={cn("text-3xl font-bold", card.pending_docs > 0 ? "text-amber-700" : "text-slate-900")}>
                    {card.pending_docs}
                  </span>
                  <p className="text-xs mt-1 text-slate-500">
                    {card.pending_docs > 0
                      ? "Documents awaiting verification."
                      : "All documents verified."}
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* ── Journey Timeline ──────────────────────────────────────────── */}
            <EmployeeJourneyTimeline
              employeeName={card.employee.full_name}
              events={card.journey}
            />
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
