import { useState, useEffect, useRef, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Search,
  Shield,
  Timer,
  TrendingDown,
  TrendingUp,
  User,
  X,
} from "lucide-react";
import { format, startOfMonth, addMonths, subMonths } from "date-fns";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { AttendanceCalendar } from "@/components/attendance/AttendanceCalendar";
import { useMyAttendanceSummary, type MonthlySummary } from "@/hooks/useAttendance";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { hrmsApi } from "@/lib/hrmsApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

// ── Types ──────────────────────────────────────────────────────────────────

interface EmployeeResult {
  id: string;
  employee_code?: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  branch?: string;
  branch_name?: string;
  designation?: string;
  department?: string;
  status?: string;
}

function empDisplayName(e: EmployeeResult): string {
  if (e.name) return e.name;
  return [e.first_name, e.last_name].filter(Boolean).join(" ") || "—";
}

// ── Metric card (mirrors Attendance.tsx style) ─────────────────────────────

const toneMap: Record<string, { card: string; icon: string }> = {
  sky:     { card: "border-sky-100 bg-gradient-to-br from-white via-white to-sky-50",     icon: "bg-sky-50 text-sky-700 ring-sky-100" },
  emerald: { card: "border-emerald-100 bg-gradient-to-br from-white via-white to-emerald-50", icon: "bg-emerald-50 text-emerald-700 ring-emerald-100" },
  indigo:  { card: "border-[#c4dcf5] bg-gradient-to-br from-white via-white to-[#e8f2fc]", icon: "bg-[#e8f2fc] text-[#1B6AB5] ring-[#c4dcf5]" },
  amber:   { card: "border-amber-100 bg-gradient-to-br from-white via-white to-amber-50",  icon: "bg-amber-50 text-amber-700 ring-amber-100" },
  rose:    { card: "border-rose-100 bg-gradient-to-br from-white via-white to-rose-50",    icon: "bg-rose-50 text-rose-700 ring-rose-100" },
  slate:   { card: "border-slate-200 bg-white",                                            icon: "bg-slate-100 text-slate-700 ring-slate-200" },
  violet:  { card: "border-violet-100 bg-gradient-to-br from-white via-white to-violet-50",icon: "bg-violet-50 text-violet-700 ring-violet-100" },
};

function MetricCard({
  label,
  value,
  description,
  icon,
  tone,
}: {
  label: string;
  value: string | number;
  description: string;
  icon: ReactNode;
  tone: keyof typeof toneMap;
}) {
  const s = toneMap[tone] ?? toneMap.slate;
  return (
    <div className={`rounded-2xl border p-4 shadow-sm hover:shadow-2xl hover:-translate-y-0.5 transition-all duration-200 ${s.card}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</p>
          <h3 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{value}</h3>
        </div>
        <div className={`rounded-xl p-2.5 ring-1 ${s.icon}`}>{icon}</div>
      </div>
      <p className="mt-3 text-xs leading-5 text-slate-500">{description}</p>
    </div>
  );
}

function safeNum(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function fmtHours(v: unknown): string {
  return `${safeNum(v).toFixed(1)}h`;
}

// ── Summary cards ──────────────────────────────────────────────────────────

function SummaryCards({ data }: { data: MonthlySummary }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
      <MetricCard label="Present" value={safeNum(data.presentDays)} description="Days marked present." icon={<CheckCircle2 className="h-5 w-5" />} tone="emerald" />
      <MetricCard label="Absent" value={safeNum(data.absentDays)} description="Days absent." icon={<AlertTriangle className="h-5 w-5" />} tone="rose" />
      <MetricCard label="Half Days" value={safeNum(data.halfDays)} description="Half-day records." icon={<Timer className="h-5 w-5" />} tone="amber" />
      <MetricCard label="LWP" value={safeNum(data.totalLwp) % 1 === 0 ? String(safeNum(data.totalLwp)) : safeNum(data.totalLwp).toFixed(1)} description="Leave without pay." icon={<TrendingDown className="h-5 w-5" />} tone="amber" />
      <MetricCard label="Late Marks" value={safeNum(data.lateMarks)} description="Late arrival count." icon={<Clock className="h-5 w-5" />} tone="violet" />
      <MetricCard label="WFO Days" value={safeNum(data.wfoDays)} description="Office attendance days." icon={<TrendingUp className="h-5 w-5" />} tone="sky" />
      <MetricCard
        label="Total Hours"
        value={fmtHours(data.totalHours)}
        description="Aggregate logged hours."
        icon={<Timer className="h-5 w-5" />}
        tone="indigo"
      />
    </div>
  );
}

// ── Employee search popover ────────────────────────────────────────────────

function EmployeeSearch({
  onSelect,
}: {
  onSelect: (emp: EmployeeResult) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<EmployeeResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await hrmsApi.get<any>(
          `/api/employees?search=${encodeURIComponent(query)}&limit=20`
        );
        const rows: EmployeeResult[] =
          Array.isArray(res) ? res :
          Array.isArray(res?.data) ? res.data :
          Array.isArray(res?.employees) ? res.employees : [];
        setResults(rows);
        setOpen(rows.length > 0);
      } catch {
        setResults([]);
        setOpen(false);
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [query]);

  // close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function pick(emp: EmployeeResult) {
    onSelect(emp);
    setQuery("");
    setResults([]);
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or employee code…"
          className="pl-9 pr-4"
        />
        {loading && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
            searching…
          </span>
        )}
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden">
          {results.map((emp) => (
            <button
              key={emp.id}
              type="button"
              onClick={() => pick(emp)}
              className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors border-b border-slate-100 last:border-0"
            >
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-700">
                <User className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900 truncate">{empDisplayName(emp)}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {emp.employee_code && <span className="mr-2 font-mono">{emp.employee_code}</span>}
                  {(emp.branch_name ?? emp.branch) && <span>{emp.branch_name ?? emp.branch}</span>}
                  {emp.designation && <span className="ml-2 text-slate-400">· {emp.designation}</span>}
                </p>
              </div>
              {emp.status && (
                <Badge className={`ml-auto text-[10px] shrink-0 ${emp.status === "active" ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-50" : "bg-slate-100 text-slate-600 hover:bg-slate-100"}`}>
                  {emp.status}
                </Badge>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function AdminAttendanceView() {
  const navigate = useNavigate();
  const { hasAnyRole } = useWorkforceAccess();

  const canAccess = hasAnyRole(
    "super_admin", "admin", "hr", "payroll_head", "payroll_admin", "wfm"
  );

  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeResult | null>(null);
  const [currentMonth, setCurrentMonth] = useState<Date>(startOfMonth(new Date()));

  const monthLabel = format(currentMonth, "MMMM yyyy");

  const { data: summary, isLoading: summaryLoading } = useMyAttendanceSummary(
    selectedEmployee?.id,
    currentMonth
  );

  if (!canAccess) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center">
          <div className="rounded-full bg-rose-50 p-4">
            <Shield className="h-8 w-8 text-rose-500" />
          </div>
          <h2 className="text-xl font-semibold text-slate-900">Access Restricted</h2>
          <p className="text-sm text-slate-500 max-w-sm">
            You need Super Admin, HR, Payroll Head, or WFM role to access the attendance lookup tool.
          </p>
          <Button variant="outline" onClick={() => navigate(-1)}>Go Back</Button>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6 pb-10">

        {/* ── Header ── */}
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight text-slate-950">
            Attendance Lookup
          </h1>
          <p className="text-sm text-slate-500">
            Search for any employee to view their monthly summary and daily attendance records.
          </p>
          <div className="mt-2 inline-flex w-fit items-center rounded-full border border-[#c4dcf5] bg-[#e8f2fc] px-3 py-1 text-[11px] font-semibold text-[#1B6AB5]">
            Source: Direct COSEC
          </div>
        </div>

        {/* ── Employee selector ── */}
        <div className="rounded-2xl border border-slate-200 bg-white/80 backdrop-blur-sm p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500 mb-3">
            Select Employee
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {selectedEmployee ? (
              <div className="flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2">
                <User className="h-4 w-4 text-indigo-600 shrink-0" />
                <span className="text-sm font-medium text-indigo-900">
                  {empDisplayName(selectedEmployee)}
                </span>
                {selectedEmployee.employee_code && (
                  <span className="text-xs font-mono text-indigo-600">
                    ({selectedEmployee.employee_code})
                  </span>
                )}
                {(selectedEmployee.branch_name ?? selectedEmployee.branch) && (
                  <span className="text-xs text-indigo-500">
                    · {selectedEmployee.branch_name ?? selectedEmployee.branch}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedEmployee(null)}
                  className="ml-1 rounded-full p-0.5 hover:bg-indigo-200 transition-colors"
                  aria-label="Clear selection"
                >
                  <X className="h-3.5 w-3.5 text-indigo-600" />
                </button>
              </div>
            ) : (
              <EmployeeSearch onSelect={(emp) => {
                setSelectedEmployee(emp);
                setCurrentMonth(startOfMonth(new Date()));
              }} />
            )}
          </div>
        </div>

        {/* ── Content: only shown when employee is selected ── */}
        {selectedEmployee && (
          <>
            {/* ── Month navigator ── */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setCurrentMonth((m) => subMonths(m, 1))}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white hover:bg-slate-50 transition-colors shadow-sm"
                aria-label="Previous month"
              >
                <ChevronLeft className="h-4 w-4 text-slate-600" />
              </button>
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-1.5 shadow-sm">
                <Calendar className="h-4 w-4 text-slate-500" />
                <span className="text-sm font-semibold text-slate-800">{monthLabel}</span>
              </div>
              <button
                type="button"
                onClick={() => setCurrentMonth((m) => addMonths(m, 1))}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white hover:bg-slate-50 transition-colors shadow-sm"
                aria-label="Next month"
              >
                <ChevronRight className="h-4 w-4 text-slate-600" />
              </button>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-slate-500 hover:text-slate-800"
                onClick={() => setCurrentMonth(startOfMonth(new Date()))}
              >
                Today
              </Button>
            </div>

            {/* ── Monthly summary cards ── */}
            <section>
              <h2 className="text-sm font-semibold text-slate-700 mb-3">
                Monthly Summary — {monthLabel}
              </h2>
              <div className="mb-3 inline-flex items-center rounded-full border border-[#c4dcf5] bg-[#e8f2fc] px-3 py-1 text-[11px] font-semibold text-[#1B6AB5]">
                Summary Source: Direct COSEC
              </div>
              {summaryLoading ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
                  {Array.from({ length: 7 }).map((_, i) => (
                    <Skeleton key={i} className="h-24 rounded-2xl" />
                  ))}
                </div>
              ) : summary ? (
                <SummaryCards data={summary} />
              ) : (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
                  No summary data available for {monthLabel}.
                </div>
              )}
            </section>

            {/* ── Attendance calendar ── */}
            <section className="rounded-2xl border border-slate-200 bg-white/80 backdrop-blur-sm p-4 shadow-sm">
              <div className="mb-4">
                <h2 className="text-sm font-semibold tracking-tight text-slate-950">
                  Daily Attendance — {empDisplayName(selectedEmployee)}
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  Click any day to view the detailed record, breaks, and available actions.
                </p>
              </div>
              <AttendanceCalendar
                employeeId={selectedEmployee.id}
                initialMonth={currentMonth.getMonth()}
                initialYear={currentMonth.getFullYear()}
              />
            </section>
          </>
        )}

        {/* ── Placeholder when no employee selected ── */}
        {!selectedEmployee && (
          <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/50 py-20 gap-4 text-center">
            <div className="rounded-full bg-slate-100 p-4">
              <Search className="h-8 w-8 text-slate-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-700">Search for an employee to begin</p>
              <p className="mt-1 text-xs text-slate-400">
                Type a name or employee code above to look up attendance records.
              </p>
            </div>
          </div>
        )}

      </div>
    </DashboardLayout>
  );
}
