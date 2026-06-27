import { useState, useEffect, useRef } from "react";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRightLeft,
  Award,
  CalendarDays,
  FileText,
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
  days_employed: number;
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
  event_type: string;
  event_date: string;
  description: string | null;
  module: string | null;
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
  return formatISTDate(dateStr);
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
  const [searchResults, setSearchResults] = useState<Array<{id: string; name: string; code: string}>>([]);
  const [showResults, setShowResults] = useState(false);
  const [targetId, setTargetId] = useState<string | null>(urlId ?? null);
  const searchRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowResults(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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

  // Search employees by name or code
  async function handleSearchInput(value: string) {
    setSearchInput(value);
    if (value.trim().length < 2) {
      setSearchResults([]);
      setShowResults(false);
      return;
    }

    try {
      const res = await hrmsApi.get<{ data: Array<{id: string; first_name: string; last_name: string | null; employee_code: string}> }>(
        `/api/employees?search=${encodeURIComponent(value.trim())}&limit=10`
      );
      setSearchResults(res.data.map(emp => ({
        id: emp.id,
        name: `${emp.first_name} ${emp.last_name || ''}`.trim(),
        code: emp.employee_code
      })));
      setShowResults(true);
    } catch (err) {
      console.error("Search error:", err);
      setSearchResults([]);
    }
  }

  function selectEmployee(id: string) {
    setTargetId(id);
    setShowResults(false);
    setSearchInput("");
    navigate(`/employee-stat-card/${id}`, { replace: true });
  }

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-5xl mx-auto">

        {/* ── Page header ────────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Employee Journey</h1>
            <p className="text-sm text-slate-500 mt-0.5">Full profile, stats and timeline for any employee</p>
          </div>
          {isAdminOrHR && (
            <div className="relative flex gap-2 items-center">
              <div ref={searchRef} className="relative w-64">
                <Input
                  placeholder="Search by name or employee code..."
                  value={searchInput}
                  onChange={(e) => handleSearchInput(e.target.value)}
                  onFocus={() => searchResults.length > 0 && setShowResults(true)}
                  className="pr-9"
                />
                <Search className="absolute right-3 top-2.5 h-4 w-4 text-slate-400 pointer-events-none" />

                {/* Dropdown results */}
                {showResults && searchResults.length > 0 && (
                  <Card className="absolute top-full left-0 right-0 mt-1 z-50 max-h-72 overflow-y-auto shadow-lg">
                    <CardContent className="p-0">
                      {searchResults.map((emp) => (
                        <button
                          key={emp.id}
                          onClick={() => selectEmployee(emp.id)}
                          className="w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors border-b border-slate-100 last:border-0"
                        >
                          <div className="font-medium text-sm text-slate-900">{emp.name}</div>
                          <div className="text-xs text-slate-500">{emp.code}</div>
                        </button>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </div>
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
            <Card className="overflow-hidden">
              <CardContent className="p-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
                  {/* Avatar */}
                  <div className="shrink-0 flex h-20 w-20 items-center justify-center rounded-full bg-blue-600 text-white text-2xl font-bold shadow-lg">
                    {card.employee.first_name?.[0]?.toUpperCase() ?? "?"}
                    {card.employee.last_name?.[0]?.toUpperCase() ?? ""}
                  </div>

                  {/* Details */}
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-xl font-bold text-slate-900 truncate">{card.employee.full_name}</h2>
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

                    <p className="text-sm text-slate-500">
                      <span className="font-medium text-slate-700">{card.employee.employee_code}</span>
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
                    </div>

                    <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-1">
                      <CalendarDays className="h-3.5 w-3.5" />
                      <span>
                        Joined {fmtDate(card.employee.date_of_joining)} &bull;{" "}
                        <span className="font-medium text-slate-700">
                          {calcTenure(card.employee.date_of_joining)}
                        </span>{" "}
                        tenure
                      </span>
                    </div>
                  </div>
                </div>
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
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-semibold text-slate-800">Employee Journey</CardTitle>
              </CardHeader>
              <CardContent>
                {card.journey.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-6">No journey events recorded yet.</p>
                ) : (
                  <ol className="relative border-l-2 border-slate-100 ml-4 space-y-6">
                    {card.journey.map((evt, idx) => {
                      const cfg = journeyConfig(evt.event_type);
                      return (
                        <li key={idx} className="ml-6">
                          {/* Icon bullet */}
                          <span
                            className={cn(
                              "absolute -left-4 flex h-8 w-8 items-center justify-center rounded-full ring-4 ring-white",
                              cfg.colour
                            )}
                          >
                            {cfg.icon}
                          </span>

                          <div className="flex flex-col gap-0.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-semibold text-slate-800 capitalize">
                                {cfg.label !== "Event" ? cfg.label : (evt.event_type ?? "Event")}
                              </span>
                              {evt.module && (
                                <Badge variant="outline" className="text-[10px] py-0">
                                  {evt.module}
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs text-slate-400">{fmtDate(evt.event_date)}</p>
                            {evt.description && (
                              <p className="text-sm text-slate-600 mt-0.5">{evt.description}</p>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
