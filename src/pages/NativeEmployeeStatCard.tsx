import { useState, useEffect, useRef } from "react";
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

function displayName(emp: { full_name?: string | null; first_name?: string | null; last_name?: string | null }) {
  return String(emp.full_name ?? "").trim() || `${emp.first_name ?? ""} ${emp.last_name ?? ""}`.trim() || "Unknown employee";
}

function initialsForName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return `${parts[0]?.[0] ?? ""}${parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : ""}`.toUpperCase();
}

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

export default function NativeEmployeeStatCard() {
  const { id: urlId } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const { isAdminOrHR } = useIsAdminOrHR();

  const [searchInput, setSearchInput] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{id: string; name: string; code: string}>>([]);
  const [showResults, setShowResults] = useState(false);
  const [targetId, setTargetId] = useState<string | null>(urlId ?? null);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowResults(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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

  async function handleSearchInput(value: string) {
    setSearchInput(value);
    if (value.trim().length < 2) {
      setSearchResults([]);
      setShowResults(false);
      return;
    }

    try {
      const res = await hrmsApi.get<{ data: Array<{id: string; full_name?: string; first_name: string; last_name: string | null; employee_code: string}> }>(
        `/api/employees?search=${encodeURIComponent(value.trim())}&limit=10`
      );
      setSearchResults(res.data.map(emp => ({
        id: emp.id,
        name: displayName(emp),
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
            <Card className="overflow-hidden">
              <CardContent className="p-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
                  <div className="shrink-0 flex h-20 w-20 items-center justify-center rounded-full bg-blue-600 text-white text-2xl font-bold shadow-lg">
                    {initialsForName(displayName(card.employee))}
                  </div>

                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-xl font-bold text-slate-900 truncate">{displayName(card.employee)}</h2>
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

                    <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                      {card.employee.dept_name && <span>{card.employee.dept_name}</span>}
                      {card.employee.process_name && <span>• {card.employee.process_name}</span>}
                      {card.employee.branch_name && <span>• {card.employee.branch_name}</span>}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:w-64">
                    <div className="rounded-2xl bg-slate-50 p-3">
                      <p className="text-xs text-slate-500">Tenure</p>
                      <p className="mt-1 font-bold text-slate-900">{calcTenure(card.employee.date_of_joining)}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-3">
                      <p className="text-xs text-slate-500">Joined</p>
                      <p className="mt-1 font-bold text-slate-900">{fmtDate(card.employee.date_of_joining)}</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card><CardContent className="p-4"><p className="text-xs text-slate-500">Attendance</p><p className="text-2xl font-black text-slate-900">{card.attendance.attendance_pct ?? 0}%</p><Progress value={card.attendance.attendance_pct ?? 0} className="mt-3" /></CardContent></Card>
              <Card><CardContent className="p-4"><p className="text-xs text-slate-500">Active Assets</p><p className="text-2xl font-black text-slate-900">{card.active_assets}</p><Package className="mt-3 h-5 w-5 text-slate-400" /></CardContent></Card>
              <Card><CardContent className="p-4"><p className="text-xs text-slate-500">Pending Docs</p><p className="text-2xl font-black text-slate-900">{card.pending_docs}</p><FileText className="mt-3 h-5 w-5 text-slate-400" /></CardContent></Card>
              <Card><CardContent className="p-4"><p className="text-xs text-slate-500">Points</p><p className="text-2xl font-black text-slate-900">{card.gamification_tier?.total_points ?? 0}</p><Award className="mt-3 h-5 w-5 text-slate-400" /></CardContent></Card>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><CalendarDays className="h-5 w-5" /> Leave Balance</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {card.leave_balances.length === 0 ? <p className="text-sm text-slate-500">No leave balance records.</p> : card.leave_balances.map((l) => (
                    <div key={l.leave_code} className="flex items-center justify-between rounded-xl bg-slate-50 p-3">
                      <div><p className="font-semibold text-slate-900">{l.leave_name ?? l.leave_code}</p><p className="text-xs text-slate-500">Used {l.used_days} days</p></div>
                      <p className="text-lg font-black text-slate-900">{l.available_days}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><Star className="h-5 w-5" /> Performance</CardTitle></CardHeader>
                <CardContent>
                  {card.performance ? <StarRating score={card.performance.overall_score} /> : <p className="text-sm text-slate-500">No performance score found.</p>}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader><CardTitle>Journey Timeline</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {card.journey.length === 0 ? <p className="text-sm text-slate-500">No journey events.</p> : card.journey.map((event, index) => {
                  const cfg = journeyConfig(event.event_type);
                  return (
                    <div key={`${event.event_type}-${event.event_date}-${index}`} className="flex gap-3">
                      <div className={cn("mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-1", cfg.colour)}>{cfg.icon}</div>
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-900">{event.description ?? cfg.label}</p>
                        <p className="text-xs text-slate-500">{fmtDate(event.event_date)} {event.module ? `• ${event.module}` : ""}</p>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
