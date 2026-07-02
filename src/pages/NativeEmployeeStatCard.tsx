import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRightLeft,
  Award,
  CalendarDays,
  CreditCard,
  FileText,
  LogOut,
  Package,
  Printer,
  Search,
  Star,
  TrendingUp,
  UserCircle,
  UserPlus,
  X,
  Zap,
  Briefcase,
  MapPin,
  Phone,
  Mail,
  Clock,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { useIsAdminOrHR } from "@/hooks/useUserRole";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatISTDate } from "@/lib/utils";
import { EmployeeIDCard } from "@/components/employees/EmployeeIDCard";

// ── Types ──────────────────────────────────────────────────────────────────────

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

// ── Helpers ────────────────────────────────────────────────────────────────────

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

// ── Journey config ─────────────────────────────────────────────────────────────

const JOURNEY_CONFIG: Record<string, { icon: React.ReactNode; gradient: string; dotColor: string; label: string }> = {
  hired:       { icon: <UserPlus className="h-4 w-4" />,       gradient: "from-emerald-500 to-teal-600",     dotColor: "bg-emerald-500",  label: "Hired" },
  promoted:    { icon: <TrendingUp className="h-4 w-4" />,     gradient: "from-blue-500 to-indigo-600",      dotColor: "bg-blue-500",     label: "Promoted" },
  transferred: { icon: <ArrowRightLeft className="h-4 w-4" />, gradient: "from-violet-500 to-purple-600",    dotColor: "bg-violet-500",   label: "Transferred" },
  exit:        { icon: <LogOut className="h-4 w-4" />,         gradient: "from-red-500 to-rose-600",         dotColor: "bg-red-500",      label: "Exit" },
  document:    { icon: <FileText className="h-4 w-4" />,       gradient: "from-amber-500 to-orange-600",     dotColor: "bg-amber-500",    label: "Document" },
  award:       { icon: <Award className="h-4 w-4" />,          gradient: "from-yellow-400 to-amber-500",     dotColor: "bg-yellow-400",   label: "Award" },
  default:     { icon: <Zap className="h-4 w-4" />,            gradient: "from-slate-400 to-slate-500",      dotColor: "bg-slate-400",    label: "Event" },
};

function journeyConfig(eventType: string) {
  const key = eventType?.toLowerCase() ?? "default";
  return JOURNEY_CONFIG[key] ?? JOURNEY_CONFIG.default;
}

// ── Animated number ────────────────────────────────────────────────────────────

function AnimatedNumber({ value, suffix = "" }: { value: number; suffix?: string }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    let start = 0;
    const end = value;
    if (end === 0) return;
    const step = Math.max(1, Math.ceil(end / 30));
    const timer = setInterval(() => {
      start = Math.min(start + step, end);
      setDisplay(start);
      if (start >= end) clearInterval(timer);
    }, 20);
    return () => clearInterval(timer);
  }, [value]);
  return <>{display}{suffix}</>;
}

// ── Circular progress ──────────────────────────────────────────────────────────

function CircularProgress({ pct, color }: { pct: number; color: string }) {
  const r = 36;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <svg width="90" height="90" className="rotate-[-90deg]">
      <circle cx="45" cy="45" r={r} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="8" />
      <circle
        cx="45" cy="45" r={r} fill="none"
        stroke="white" strokeWidth="8"
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        style={{ transition: "stroke-dasharray 1s ease" }}
      />
    </svg>
  );
}

// ── Star rating ────────────────────────────────────────────────────────────────

function StarRating({ score, max = 5 }: { score: number; max?: number }) {
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: max }).map((_, i) => (
        <Star
          key={i}
          className={cn("h-5 w-5 drop-shadow-sm", i < Math.round(score) ? "fill-white text-white" : "fill-white/20 text-white/20")}
        />
      ))}
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────

export default function NativeEmployeeStatCard() {
  const { id: urlId } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const { isAdminOrHR } = useIsAdminOrHR();

  const [searchInput, setSearchInput] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ id: string; name: string; code: string }>>([]);
  const [showResults, setShowResults] = useState(false);
  const [showIdCard, setShowIdCard] = useState(false);
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
    if (value.trim().length < 2) { setSearchResults([]); setShowResults(false); return; }
    try {
      const res = await hrmsApi.get<{ data: Array<{ id: string; first_name: string; last_name: string | null; employee_code: string }> }>(
        `/api/employees?search=${encodeURIComponent(value.trim())}&limit=10`
      );
      setSearchResults(res.data.map(emp => ({
        id: emp.id,
        name: `${emp.first_name} ${emp.last_name || ""}`.trim(),
        code: emp.employee_code,
      })));
      setShowResults(true);
    } catch { setSearchResults([]); }
  }

  function selectEmployee(id: string) {
    setTargetId(id);
    setShowResults(false);
    setSearchInput("");
    navigate(`/employee-stat-card/${id}`, { replace: true });
  }

  return (
    <DashboardLayout>
      {/* ── Full-bleed page background ─────────────────────────────────────── */}
      <div className="min-h-screen" style={{ background: "linear-gradient(135deg, #f0f4ff 0%, #faf5ff 40%, #fff1f0 100%)" }}>

        {/* ── Hero Banner ──────────────────────────────────────────────────── */}
        <div
          className="relative overflow-hidden px-8 pt-8 pb-10"
          style={{ background: "linear-gradient(135deg, #1B6AB5 0%, #1557A0 35%, #2d1b8e 65%, #E8231A 100%)" }}
        >
          {/* Decorative circles */}
          <div className="absolute -top-16 -right-16 h-64 w-64 rounded-full opacity-10" style={{ background: "radial-gradient(circle, white, transparent)" }} />
          <div className="absolute -bottom-20 -left-10 h-72 w-72 rounded-full opacity-10" style={{ background: "radial-gradient(circle, white, transparent)" }} />
          <div className="absolute top-8 right-1/3 h-32 w-32 rounded-full opacity-5" style={{ background: "radial-gradient(circle, white, transparent)" }} />

          <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            {/* Logo + title */}
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15 ring-2 ring-white/30 backdrop-blur-sm shadow-xl">
                <img src="/mcn-logo.png" alt="MCN" className="h-10 w-10 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
              </div>
              <div>
                <h1 className="text-2xl font-extrabold tracking-tight text-white drop-shadow">Employee Stat Card</h1>
                <p className="text-sm text-white/70 mt-0.5">360° profile · live stats · journey timeline</p>
              </div>
            </div>

            {/* Search */}
            {isAdminOrHR && (
              <div ref={searchRef} className="relative w-72">
                <div className="relative">
                  <Input
                    placeholder="Search employee name or code…"
                    value={searchInput}
                    onChange={(e) => handleSearchInput(e.target.value)}
                    onFocus={() => searchResults.length > 0 && setShowResults(true)}
                    className="pr-10 bg-white/15 border-white/30 text-white placeholder:text-white/50 backdrop-blur-sm focus:bg-white/25 focus:border-white/60"
                  />
                  <Search className="absolute right-3 top-2.5 h-4 w-4 text-white/60 pointer-events-none" />
                </div>
                {showResults && searchResults.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-2 z-50 rounded-xl bg-white shadow-2xl border border-slate-100 overflow-hidden max-h-72 overflow-y-auto">
                    {searchResults.map((emp) => (
                      <button
                        key={emp.id}
                        onClick={() => selectEmployee(emp.id)}
                        className="w-full text-left px-4 py-3 hover:bg-blue-50 transition-colors border-b border-slate-100 last:border-0 group"
                      >
                        <div className="font-semibold text-sm text-slate-900 group-hover:text-blue-700">{emp.name}</div>
                        <div className="text-xs text-slate-400 font-mono">{emp.code}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Page body ─────────────────────────────────────────────────────── */}
        <div className="px-6 py-6 space-y-6">

          {/* Empty / loading / error states */}
          {!resolvedId && !isLoading && (
            <div className="flex flex-col items-center justify-center py-24 gap-4">
              <div className="h-20 w-20 rounded-full flex items-center justify-center" style={{ background: "linear-gradient(135deg, #1B6AB5, #E8231A)" }}>
                <UserCircle className="h-10 w-10 text-white" />
              </div>
              <p className="text-slate-500 font-medium">
                {isAdminOrHR ? "Search for an employee above to load their profile." : "Loading your profile…"}
              </p>
            </div>
          )}

          {isLoading && (
            <div className="flex items-center justify-center py-24 gap-3">
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-blue-100 border-t-blue-600" />
              <span className="text-slate-500 font-medium">Loading profile…</span>
            </div>
          )}

          {error && (
            <div className="rounded-2xl bg-red-50 border border-red-200 p-6 text-center">
              <p className="text-red-700 font-medium">{(error as Error).message ?? "Failed to load employee data."}</p>
              <Button variant="ghost" size="sm" className="mt-3 text-red-600 hover:text-red-700" onClick={() => refetch()}>
                Retry
              </Button>
            </div>
          )}

          {card && (
            <div className="space-y-6 animate-fadeIn">

              {/* ── Identity Hero Card ──────────────────────────────────────── */}
              <div
                className="relative rounded-3xl overflow-hidden shadow-2xl"
                style={{ background: "linear-gradient(135deg, #1B6AB5 0%, #1050a0 50%, #0d3d85 100%)" }}
              >
                {/* Background pattern */}
                <div className="absolute inset-0 opacity-5" style={{
                  backgroundImage: "radial-gradient(circle at 20% 50%, white 1px, transparent 1px), radial-gradient(circle at 80% 20%, white 1px, transparent 1px)",
                  backgroundSize: "40px 40px",
                }} />
                <div className="absolute top-0 right-0 w-72 h-72 rounded-full opacity-10 translate-x-20 -translate-y-20" style={{ background: "radial-gradient(circle, #E8231A, transparent)" }} />

                <div className="relative z-10 p-6 sm:p-8">
                  <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:gap-8">

                    {/* Avatar */}
                    <div className="shrink-0 relative">
                      <div className="h-24 w-24 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center text-white text-3xl font-extrabold shadow-2xl ring-4 ring-white/30">
                        {card.employee.first_name?.[0]?.toUpperCase() ?? "?"}
                        {card.employee.last_name?.[0]?.toUpperCase() ?? ""}
                      </div>
                      {/* Status dot */}
                      <span className={cn(
                        "absolute -bottom-1 -right-1 h-5 w-5 rounded-full border-2 border-white shadow",
                        card.employee.employment_status?.toLowerCase() === "active" ? "bg-emerald-400" : "bg-red-400"
                      )} />
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0 space-y-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <h2 className="text-2xl font-extrabold text-white tracking-tight">{card.employee.full_name}</h2>
                        <span className={cn(
                          "px-3 py-0.5 rounded-full text-xs font-bold uppercase tracking-wide shadow",
                          card.employee.employment_status?.toLowerCase() === "active"
                            ? "bg-emerald-400/20 text-emerald-200 ring-1 ring-emerald-400/40"
                            : "bg-red-400/20 text-red-200 ring-1 ring-red-400/40"
                        )}>
                          {card.employee.employment_status ?? "Unknown"}
                        </span>
                      </div>

                      <div className="flex flex-wrap gap-2 text-white/80 text-sm">
                        <span className="flex items-center gap-1.5">
                          <Briefcase className="h-3.5 w-3.5 opacity-70" />
                          <span className="font-mono font-bold text-white">{card.employee.employee_code}</span>
                        </span>
                        {card.employee.designation_name && (
                          <span className="flex items-center gap-1.5">
                            <span className="opacity-40">·</span>
                            {card.employee.designation_name}
                          </span>
                        )}
                        {card.employee.employment_type && (
                          <span className="px-2 py-0.5 rounded-full bg-white/10 text-xs font-medium">{card.employee.employment_type}</span>
                        )}
                      </div>

                      {/* Tags row */}
                      <div className="flex flex-wrap gap-2">
                        {card.employee.call_centre_code && (
                          <span className="px-3 py-1 rounded-full bg-white/10 ring-1 ring-white/20 text-xs font-mono text-white/90">
                            {card.employee.call_centre_code}
                          </span>
                        )}
                        {card.employee.branch_name && (
                          <span className="px-3 py-1 rounded-full bg-white/10 ring-1 ring-white/20 text-xs text-white/90 flex items-center gap-1">
                            <MapPin className="h-3 w-3" />{card.employee.branch_name}
                          </span>
                        )}
                        {card.employee.process_name && (
                          <span className="px-3 py-1 rounded-full bg-white/10 ring-1 ring-white/20 text-xs text-white/90">{card.employee.process_name}</span>
                        )}
                        {card.employee.dept_name && (
                          <span className="px-3 py-1 rounded-full bg-white/10 ring-1 ring-white/20 text-xs text-white/90">{card.employee.dept_name}</span>
                        )}
                      </div>

                      {/* Contact row */}
                      <div className="flex flex-wrap gap-4 text-xs text-white/60">
                        {card.employee.email && (
                          <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{card.employee.email}</span>
                        )}
                        {card.employee.mobile && (
                          <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{card.employee.mobile}</span>
                        )}
                      </div>
                    </div>

                    {/* Tenure chip */}
                    <div className="shrink-0 text-center px-6 py-4 rounded-2xl bg-white/10 ring-1 ring-white/20 backdrop-blur-sm">
                      <Clock className="h-5 w-5 text-white/60 mx-auto mb-1" />
                      <p className="text-2xl font-extrabold text-white">{calcTenure(card.employee.date_of_joining)}</p>
                      <p className="text-xs text-white/50 mt-0.5">Tenure</p>
                      <p className="text-xs text-white/40 mt-1">Since {fmtDate(card.employee.date_of_joining)}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* ── ID Card Button ───────────────────────────────────────── */}
              <div className="flex gap-3">
                <button
                  onClick={() => setShowIdCard(true)}
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors"
                >
                  <CreditCard className="h-4 w-4" /> View ID Card
                </button>
              </div>

              {/* ── 6-Stat Grid ────────────────────────────────────────────── */}
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">

                {/* 1. Attendance */}
                <div className="relative rounded-2xl overflow-hidden shadow-lg group hover:shadow-xl transition-all hover:-translate-y-0.5"
                  style={{ background: "linear-gradient(135deg, #0ea5e9 0%, #0284c7 50%, #0369a1 100%)" }}>
                  <div className="absolute top-0 right-0 w-32 h-32 rounded-full opacity-15 translate-x-8 -translate-y-8" style={{ background: "radial-gradient(circle, white, transparent)" }} />
                  <div className="relative z-10 p-5 flex items-center gap-5">
                    <div className="relative">
                      <CircularProgress pct={card.attendance.attendance_pct ?? 0} color="#0ea5e9" />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-sm font-extrabold text-white leading-none">
                          {card.attendance.attendance_pct != null ? `${card.attendance.attendance_pct}%` : "—"}
                        </span>
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-white/60 uppercase tracking-widest">Attendance</p>
                      <p className="text-3xl font-extrabold text-white mt-0.5">
                        <AnimatedNumber value={card.attendance.present_days} />
                        <span className="text-lg text-white/60">/{card.attendance.working_days}</span>
                      </p>
                      <p className="text-xs text-white/50 mt-1">days present this month</p>
                    </div>
                    <TrendingUp className="h-8 w-8 text-white/20 shrink-0" />
                  </div>
                </div>

                {/* 2. Leave Balances */}
                <div className="relative rounded-2xl overflow-hidden shadow-lg group hover:shadow-xl transition-all hover:-translate-y-0.5"
                  style={{ background: "linear-gradient(135deg, #10b981 0%, #059669 50%, #047857 100%)" }}>
                  <div className="absolute top-0 right-0 w-32 h-32 rounded-full opacity-15 translate-x-8 -translate-y-8" style={{ background: "radial-gradient(circle, white, transparent)" }} />
                  <div className="relative z-10 p-5">
                    <div className="flex items-center gap-2 mb-3">
                      <CalendarDays className="h-5 w-5 text-white/70" />
                      <p className="text-xs font-semibold text-white/60 uppercase tracking-widest">Leave Balances</p>
                    </div>
                    {card.leave_balances.length === 0 ? (
                      <p className="text-sm text-white/50 py-2">No leave data for this year.</p>
                    ) : (
                      <div className="space-y-2">
                        {card.leave_balances.slice(0, 4).map((lb) => (
                          <div key={lb.leave_code} className="flex items-center justify-between">
                            <span className="text-sm text-white/80 font-medium truncate max-w-[120px]">
                              {lb.leave_name ?? lb.leave_code}
                            </span>
                            <span className="text-sm font-extrabold text-white bg-white/15 px-2 py-0.5 rounded-lg">
                              {Number(lb.available_days).toFixed(1)}d
                            </span>
                          </div>
                        ))}
                        {card.leave_balances.length > 4 && (
                          <p className="text-xs text-white/40">+{card.leave_balances.length - 4} more</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* 3. Performance */}
                <div className="relative rounded-2xl overflow-hidden shadow-lg group hover:shadow-xl transition-all hover:-translate-y-0.5"
                  style={{ background: "linear-gradient(135deg, #f59e0b 0%, #d97706 50%, #b45309 100%)" }}>
                  <div className="absolute top-0 right-0 w-32 h-32 rounded-full opacity-15 translate-x-8 -translate-y-8" style={{ background: "radial-gradient(circle, white, transparent)" }} />
                  <div className="relative z-10 p-5">
                    <div className="flex items-center gap-2 mb-3">
                      <Star className="h-5 w-5 text-white/70" />
                      <p className="text-xs font-semibold text-white/60 uppercase tracking-widest">Performance</p>
                    </div>
                    {card.performance ? (
                      <div className="space-y-2">
                        <div className="text-4xl font-extrabold text-white">
                          {card.performance.overall_score.toFixed(1)}
                          <span className="text-lg text-white/50">/5</span>
                        </div>
                        <StarRating score={card.performance.overall_score} />
                        <p className="text-xs text-white/50 mt-1">Period: {card.performance.period}</p>
                      </div>
                    ) : (
                      <p className="text-sm text-white/50 py-2">No performance data yet.</p>
                    )}
                  </div>
                  <Star className="absolute bottom-3 right-4 h-16 w-16 text-white/5" />
                </div>

                {/* 4. Active Assets */}
                <div className="relative rounded-2xl overflow-hidden shadow-lg group hover:shadow-xl transition-all hover:-translate-y-0.5"
                  style={{ background: "linear-gradient(135deg, #8b5cf6 0%, #7c3aed 50%, #6d28d9 100%)" }}>
                  <div className="absolute top-0 right-0 w-32 h-32 rounded-full opacity-15 translate-x-8 -translate-y-8" style={{ background: "radial-gradient(circle, white, transparent)" }} />
                  <div className="relative z-10 p-5">
                    <div className="flex items-center gap-2 mb-3">
                      <Package className="h-5 w-5 text-white/70" />
                      <p className="text-xs font-semibold text-white/60 uppercase tracking-widest">Active Assets</p>
                    </div>
                    <div className="text-6xl font-extrabold text-white">
                      <AnimatedNumber value={card.active_assets} />
                    </div>
                    <p className="text-sm text-white/50 mt-2">
                      {card.active_assets === 0 ? "No assets assigned." : `Asset${card.active_assets !== 1 ? "s" : ""} currently assigned`}
                    </p>
                  </div>
                  <Package className="absolute bottom-3 right-4 h-16 w-16 text-white/5" />
                </div>

                {/* 5. Gamification */}
                <div className="relative rounded-2xl overflow-hidden shadow-lg group hover:shadow-xl transition-all hover:-translate-y-0.5"
                  style={{ background: "linear-gradient(135deg, #E8231A 0%, #c41d15 50%, #991b1b 100%)" }}>
                  <div className="absolute top-0 right-0 w-32 h-32 rounded-full opacity-15 translate-x-8 -translate-y-8" style={{ background: "radial-gradient(circle, white, transparent)" }} />
                  <div className="relative z-10 p-5">
                    <div className="flex items-center gap-2 mb-3">
                      <Award className="h-5 w-5 text-white/70" />
                      <p className="text-xs font-semibold text-white/60 uppercase tracking-widest">Engagement Tier</p>
                    </div>
                    {card.gamification_tier ? (
                      <div className="space-y-1">
                        <div className="text-3xl font-extrabold text-white leading-tight">{card.gamification_tier.tier_name}</div>
                        <div className="text-lg font-bold text-white/80">
                          <AnimatedNumber value={card.gamification_tier.total_points} />
                          <span className="text-sm text-white/50 ml-1">pts</span>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-white/50 py-2">Not enrolled in gamification.</p>
                    )}
                  </div>
                  <Award className="absolute bottom-3 right-4 h-16 w-16 text-white/5" />
                </div>

                {/* 6. Pending Docs */}
                <div className={cn(
                  "relative rounded-2xl overflow-hidden shadow-lg group hover:shadow-xl transition-all hover:-translate-y-0.5"
                )}
                  style={{
                    background: card.pending_docs > 0
                      ? "linear-gradient(135deg, #f97316 0%, #ea580c 50%, #c2410c 100%)"
                      : "linear-gradient(135deg, #1B6AB5 0%, #1557a0 50%, #1040a0 100%)"
                  }}>
                  <div className="absolute top-0 right-0 w-32 h-32 rounded-full opacity-15 translate-x-8 -translate-y-8" style={{ background: "radial-gradient(circle, white, transparent)" }} />
                  <div className="relative z-10 p-5">
                    <div className="flex items-center gap-2 mb-3">
                      <FileText className="h-5 w-5 text-white/70" />
                      <p className="text-xs font-semibold text-white/60 uppercase tracking-widest">Pending Docs</p>
                    </div>
                    <div className="text-6xl font-extrabold text-white">
                      <AnimatedNumber value={card.pending_docs} />
                    </div>
                    <p className="text-sm text-white/50 mt-2">
                      {card.pending_docs > 0 ? "Documents awaiting verification" : "All documents verified ✓"}
                    </p>
                  </div>
                  <FileText className="absolute bottom-3 right-4 h-16 w-16 text-white/5" />
                </div>
              </div>

              {/* ── Journey Timeline ───────────────────────────────────────── */}
              <div className="rounded-3xl overflow-hidden shadow-xl bg-white">
                {/* Timeline header */}
                <div className="px-6 py-5 flex items-center gap-3" style={{ background: "linear-gradient(135deg, #1B6AB5, #1040a0)" }}>
                  <div className="h-8 w-8 rounded-xl bg-white/20 flex items-center justify-center">
                    <Zap className="h-4 w-4 text-white" />
                  </div>
                  <h3 className="text-base font-extrabold text-white tracking-tight">Employee Journey Timeline</h3>
                  {card.journey.length > 0 && (
                    <span className="ml-auto px-3 py-0.5 rounded-full bg-white/15 text-xs font-bold text-white">
                      {card.journey.length} event{card.journey.length !== 1 ? "s" : ""}
                    </span>
                  )}
                </div>

                <div className="p-6">
                  {card.journey.length === 0 ? (
                    <div className="flex flex-col items-center py-12 gap-3 text-slate-400">
                      <Zap className="h-10 w-10 opacity-20" />
                      <p className="text-sm">No journey events recorded yet.</p>
                    </div>
                  ) : (
                    <ol className="relative space-y-0">
                      {/* Vertical line */}
                      <div className="absolute left-[19px] top-5 bottom-5 w-0.5 bg-gradient-to-b from-blue-500 via-violet-400 to-slate-200" />

                      {card.journey.map((evt, idx) => {
                        const cfg = journeyConfig(evt.event_type);
                        return (
                          <li key={idx} className="relative flex gap-5 pb-6 last:pb-0">
                            {/* Colored dot */}
                            <div className={cn(
                              "relative z-10 shrink-0 h-10 w-10 rounded-xl flex items-center justify-center text-white shadow-lg",
                              `bg-gradient-to-br ${cfg.gradient}`
                            )}>
                              {cfg.icon}
                            </div>

                            {/* Content */}
                            <div className="flex-1 min-w-0 bg-slate-50 rounded-xl p-4 border border-slate-100 hover:border-slate-200 transition-colors">
                              <div className="flex flex-wrap items-center gap-2 mb-1">
                                <span className="font-bold text-sm text-slate-900 capitalize">
                                  {cfg.label !== "Event" ? cfg.label : (evt.event_type ?? "Event")}
                                </span>
                                {evt.module && (
                                  <span className="px-2 py-0.5 rounded-md bg-slate-200 text-slate-600 text-[10px] font-semibold uppercase tracking-wide">
                                    {evt.module}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-slate-400 font-mono">{fmtDate(evt.event_date)}</p>
                              {evt.description && (
                                <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">{evt.description}</p>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </div>
              </div>

            </div>
          )}
        </div>
      </div>
      {/* ── ID Card Modal ───────────────────────────────────────────── */}
      {showIdCard && card && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4" onClick={() => setShowIdCard(false)}>
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setShowIdCard(false)}
              className="absolute -top-3 -right-3 z-10 h-8 w-8 flex items-center justify-center rounded-full bg-white shadow-lg border text-slate-500 hover:text-slate-900"
            >
              <X className="h-4 w-4" />
            </button>
            <EmployeeIDCard
              employeeId={card.employee.id}
              employeeCode={card.employee.employee_code}
              fullName={card.employee.full_name}
              designation={card.employee.designation_name ?? "—"}
              emergencyContact="Contact HR"
              bloodGroup="—"
            />
            <div className="mt-3 flex justify-center">
              <button
                onClick={() => window.print()}
                className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white shadow-lg hover:bg-slate-800"
              >
                <Printer className="h-4 w-4" /> Print ID Card
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
