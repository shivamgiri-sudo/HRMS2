import { useState, useEffect, useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Briefcase,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  Home,
  LogIn,
  LogOut,
  MapPin,
  RefreshCcw,
  Timer,
} from "lucide-react";
import { format } from "date-fns";

import { formatISTTime, formatISTDate } from "@/lib/utils";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { AttendanceCalendar } from "@/components/attendance/AttendanceCalendar";
import { useAuth } from "@/contexts/AuthContext";
import { useIsAdminOrHR } from "@/hooks/useUserRole";
import {
  AttendanceRecord,
  MonthlySummary,
  useAttendance,
  useMyAttendanceSummary,
  useTodayAttendance,
  useTodayLivePunch,
} from "@/hooks/useAttendance";
import { hrmsApi } from "@/lib/hrmsApi";
import { useActiveBreak, useBreaksForRecord } from "@/hooks/useAttendanceBreaks";
import { usePagination } from "@/hooks/usePagination";
import { useSorting } from "@/hooks/useSorting";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AIInsightPanel } from "@/components/ai";

const MONTHS = [
  { value: "0", label: "January" },
  { value: "1", label: "February" },
  { value: "2", label: "March" },
  { value: "3", label: "April" },
  { value: "4", label: "May" },
  { value: "5", label: "June" },
  { value: "6", label: "July" },
  { value: "7", label: "August" },
  { value: "8", label: "September" },
  { value: "9", label: "October" },
  { value: "10", label: "November" },
  { value: "11", label: "December" },
];

const isOfficeMode = (mode?: string | null) =>
  mode === "wfo" || mode === "office";

function getExpectedHours(workStart: string, workEnd: string): number {
  const [sh, sm] = workStart.split(":").map(Number);
  const [eh, em] = workEnd.split(":").map(Number);
  return Math.max(0, (eh * 60 + em - (sh * 60 + sm)) / 60);
}

function safeFormatDate(value: string | null | undefined, fmt: string, fallback = "-"): string {
  if (!value) return fallback;
  // Use IST timezone-aware formatting
  if (fmt.includes("hh") || fmt.includes("HH")) return formatISTTime(value) || fallback;
  return formatISTDate(value) || fallback;
}

function safeNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatHours(value: unknown, digits = 1): string {
  return `${safeNumber(value).toFixed(digits)}h`;
}

function formatBreakMinutes(value: unknown): string {
  const minutes = safeNumber(value);
  if (minutes <= 0) return "0m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining > 0 ? `${hours}h ${remaining}m` : `${hours}h`;
}

interface EmployeeSchedule {
  id: string;
  first_name: string | null;
  last_name: string | null;
  working_hours_start: string | null;
  working_hours_end: string | null;
  working_days: number[] | null;
}

interface AttendanceMetricCardProps {
  label: string;
  value: string | number;
  description: string;
  icon: ReactNode;
  tone: "sky" | "emerald" | "indigo" | "amber" | "slate";
}

const metricToneMap = {
  sky: {
    card: "border-sky-100 bg-gradient-to-br from-white via-white to-sky-50",
    icon: "bg-sky-50 text-sky-700 ring-sky-100",
  },
  emerald: {
    card: "border-emerald-100 bg-gradient-to-br from-white via-white to-emerald-50",
    icon: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  },
  indigo: {
    card: "border-[#c4dcf5] bg-gradient-to-br from-white via-white to-[#e8f2fc]",
    icon: "bg-[#e8f2fc] text-[#1B6AB5] ring-[#c4dcf5]",
  },
  amber: {
    card: "border-amber-100 bg-gradient-to-br from-white via-white to-amber-50",
    icon: "bg-amber-50 text-amber-700 ring-amber-100",
  },
  slate: {
    card: "border-slate-200 bg-white",
    icon: "bg-slate-100 text-slate-700 ring-slate-200",
  },
};

const AttendanceMetricCard = ({
  label,
  value,
  description,
  icon,
  tone,
}: AttendanceMetricCardProps) => {
  const style = metricToneMap[tone];

  return (
    <div className={`rounded-2xl border p-4 shadow-sm hover:shadow-2xl hover:-translate-y-0.5 transition-all duration-200 cursor-pointer ${style.card}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
            {label}
          </p>

          <h3 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
            {value}
          </h3>
        </div>

        <div className={`rounded-xl p-2.5 ring-1 ${style.icon}`}>{icon}</div>
      </div>

      <p className="mt-3 text-xs leading-5 text-slate-500">{description}</p>
    </div>
  );
};

const getStatusBadge = (status: string) => {
  const normalized = status?.toLowerCase();

  if (normalized === "present") {
    return (
      <Badge className="bg-emerald-50 text-emerald-700 hover:bg-emerald-50">
        Present
      </Badge>
    );
  }

  if (normalized === "late") {
    return (
      <Badge className="bg-amber-50 text-amber-700 hover:bg-amber-50">
        Late
      </Badge>
    );
  }

  if (normalized === "half-day" || normalized === "half_day") {
    return (
      <Badge className="bg-sky-50 text-sky-700 hover:bg-sky-50">
        Half Day
      </Badge>
    );
  }

  if (normalized === "absent") {
    return (
      <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100">
        Absent
      </Badge>
    );
  }

  if (normalized === "missing_punch") {
    return (
      <Badge className="bg-rose-50 text-rose-700 hover:bg-rose-50">
        Missing Punch
      </Badge>
    );
  }

  if (normalized === "week_off_worked") {
    return (
      <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">
        Worked on WO
      </Badge>
    );
  }

  if (normalized === "week_off") {
    return (
      <Badge className="bg-violet-50 text-violet-700 hover:bg-violet-50">
        Week Off
      </Badge>
    );
  }

  if (normalized === "leave_approved") {
    return (
      <Badge className="bg-blue-50 text-blue-700 hover:bg-blue-50">
        On Leave
      </Badge>
    );
  }

  if (normalized === "holiday") {
    return (
      <Badge className="bg-teal-50 text-teal-700 hover:bg-teal-50">
        Holiday
      </Badge>
    );
  }

  if (normalized === "unreconciled") {
    return (
      <Badge className="bg-orange-50 text-orange-700 hover:bg-orange-50">
        Unreconciled
      </Badge>
    );
  }

  return (
    <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100">
      {status || "-"}
    </Badge>
  );
};

const Attendance = () => {
  const { user } = useAuth();
  const { isAdminOrHR } = useIsAdminOrHR();

  const [selectedMonth, setSelectedMonth] = useState(
    new Date().getMonth().toString()
  );
  const [selectedYear, setSelectedYear] = useState(
    new Date().getFullYear().toString()
  );
  const targetDate = new Date(
    parseInt(selectedYear),
    parseInt(selectedMonth),
    1
  );

  const { data: currentEmployee, error: employeeError, isLoading: employeeLoading } = useQuery<EmployeeSchedule | null>({
    queryKey: ["current-employee-schedule", user?.id],
    queryFn: async () => {
      const empData = await hrmsApi.get<{ data: { id: string; first_name?: string | null; last_name?: string | null; working_hours_start?: string | null; working_hours_end?: string | null; working_days?: number[] | null } }>(`/api/employees/me`);
      return empData.data ? empData.data as EmployeeSchedule : null;
    },
    enabled: !!user?.id,
    retry: 2,
  });

  const { data: todayRecord, isLoading: todayLoading } =
    useTodayAttendance(currentEmployee?.id);
  const { data: livePunch } = useTodayLivePunch(currentEmployee?.id);

  // If the attendance engine hasn't processed today yet (no todayRecord),
  // fall back to raw biometric punch data from biometric_attendance_log.
  const displayClockIn  = todayRecord?.clock_in  ?? todayRecord?.clock_in_time  ?? livePunch?.first_punch_in  ?? null;
  const displayClockOut = todayRecord?.clock_out ?? todayRecord?.clock_out_time ?? livePunch?.last_punch_out  ?? null;
  const displayHours    = todayRecord?.total_hours != null
    ? safeNumber(todayRecord.total_hours)
    : livePunch?.raw_minutes != null && livePunch.raw_minutes > 0
      ? Math.round(livePunch.raw_minutes / 60 * 100) / 100
      : null;
  const isLiveOnly = !todayRecord && !!livePunch?.first_punch_in;

  const { data: attendanceRecords, isLoading: recordsLoading, error: recordsError } = useAttendance(
    targetDate,
    currentEmployee?.id
  );

  const { data: summaryData, isLoading: reportLoading, error: summaryError } =
    useMyAttendanceSummary(currentEmployee?.id, targetDate);

  const { data: activeBreak } = useActiveBreak(todayRecord?.id);
  const { data: todayBreaks } = useBreaksForRecord(todayRecord?.id);

  const attendanceList = (attendanceRecords || []) as AttendanceRecord[];
  const historySorting = useSorting<AttendanceRecord>(attendanceList);
  const historyPagination = usePagination(historySorting.sortedItems, {
    initialPageSize: 10,
  });

  const currentTime = new Date();
  const breakSummary = livePunch?.break_summary ?? null;
  const totalBreakMinutes = safeNumber(
    breakSummary?.total_break_minutes ?? todayRecord?.total_break_minutes ?? 0
  );
  const totalBreakCount = safeNumber(
    breakSummary?.total_break_count ?? todayRecord?.total_break_count ?? 0
  );
  const miniBreakCount = safeNumber(
    breakSummary?.mini_break_count ?? todayRecord?.mini_break_count ?? 0
  );
  const longBreakCount = safeNumber(
    breakSummary?.long_break_count ?? todayRecord?.long_break_count ?? 0
  );
  const scheduledShiftHours = getExpectedHours(
    currentEmployee?.working_hours_start || "09:00:00",
    currentEmployee?.working_hours_end || "18:00:00"
  );
  const hasMetShiftHours =
    displayHours != null && displayHours + 0.01 >= scheduledShiftHours;
  const isShiftCompleted = !!displayClockOut && hasMetShiftHours;
  const isShiftClosedEarly = !!displayClockOut && !hasMetShiftHours;
  const todayBreakStatus = isShiftCompleted
    ? "Shift Completed"
    : isShiftClosedEarly
      ? "Shift Closed Early"
      : breakSummary?.active_break
        ? "On Break"
        : todayRecord?.break_status ??
          breakSummary?.final_status ??
          (displayClockIn ? "On Duty" : "No Punch");

  const formatTimeDisplay = (time: string | null): string => {
    if (!time) return "--:--";

    const [hours, minutes] = time.split(":").map(Number);
    const ampm = hours >= 12 ? "PM" : "AM";
    const hour12 = hours % 12 || 12;

    return `${hour12}:${minutes.toString().padStart(2, "0")} ${ampm}`;
  };

  const isWorkingDay = (days: number[] | null): boolean => {
    const today = new Date().getDay();
    return (days || [1, 2, 3, 4, 5]).includes(today);
  };

  const calculateOvertime = (record: {
    clock_in: string | null;
    clock_out: string | null;
    total_hours: number | null;
    employee?: {
      working_hours_start: string | null;
      working_hours_end: string | null;
    };
  }): number => {
    if (!record.clock_out || !record.total_hours) return 0;

    const workStart =
      record.employee?.working_hours_start ||
      currentEmployee?.working_hours_start ||
      "09:00:00";
    const workEnd =
      record.employee?.working_hours_end ||
      currentEmployee?.working_hours_end ||
      "18:00:00";

    const expectedHours = getExpectedHours(workStart, workEnd);
    const overtime = record.total_hours - expectedHours;

    return overtime > 0 ? overtime : 0;
  };

  // useMemo: only recalculates when attendanceRecords or currentEmployee changes
  const monthlyOvertime = useMemo((): number => {
    if (!attendanceRecords) return 0;
    return attendanceRecords.reduce(
      (total, record) => total + calculateOvertime(record),
      0
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attendanceRecords, currentEmployee]);

  const calculateLateArrival = (
    clockInTime: string | null,
    employeeSchedule?: {
      working_hours_start: string | null;
      working_hours_end: string | null;
    }
  ): number => {
    if (!clockInTime) return 0;

    const workStart =
      employeeSchedule?.working_hours_start ||
      currentEmployee?.working_hours_start ||
      "09:00:00";

    const [startHour, startMin] = workStart.split(":").map(Number);
    // Parse clock-in in IST: tag naive "YYYY-MM-DD HH:mm:ss" with +05:30 so
    // the Intl formatter can extract IST hours/minutes regardless of browser timezone.
    const istStr = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(clockInTime)
      ? clockInTime.replace(' ', 'T') + '+05:30'
      : clockInTime;
    const clockInDate = new Date(istStr);
    const istTime = clockInDate.toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });
    const [hStr, mStr] = istTime.split(':');
    const clockInHour = parseInt(hStr ?? '0', 10);
    const clockInMinute = parseInt(mStr ?? '0', 10);

    const scheduledMinutes = startHour * 60 + startMin;
    const actualMinutes = clockInHour * 60 + clockInMinute;
    const lateMinutes = actualMinutes - scheduledMinutes;

    return lateMinutes > 1 ? lateMinutes : 0;
  };

  const formatLateDuration = (minutes: number): string => {
    if (minutes < 60) return `${minutes} min`;

    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;

    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  };

  const selectedMonthLabel = MONTHS[parseInt(selectedMonth)].label;

  const renderPaginationControls = () => {
    if (historyPagination.totalPages <= 1) return null;

    const pages: (number | "ellipsis")[] = [];
    const { currentPage, totalPages } = historyPagination;

    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);

      if (currentPage > 3) pages.push("ellipsis");

      for (
        let i = Math.max(2, currentPage - 1);
        i <= Math.min(totalPages - 1, currentPage + 1);
        i++
      ) {
        pages.push(i);
      }

      if (currentPage < totalPages - 2) pages.push("ellipsis");

      pages.push(totalPages);
    }

    return (
      <div className="mt-4 flex flex-col items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row">
        <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-slate-500 sm:justify-start">
          <span>Show</span>

          <Select
            value={historyPagination.pageSize.toString()}
            onValueChange={(value) =>
              historyPagination.setPageSize(Number(value))
            }
          >
            <SelectTrigger className="h-8 w-[74px] rounded-lg bg-white text-xs">
              <SelectValue />
            </SelectTrigger>

            <SelectContent>
              {[5, 10, 20, 50].map((size) => (
                <SelectItem key={size} value={size.toString()}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <span>of {historyPagination.totalItems} records</span>
        </div>

        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                onClick={() =>
                  historyPagination.canGoPrevious &&
                  historyPagination.goToPreviousPage()
                }
                className={
                  !historyPagination.canGoPrevious
                    ? "pointer-events-none opacity-50"
                    : "cursor-pointer"
                }
              />
            </PaginationItem>

            {pages.map((page, index) =>
              page === "ellipsis" ? (
                <PaginationItem key={`ellipsis-${index}`}>
                  <PaginationEllipsis />
                </PaginationItem>
              ) : (
                <PaginationItem key={page}>
                  <PaginationLink
                    onClick={() => historyPagination.setPage(page)}
                    isActive={historyPagination.currentPage === page}
                    className="cursor-pointer"
                  >
                    {page}
                  </PaginationLink>
                </PaginationItem>
              )
            )}

            <PaginationItem>
              <PaginationNext
                onClick={() =>
                  historyPagination.canGoNext && historyPagination.goToNextPage()
                }
                className={
                  !historyPagination.canGoNext
                    ? "pointer-events-none opacity-50"
                    : "cursor-pointer"
                }
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </div>
    );
  };

  return (
    <DashboardLayout>
      <TooltipProvider>
        <div className="space-y-5">
          {/* Hero Header */}
          <section className="relative overflow-hidden rounded-3xl bg-[#073f78] text-white shadow-lg">
            <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-[#1B6AB5]/20 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-10 left-1/4 h-48 w-48 rounded-full bg-[#3BAD49]/10 blur-3xl" />
            <div className="relative grid gap-0 lg:grid-cols-[1fr_auto]">
              <div className="p-6 sm:p-7">
                <p className="text-[11px] font-black uppercase tracking-[0.2em] text-green-200">
                  Attendance Management
                </p>

                <h1 className="mt-2 text-2xl font-black tracking-tight text-white">
                  Attendance
                </h1>

                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
                  View work mode, breaks, monthly summary and attendance history.
                </p>

                <div className="mt-4 flex flex-wrap gap-3">
                  <div className="rounded-xl border border-white/10 bg-white/[0.08] px-4 py-2">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Month</p>
                    <p className="text-sm font-bold text-white">{selectedMonthLabel} {selectedYear}</p>
                  </div>
                  {summaryData && (
                    <div className="rounded-xl border border-white/10 bg-white/[0.08] px-4 py-2">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Present Days</p>
                      <p className="text-sm font-bold text-[#3BAD49]">{summaryData.presentDays ?? 0}</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="grid gap-3 border-t border-white/10 p-5 sm:grid-cols-2 lg:min-w-[360px] lg:border-l lg:border-t-0 lg:bg-white/5">
                <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                  <SelectTrigger className="h-10 rounded-xl border-white/20 bg-white/10 text-xs text-white shadow-sm">
                    <SelectValue />
                  </SelectTrigger>

                  <SelectContent>
                    {MONTHS.map((month) => (
                      <SelectItem key={month.value} value={month.value}>
                        {month.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={selectedYear} onValueChange={setSelectedYear}>
                  <SelectTrigger className="h-10 rounded-xl border-white/20 bg-white/10 text-xs text-white shadow-sm">
                    <SelectValue />
                  </SelectTrigger>

                  <SelectContent>
                    {Array.from(
                      { length: 5 },
                      (_, i) => new Date().getFullYear() - i
                    ).map((year) => (
                      <SelectItem key={year} value={year.toString()}>
                        {year}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </section>

          {/* Today + Schedule */}
          <section className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
            <div className="rounded-2xl border border-slate-200 bg-white/80 backdrop-blur-sm p-5 shadow-sm">
              <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-sm font-semibold tracking-tight text-slate-950 flex items-center gap-2">
                    Today&apos;s Attendance
                    {isLiveOnly && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        Live
                      </span>
                    )}
                  </h2>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    {format(currentTime, "EEEE, MMMM d, yyyy")}
                  </p>
                </div>

                {todayRecord?.work_mode && (
                  <Badge className="w-fit bg-slate-100 text-slate-700 hover:bg-slate-100">
                    {isOfficeMode(todayRecord.work_mode) ? (
                      <>
                        <Building2 className="mr-1 h-3.5 w-3.5" />
                        Office
                      </>
                    ) : (
                      <>
                        <Home className="mr-1 h-3.5 w-3.5" />
                        Home
                      </>
                    )}
                  </Badge>
                )}
              </div>

              {todayLoading ? (
                <div className="grid gap-4 sm:grid-cols-3">
                  {[1, 2, 3].map((item) => (
                    <Skeleton key={item} className="h-24 rounded-2xl" />
                  ))}
                </div>
              ) : (
                <>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                        <LogIn className="h-4 w-4 text-emerald-700" />
                        Clock In
                      </div>

                      <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
                        {safeFormatDate(displayClockIn, "hh:mm a", "--:--")}
                      </p>

                      {isAdminOrHR &&
                        displayClockIn &&
                        calculateLateArrival(displayClockIn) > 0 && (
                          <p className="mt-2 text-xs font-semibold text-amber-700">
                            {formatLateDuration(
                              calculateLateArrival(displayClockIn)
                            )}{" "}
                            late
                          </p>
                        )}
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                        <LogOut className="h-4 w-4 text-sky-700" />
                        Clock Out
                      </div>

                      <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
                        {safeFormatDate(displayClockOut, "hh:mm a", "--:--")}
                      </p>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                        <Timer className="h-4 w-4 text-indigo-700" />
                        Total Hours
                      </div>

                      <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
                        {displayHours != null
                          ? `${displayHours.toFixed(2)} hrs`
                          : "--"}
                      </p>

                      {totalBreakCount > 0 && (
                        <p className="mt-2 text-xs text-slate-500">
                          {totalBreakCount} break
                          {totalBreakCount > 1 ? "s" : ""} ·{" "}
                          {formatBreakMinutes(totalBreakMinutes)}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl border border-[#d9e9f9] bg-gradient-to-r from-[#f4f9ff] via-white to-[#eef8f1] p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[#1B6AB5]">
                            Break Summary
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            Live shift totals from biometric and break desk.
                          </p>
                        </div>

                        <Badge className="w-fit border border-[#c9def3] bg-white text-[#073f78] hover:bg-white">
                          {todayBreakStatus}
                        </Badge>
                      </div>

                      <div className="mt-3 grid gap-2 sm:grid-cols-4 xl:grid-cols-5">
                        {[
                          { label: "Total Breaks", value: String(totalBreakCount), tone: "text-[#073f78] bg-white" },
                          { label: "Mini", value: String(miniBreakCount), tone: "text-[#1B6AB5] bg-[#eef6ff]" },
                          { label: "Long", value: String(longBreakCount), tone: "text-[#3BAD49] bg-[#eef9f0]" },
                          { label: "Break Time", value: formatBreakMinutes(totalBreakMinutes), tone: "text-[#d97706] bg-[#fff6e8]" },
                          {
                            label: "Live State",
                            value: breakSummary?.active_break
                              ? "On Break"
                              : isShiftCompleted
                                ? "Completed"
                                : isShiftClosedEarly
                                  ? "Closed Early"
                                  : displayClockIn
                                    ? "On Duty"
                                    : "Waiting",
                            tone: "text-slate-700 bg-slate-100"
                          },
                        ].map((item) => (
                          <div key={item.label} className={`rounded-xl border border-white/70 px-3 py-3 ${item.tone}`}>
                            <p className="text-[10px] font-bold uppercase tracking-[0.14em] opacity-70">
                              {item.label}
                            </p>
                            <p className="mt-1 text-base font-black tracking-tight">
                              {item.value}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>

                  {displayClockOut && (
                    <div
                      className={`mt-5 flex items-center gap-2 rounded-2xl px-4 py-3 text-xs font-semibold ${
                        isShiftCompleted
                          ? "border border-emerald-100 bg-emerald-50 text-emerald-700"
                          : "border border-amber-100 bg-amber-50 text-amber-700"
                      }`}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      {isShiftCompleted
                        ? "Completed for today"
                        : `Clocked out before completing ${scheduledShiftHours.toFixed(0)} hrs`}
                    </div>
                  )}

                  {(todayRecord?.clock_in_location_name ||
                    todayRecord?.clock_out_location_name) && (
                    <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4">
                      <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-slate-950">
                        <MapPin className="h-4 w-4 text-sky-700" />
                        Location Log
                      </div>

                      <div className="space-y-2 text-xs leading-5 text-slate-500">
                        {todayRecord?.clock_in_location_name && (
                          <p>
                            <span className="font-semibold text-slate-700">
                              Clock In:
                            </span>{" "}
                            {todayRecord.clock_in_location_name}
                          </p>
                        )}

                        {todayRecord?.clock_out_location_name && (
                          <p>
                            <span className="font-semibold text-slate-700">
                              Clock Out:
                            </span>{" "}
                            {todayRecord.clock_out_location_name}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {currentEmployee && (
              <div className="rounded-2xl border border-slate-200 bg-white/80 backdrop-blur-sm p-5 shadow-sm">
                <div className="mb-5">
                  <h2 className="text-sm font-semibold tracking-tight text-slate-950">
                    My Working Schedule
                  </h2>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    Your configured working hours and days.
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                      Start Time
                    </p>
                    <p className="mt-2 text-xl font-semibold text-slate-950">
                      {formatTimeDisplay(currentEmployee.working_hours_start)}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                      End Time
                    </p>
                    <p className="mt-2 text-xl font-semibold text-slate-950">
                      {formatTimeDisplay(currentEmployee.working_hours_end)}
                    </p>
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                    Working Days
                  </p>

                  <div className="grid grid-cols-7 gap-2">
                    {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
                      (day, index) => {
                        const workingDays =
                          currentEmployee.working_days || [1, 2, 3, 4, 5];
                        const isActive = workingDays.includes(index);
                        const isToday = new Date().getDay() === index;

                        return (
                          <div
                            key={day}
                            className={`rounded-xl px-2 py-2 text-center text-[11px] font-semibold ${
                              isActive
                                ? "bg-slate-950 text-white"
                                : "bg-white text-slate-400"
                            } ${isToday ? "ring-2 ring-sky-300" : ""}`}
                          >
                            {day}
                          </div>
                        );
                      }
                    )}
                  </div>

                  <div
                    className={`mt-4 flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold ${
                      isWorkingDay(currentEmployee.working_days)
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {isWorkingDay(currentEmployee.working_days)
                      ? "Working Day"
                      : "Day Off"}
                  </div>
                </div>

                <Button
                  variant="outline"
                  className="mt-4 h-10 w-full rounded-xl border-slate-200 bg-white text-xs font-semibold"
                  asChild
                >
                  <Link to="/settings">Edit Schedule</Link>
                </Button>
              </div>
            )}
          </section>

          {/* Calendar View */}
            {currentEmployee?.id && (
              <section className="space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="text-base font-semibold tracking-tight text-slate-950">
                      Attendance Calendar
                    </h2>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      View your monthly attendance with color-coded status. Click any date for details.
                    </p>
                  </div>

                  <Button asChild variant="outline" className="h-9 rounded-xl border-slate-200 text-xs font-semibold">
                    <Link to={`/attendance/biometric-logs/${currentEmployee.id}`}>
                      Open My Punch Logs
                    </Link>
                  </Button>
                </div>

                <AttendanceCalendar
                  employeeId={currentEmployee.id}
                initialMonth={Number(selectedMonth)}
                initialYear={Number(selectedYear)}
              />
            </section>
          )}

          {/* Monthly Summary */}
          <section className="space-y-4">
            <div>
              <h2 className="text-base font-semibold tracking-tight text-slate-950">
                My Monthly Summary
              </h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Attendance summary for {selectedMonthLabel} {selectedYear}.
              </p>
              <div className="mt-2 inline-flex items-center rounded-full border border-[#c4dcf5] bg-[#e8f2fc] px-3 py-1 text-[11px] font-semibold text-[#1B6AB5]">
                Source: Direct COSEC
              </div>
            </div>

            {reportLoading ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
                {[1, 2, 3, 4, 5].map((item) => (
                  <Skeleton key={item} className="h-32 rounded-2xl" />
                ))}
              </div>
            ) : summaryError ? (
              <Card className="border-dashed border-red-200 bg-red-50/70 shadow-none">
                <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-red-500 shadow-sm ring-1 ring-red-200">
                    <AlertTriangle className="h-7 w-7" />
                  </div>
                  <h3 className="text-base font-semibold text-red-950">
                    Could Not Load Summary
                  </h3>
                  <p className="mt-2 max-w-md text-sm leading-6 text-red-600">
                    Attendance summary could not be loaded. Please try refreshing.
                  </p>
                </CardContent>
              </Card>
            ) : !summaryData ? (
              <Card className="border-dashed border-slate-200 bg-slate-50/70 shadow-none">
                <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-slate-500 shadow-sm ring-1 ring-slate-200">
                    <Calendar className="h-7 w-7" />
                  </div>

                  <h3 className="text-base font-semibold text-slate-950">
                    No Attendance Records
                  </h3>

                  <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                    No attendance records were found for this month.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <>
                <div className={`grid gap-4 sm:grid-cols-2 ${isAdminOrHR ? 'xl:grid-cols-3' : 'xl:grid-cols-5'}`}>
                  <AttendanceMetricCard
                    label="Attendance Credit"
                    value={safeNumber(summaryData.presentDays) + safeNumber(summaryData.halfDays) * 0.5}
                    description="Present days plus half-day credit."
                    icon={<CheckCircle2 className="h-5 w-5" />}
                    tone="emerald"
                  />

                  <AttendanceMetricCard
                    label="From Office"
                    value={summaryData.wfoDays}
                    description="Work from office days."
                    icon={<Briefcase className="h-5 w-5" />}
                    tone="sky"
                  />

                  <AttendanceMetricCard
                    label="Total Hours"
                    value={formatHours(summaryData.totalHours)}
                    description="Total productive hours."
                    icon={<Timer className="h-5 w-5" />}
                    tone="indigo"
                  />

                  <AttendanceMetricCard
                    label="Avg Hours / Day"
                    value={`${
                      safeNumber(summaryData.totalWorkingDays) > 0
                        ? (safeNumber(summaryData.totalHours) / safeNumber(summaryData.totalWorkingDays)).toFixed(1)
                        : "0"
                    }h`}
                    description="Average daily hours."
                    icon={<Clock className="h-5 w-5" />}
                    tone="slate"
                  />

                  <AttendanceMetricCard
                    label="LWP Days"
                    value={safeNumber(summaryData.totalLwp) % 1 === 0 ? String(safeNumber(summaryData.totalLwp)) : safeNumber(summaryData.totalLwp).toFixed(1)}
                    description="Leave without pay days."
                    icon={<AlertTriangle className="h-5 w-5" />}
                    tone="amber"
                  />

                  {isAdminOrHR && (
                    <AttendanceMetricCard
                      label="Late Arrivals"
                      value={summaryData.lateMarks}
                      description="Late arrival count."
                      icon={<AlertTriangle className="h-5 w-5" />}
                      tone="amber"
                    />
                  )}
                </div>

                {/* AI Attendance Brief */}
                <AIInsightPanel
                  contextType="attendance_pattern"
                  role="employee"
                  title="Attendance AI Brief"
                  enabled={!reportLoading}
                  data={{
                    present_days: summaryData.presentDays,
                    wfo_days: summaryData.wfoDays,
                    total_hours: safeNumber(summaryData.totalHours),
                    total_working_days: safeNumber(summaryData.totalWorkingDays),
                    lwp_days: safeNumber(summaryData.totalLwp),
                    late_marks: safeNumber(summaryData.lateMarks),
                  }}
                />
              </>
            )}
          </section>

          {/* History */}
          <section className="rounded-2xl border border-slate-200 bg-white/80 backdrop-blur-sm p-4 shadow-sm">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold tracking-tight text-slate-950">
                  My Attendance History
                </h2>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Your attendance records for {selectedMonthLabel}.
                </p>
              </div>

              {attendanceRecords && attendanceRecords.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  {isAdminOrHR && (summaryData?.lateMarks ?? 0) > 0 && (
                    <Badge className="bg-amber-50 text-amber-700 hover:bg-amber-50">
                      Late Arrivals: {summaryData?.lateMarks}
                    </Badge>
                  )}

                  {isAdminOrHR && (
                    <Badge className="bg-sky-50 text-sky-700 hover:bg-sky-50">
                      Overtime: {monthlyOvertime.toFixed(2)} hrs
                    </Badge>
                  )}
                </div>
              )}
            </div>

            {employeeError ? (
              <div className="rounded-xl border-2 border-red-200 bg-red-50 p-8 text-center">
                <AlertTriangle className="mx-auto mb-3 h-12 w-12 text-red-500" />
                <h3 className="mb-2 text-lg font-semibold text-red-900">
                  Failed to Load Employee Information
                </h3>
                <p className="mb-4 text-sm text-red-700">
                  We could not load your employee profile. Retry, or contact HR if the issue continues.
                </p>
                <Button
                  onClick={() => window.location.reload()}
                  variant="outline"
                  className="border-red-300 text-red-700 hover:bg-red-100"
                >
                  <RefreshCcw className="mr-2 h-4 w-4" />
                  Retry
                </Button>
              </div>
            ) : !currentEmployee ? (
              <div className="rounded-xl border-2 border-amber-200 bg-amber-50 p-8 text-center">
                <AlertTriangle className="mx-auto mb-3 h-12 w-12 text-amber-500" />
                <h3 className="mb-2 text-lg font-semibold text-amber-900">
                  Employee Record Not Found
                </h3>
                <p className="mb-4 text-sm text-amber-700">
                  Your user account is not linked to an employee record. Please contact HR to link your account.
                </p>
              </div>
            ) : recordsError ? (
              <div className="rounded-xl border-2 border-red-200 bg-red-50 p-8 text-center">
                <AlertTriangle className="mx-auto mb-3 h-12 w-12 text-red-500" />
                <h3 className="mb-2 text-lg font-semibold text-red-900">
                  Failed to Load Attendance History
                </h3>
                <p className="mb-4 text-sm text-red-700">
                  We could not load attendance history for this month. Please retry.
                </p>
                <Button
                  onClick={() => window.location.reload()}
                  variant="outline"
                  className="border-red-300 text-red-700 hover:bg-red-100"
                >
                  <RefreshCcw className="mr-2 h-4 w-4" />
                  Retry
                </Button>
              </div>
            ) : recordsLoading || employeeLoading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4, 5].map((item) => (
                  <Skeleton key={item} className="h-16 rounded-xl" />
                ))}
              </div>
            ) : attendanceRecords && attendanceRecords.length > 0 ? (
              <>
                <div className="overflow-hidden rounded-xl border border-gray-200">
                  <Table className="smarthr-table">
                    <TableHeader>
                      <TableRow>
                        <SortableTableHead
                          sortKey="date"
                          currentSortKey={
                            historySorting.sortConfig.key as string | null
                          }
                          direction={historySorting.sortConfig.direction}
                          onSort={(key) =>
                            historySorting.requestSort(
                              key as keyof AttendanceRecord
                            )
                          }
                        >
                          Date
                        </SortableTableHead>

                        <TableCell className="font-semibold text-slate-500">
                          Employee
                        </TableCell>

                        <TableCell className="font-semibold text-slate-500">
                          Clock In
                        </TableCell>

                        <TableCell className="font-semibold text-slate-500">
                          Clock Out
                        </TableCell>

                        <SortableTableHead
                          sortKey="total_hours"
                          currentSortKey={
                            historySorting.sortConfig.key as string | null
                          }
                          direction={historySorting.sortConfig.direction}
                          onSort={(key) =>
                            historySorting.requestSort(
                              key as keyof AttendanceRecord
                            )
                          }
                        >
                          Total Hours
                        </SortableTableHead>

                        {isAdminOrHR && (
                          <TableCell className="font-semibold text-slate-500">
                            Overtime
                          </TableCell>
                        )}

                        <TableCell className="font-semibold text-slate-500">
                          Mode
                        </TableCell>

                        <TableCell className="font-semibold text-slate-500">
                          Location
                        </TableCell>

                        <SortableTableHead
                          sortKey="status"
                          currentSortKey={
                            historySorting.sortConfig.key as string | null
                          }
                          direction={historySorting.sortConfig.direction}
                          onSort={(key) =>
                            historySorting.requestSort(
                              key as keyof AttendanceRecord
                            )
                          }
                        >
                          Status
                        </SortableTableHead>
                      </TableRow>
                    </TableHeader>

                    <TableBody>
                      {historyPagination.paginatedItems.map((record) => {
                        const overtime = calculateOvertime(record);
                        const lateMinutes = calculateLateArrival(
                          record.clock_in,
                          record.employee
                        );

                        return (
                          <TableRow key={record.id} className="hover:bg-slate-50/80 transition-colors duration-150 cursor-pointer">
                            <TableCell className="font-medium text-slate-900">
                              {safeFormatDate(record.date, "MMM d, yyyy")}
                            </TableCell>

                            <TableCell>
                              <div>
                                <p className="font-medium text-slate-900">
                                  {record.employee
                                    ? `${record.employee.first_name} ${record.employee.last_name}`
                                    : "-"}
                                </p>

                                {record.employee?.employee_code && (
                                  <p className="mt-0.5 text-xs text-slate-500">
                                    {record.employee.employee_code}
                                  </p>
                                )}
                              </div>
                            </TableCell>

                            <TableCell>
                              <div>
                                <p>{safeFormatDate(record.clock_in, "hh:mm a")}</p>

                                {isAdminOrHR && lateMinutes > 0 && (
                                  <p className="mt-1 text-xs font-semibold text-amber-700">
                                    {formatLateDuration(lateMinutes)} late
                                  </p>
                                )}
                              </div>
                            </TableCell>

                            <TableCell>
                              {safeFormatDate(record.clock_out, "hh:mm a")}
                            </TableCell>

                            <TableCell>
                              {record.total_hours
                                ? `${safeNumber(record.total_hours).toFixed(2)} hrs`
                                : "-"}
                            </TableCell>

                            {isAdminOrHR && (
                              <TableCell>
                                {overtime > 0 ? (
                                  <span className="font-semibold text-sky-700">
                                    +{overtime.toFixed(2)} hrs
                                  </span>
                                ) : (
                                  "-"
                                )}
                              </TableCell>
                            )}

                            <TableCell>
                              {record.work_mode ? (
                                <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100">
                                  {isOfficeMode(record.work_mode) ? (
                                    <>
                                      <Building2 className="mr-1 h-3.5 w-3.5" />
                                      Office
                                    </>
                                  ) : (
                                    <>
                                      <Home className="mr-1 h-3.5 w-3.5" />
                                      Home
                                    </>
                                  )}
                                </Badge>
                              ) : (
                                "-"
                              )}
                            </TableCell>

                            <TableCell>
                              {record.clock_in_location_name ||
                              record.clock_out_location_name ? (
                                <div className="space-y-1 text-xs text-slate-500">
                                  {record.clock_in_location_name && (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <p className="max-w-[180px] truncate">
                                          <span className="font-semibold text-slate-700">
                                            In:
                                          </span>{" "}
                                          {record.clock_in_location_name}
                                        </p>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        {record.clock_in_location_name}
                                      </TooltipContent>
                                    </Tooltip>
                                  )}

                                  {record.clock_out_location_name && (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <p className="max-w-[180px] truncate">
                                          <span className="font-semibold text-slate-700">
                                            Out:
                                          </span>{" "}
                                          {record.clock_out_location_name}
                                        </p>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        {record.clock_out_location_name}
                                      </TooltipContent>
                                    </Tooltip>
                                  )}
                                </div>
                              ) : (
                                "-"
                              )}
                            </TableCell>

                            <TableCell>{getStatusBadge(record.status)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                {renderPaginationControls()}
              </>
            ) : (
              <Card className="border-dashed border-slate-200 bg-slate-50/70 shadow-none">
                <CardContent className="flex flex-col items-center justify-center py-14 text-center">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-slate-500 shadow-sm ring-1 ring-slate-200">
                    <Calendar className="h-7 w-7" />
                  </div>

                  <h3 className="text-base font-semibold text-slate-950">
                    No Attendance Records Found
                  </h3>

                  <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                    Attendance records for this month will appear here.
                  </p>
                </CardContent>
              </Card>
            )}
          </section>

        </div>
      </TooltipProvider>
    </DashboardLayout>
  );
};

export default Attendance;
