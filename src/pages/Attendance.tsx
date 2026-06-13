import { useState, useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Briefcase,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  Coffee,
  Home,
  Loader2,
  LogIn,
  LogOut,
  MapPin,
  Pause,
  Play,
  RefreshCcw,
  Timer,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useAuth } from "@/contexts/AuthContext";
import { useIsAdminOrHR } from "@/hooks/useUserRole";
import {
  AttendanceRecord,
  LocationData,
  WorkMode,
  useAttendance,
  useAttendanceReport,
  useClockIn,
  useClockOut,
  useTodayAttendance,
} from "@/hooks/useAttendance";
import {
  calculateTotalBreakHours,
  useActiveBreak,
  useBreaksForRecord,
  usePause,
  useResume,
} from "@/hooks/useAttendanceBreaks";
import {
  getDistanceMeters,
  useOfficeLocation,
} from "@/components/settings/OfficeLocationSettings";
import { getExpectedHours, getShiftEndTime } from "@/lib/shiftUtils";
import { hrmsApi } from "@/lib/hrmsApi";
import { usePagination } from "@/hooks/usePagination";
import { useSorting } from "@/hooks/useSorting";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
    card: "border-indigo-100 bg-gradient-to-br from-white via-white to-indigo-50",
    icon: "bg-indigo-50 text-indigo-700 ring-indigo-100",
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

  if (normalized === "half-day") {
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
  const [workMode, setWorkMode] = useState<WorkMode>("wfo");

  const [showEarlyClockOutWarning, setShowEarlyClockOutWarning] =
    useState(false);
  const [earlyClockOutReasons, setEarlyClockOutReasons] = useState<{
    beforeEndTime: boolean;
    insufficientHours: boolean;
  }>({
    beforeEndTime: false,
    insufficientHours: false,
  });

  const [showLateClockOutDialog, setShowLateClockOutDialog] = useState(false);
  const [lateClockOutMode, setLateClockOutMode] = useState<
    "overtime" | "missed" | null
  >(null);
  const [missedClockOutTime, setMissedClockOutTime] = useState("");

  const targetDate = new Date(
    parseInt(selectedYear),
    parseInt(selectedMonth),
    1
  );

  const { data: currentEmployee, error: employeeError, isLoading: employeeLoading } = useQuery<EmployeeSchedule | null>({
    queryKey: ["current-employee-schedule", user?.id],
    queryFn: async () => {
      console.log('[Attendance] Fetching employee for user:', user?.id);
      try {
        const empData = await hrmsApi.get<{ data: { id: string; first_name?: string | null; last_name?: string | null; working_hours_start?: string | null; working_hours_end?: string | null; working_days?: number[] | null } }>(`/api/employees/me`);
        console.log('[Attendance] Employee data:', empData);
        if (!empData.data) {
          console.error('[Attendance] No employee data returned');
          return null;
        }
        return empData.data as EmployeeSchedule;
      } catch (error) {
        console.error('[Attendance] Failed to fetch employee:', error);
        throw error;
      }
    },
    enabled: !!user?.id,
    retry: 2,
  });

  const { data: todayRecord, isLoading: todayLoading } =
    useTodayAttendance(currentEmployee?.id);
  const { data: attendanceRecords, isLoading: recordsLoading, error: recordsError } = useAttendance(
    targetDate,
    currentEmployee?.id
  );

  // Debug logging
  useEffect(() => {
    console.log("=== Attendance Debug ===", {
      user: { id: user?.id, email: user?.email },
      employee: {
        loading: employeeLoading,
        error: employeeError?.message,
        id: currentEmployee?.id,
        data: currentEmployee,
      },
      records: {
        loading: recordsLoading,
        error: recordsError?.message,
        count: attendanceRecords?.length || 0,
        data: attendanceRecords,
      },
      targetDate: targetDate.toISOString(),
    });

    // Show user-friendly errors
    if (employeeError) {
      console.error('[Attendance] Employee Error:', employeeError);
      toast.error('Failed to load employee information. Please refresh the page.');
    }
    if (recordsError) {
      console.error('[Attendance] Records Error:', recordsError);
    }
  }, [user, employeeLoading, employeeError, currentEmployee, recordsLoading, recordsError, attendanceRecords, targetDate]);
  const { data: reportData, isLoading: reportLoading } =
    useAttendanceReport(targetDate);

  const { data: activeBreak } = useActiveBreak(todayRecord?.id);
  const { data: todayBreaks } = useBreaksForRecord(todayRecord?.id);
  const { data: officeLocation } = useOfficeLocation();

  const clockIn = useClockIn();
  const clockOut = useClockOut();
  const pauseMutation = usePause();
  const resumeMutation = useResume();

  const attendanceList = (attendanceRecords || []) as AttendanceRecord[];
  const historySorting = useSorting<AttendanceRecord>(attendanceList);
  const historyPagination = usePagination(historySorting.sortedItems, {
    initialPageSize: 10,
  });

  const currentTime = new Date();
  const isPaused = !!activeBreak;
  const isClockedIn = !!todayRecord?.clock_in && !todayRecord?.clock_out;
  const totalBreakHours = todayBreaks ? calculateTotalBreakHours(todayBreaks) : 0;

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

  const calculateMonthlyOvertime = (): number => {
    if (!attendanceRecords) return 0;

    return attendanceRecords.reduce(
      (total, record) => total + calculateOvertime(record),
      0
    );
  };

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
    const clockInDate = new Date(clockInTime);
    const clockInHour = clockInDate.getHours();
    const clockInMinute = clockInDate.getMinutes();

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

  const countLateArrivals = (): number => {
    if (!attendanceRecords) return 0;

    return attendanceRecords.filter(
      (record) => calculateLateArrival(record.clock_in, record.employee) > 0
    ).length;
  };

  const getCurrentLocation = (): Promise<LocationData | undefined> => {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        toast.error("Geolocation is not supported by your browser");
        resolve(undefined);
        return;
      }

      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const { latitude, longitude } = position.coords;

          let locationName: string | undefined;

          try {
            const response = await fetch(
              `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`
            );
            const data = await response.json();

            if (data.address) {
              const addr = data.address;
              const parts: string[] = [];

              if (addr.road) parts.push(addr.road);
              else if (addr.neighbourhood) parts.push(addr.neighbourhood);
              else if (addr.suburb) parts.push(addr.suburb);

              if (addr.suburb && !parts.includes(addr.suburb)) {
                parts.push(addr.suburb);
              } else if (
                addr.neighbourhood &&
                !parts.includes(addr.neighbourhood)
              ) {
                parts.push(addr.neighbourhood);
              }

              const city =
                addr.city ||
                addr.town ||
                addr.village ||
                addr.municipality ||
                addr.county;

              if (city) parts.push(city);
              if (addr.state && addr.state !== city) parts.push(addr.state);

              locationName = parts.slice(0, 4).join(", ");
            } else if (data.display_name) {
              const parts = data.display_name.split(", ");
              locationName = parts.slice(0, 4).join(", ");
            }
          } catch (error) {
            console.error("Failed to get location name:", error);
          }

          resolve({ latitude, longitude, locationName });
        },
        (error) => {
          console.error("Geolocation error:", error);

          switch (error.code) {
            case error.PERMISSION_DENIED:
              toast.error(
                "Location access is required to clock in. Please enable location permissions and try again."
              );
              break;
            case error.POSITION_UNAVAILABLE:
              toast.error(
                "Location information is unavailable. Clock-in requires location access."
              );
              break;
            case error.TIMEOUT:
              toast.error("Location request timed out. Please try again.");
              break;
            default:
              toast.error("Failed to get location. Clock-in requires location access.");
          }

          resolve(undefined);
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0,
        }
      );
    });
  };

  const handleClockIn = async (mode: WorkMode) => {
    if (!currentEmployee) {
      toast.error("Employee profile not found");
      return;
    }

    try {
      toast.info("Getting your location...");

      const location = await getCurrentLocation();

      if (mode === "wfo" && !location) {
        toast.error("Location is required to clock in from office");
        return;
      }

      let detectedMode = mode;

      if (location && officeLocation?.latitude && officeLocation?.longitude) {
        const distance = getDistanceMeters(
          location.latitude,
          location.longitude,
          officeLocation.latitude,
          officeLocation.longitude
        );
        const radius = officeLocation.radius_meters || 500;

        detectedMode = distance <= radius ? "wfo" : "wfh";

        if (mode === "wfo" && detectedMode === "wfh") {
          toast.error(
            `You are not at the office location (${Math.round(
              distance
            )}m away). Please choose Work From Home instead.`
          );
          return;
        }
      }

      await clockIn.mutateAsync({
        employeeId: currentEmployee.id,
        location,
        workMode: detectedMode,
      });

      const modeLabel =
        detectedMode === "wfh" ? "Work From Home" : "Work From Office";

      toast.success(
        location
          ? `Clocked in (${modeLabel}) with location`
          : `Clocked in (${modeLabel})`
      );
    } catch (error) {
      toast.error("Failed to clock in");
    }
  };

  const calculateCurrentHoursWorked = (): number => {
    if (!todayRecord?.clock_in) return 0;

    const clockInTime = new Date(todayRecord.clock_in);
    const now = new Date();

    return (now.getTime() - clockInTime.getTime()) / (1000 * 60 * 60);
  };

  const isBeforeEndTime = (): boolean => {
    if (
      !currentEmployee?.working_hours_end ||
      !currentEmployee?.working_hours_start ||
      !todayRecord?.clock_in
    ) {
      return false;
    }

    const clockInTime = new Date(todayRecord.clock_in);
    const endTime = getShiftEndTime(
      clockInTime,
      currentEmployee.working_hours_start,
      currentEmployee.working_hours_end
    );

    return new Date() < endTime;
  };

  const handleClockOutAttempt = () => {
    if (!todayRecord || !todayRecord.clock_in) {
      toast.error("No active clock-in found");
      return;
    }

    const hoursWorked = calculateCurrentHoursWorked();
    const workStart = currentEmployee?.working_hours_start || "09:00:00";
    const workEnd = currentEmployee?.working_hours_end || "18:00:00";
    const requiredHours = getExpectedHours(workStart, workEnd);

    const beforeEndTime = isBeforeEndTime();
    const insufficientHours = hoursWorked < requiredHours;

    if (beforeEndTime || insufficientHours) {
      setEarlyClockOutReasons({ beforeEndTime, insufficientHours });
      setShowEarlyClockOutWarning(true);
    } else {
      const isAfterEndTime = !isBeforeEndTime();

      if (isAfterEndTime && hoursWorked > requiredHours) {
        setLateClockOutMode(null);
        setMissedClockOutTime(workEnd.substring(0, 5));
        setShowLateClockOutDialog(true);
      } else {
        handleClockOut();
      }
    }
  };

  const handleLateClockOutConfirm = async () => {
    if (!todayRecord || !todayRecord.clock_in) return;

    setShowLateClockOutDialog(false);

    if (lateClockOutMode === "overtime") {
      handleClockOut();
      return;
    }

    if (lateClockOutMode === "missed" && missedClockOutTime) {
      try {
        toast.info("Getting your location...");

        const location = await getCurrentLocation();

        const [hours, minutes] = missedClockOutTime.split(":").map(Number);
        const customTime = new Date(todayRecord.clock_in);

        customTime.setHours(hours, minutes, 0, 0);

        if (customTime <= new Date(todayRecord.clock_in)) {
          customTime.setDate(customTime.getDate() + 1);
        }

        await clockOut.mutateAsync({
          recordId: todayRecord.id,
          clockIn: todayRecord.clock_in,
          location,
          customClockOut: customTime,
        });

        toast.success("Clocked out with corrected time");
      } catch (error) {
        toast.error("Failed to clock out");
      }
    }
  };

  const handleClockOut = async () => {
    if (!todayRecord || !todayRecord.clock_in) {
      toast.error("No active clock-in found");
      return;
    }

    setShowEarlyClockOutWarning(false);

    try {
      toast.info("Getting your location...");

      const location = await getCurrentLocation();

      await clockOut.mutateAsync({
        recordId: todayRecord.id,
        clockIn: todayRecord.clock_in,
        location,
      });

      toast.success(
        location ? "Clocked out with location" : "Clocked out successfully"
      );
    } catch (error) {
      toast.error("Failed to clock out");
    }
  };

  const formatHoursWorked = (hours: number): string => {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);

    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  };

  const handlePause = async () => {
    if (!todayRecord) return;

    try {
      toast.info("Getting your location...");

      const location = await getCurrentLocation();

      if (!location) return;

      await pauseMutation.mutateAsync({
        attendanceRecordId: todayRecord.id,
        location,
      });

      toast.success("Work paused — break started");
    } catch (error) {
      toast.error("Failed to pause");
    }
  };

  const handleResume = async () => {
    if (!activeBreak) return;

    try {
      toast.info("Getting your location...");

      const location = await getCurrentLocation();

      if (!location) return;

      await resumeMutation.mutateAsync({
        breakId: activeBreak.id,
        location,
      });

      toast.success("Work resumed");
    } catch (error) {
      toast.error("Failed to resume");
    }
  };

  const selectedMonthLabel = MONTHS[parseInt(selectedMonth)].label;

  const myReportData = reportData?.find(
    (employee) => employee.employeeId === currentEmployee?.id
  );

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
          {/* Header */}
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="grid gap-0 lg:grid-cols-[1fr_auto]">
              <div className="relative p-5 sm:p-6">
                <div className="absolute inset-y-0 left-0 w-1 bg-slate-950" />

                <div className="pl-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-400">
                    Attendance Management
                  </p>

                  <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
                    Attendance
                  </h1>

                  <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                    Track clock-in, work mode, breaks, monthly summary and
                    attendance history.
                  </p>
                </div>
              </div>

              <div className="grid gap-3 border-t border-slate-200 bg-slate-50 p-5 sm:grid-cols-2 lg:min-w-[360px] lg:border-l lg:border-t-0">
                <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                  <SelectTrigger className="h-10 rounded-xl bg-white text-xs shadow-sm">
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
                  <SelectTrigger className="h-10 rounded-xl bg-white text-xs shadow-sm">
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
                  <h2 className="text-sm font-semibold tracking-tight text-slate-950">
                    Today&apos;s Attendance
                  </h2>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    {format(currentTime, "EEEE, MMMM d, yyyy")}
                  </p>
                </div>

                {todayRecord?.work_mode && (
                  <Badge className="w-fit bg-slate-100 text-slate-700 hover:bg-slate-100">
                    {todayRecord.work_mode === "wfo" ? (
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
                        {todayRecord?.clock_in
                          ? format(new Date(todayRecord.clock_in), "hh:mm a")
                          : "--:--"}
                      </p>

                      {isAdminOrHR &&
                        todayRecord?.clock_in &&
                        calculateLateArrival(todayRecord.clock_in) > 0 && (
                          <p className="mt-2 text-xs font-semibold text-amber-700">
                            {formatLateDuration(
                              calculateLateArrival(todayRecord.clock_in)
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
                        {todayRecord?.clock_out
                          ? format(new Date(todayRecord.clock_out), "hh:mm a")
                          : "--:--"}
                      </p>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                        <Timer className="h-4 w-4 text-indigo-700" />
                        Total Hours
                      </div>

                      <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
                        {todayRecord?.total_hours
                          ? `${todayRecord.total_hours.toFixed(2)} hrs`
                          : "--"}
                      </p>

                      {todayBreaks && todayBreaks.length > 0 && (
                        <p className="mt-2 text-xs text-slate-500">
                          {todayBreaks.length} break
                          {todayBreaks.length > 1 ? "s" : ""} ·{" "}
                          {totalBreakHours.toFixed(1)}h total
                        </p>
                      )}
                    </div>
                  </div>

                  {!isClockedIn && !todayRecord?.clock_out && (
                    <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <p className="mb-3 text-xs font-semibold text-slate-950">
                        Select work mode
                      </p>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <Button
                          type="button"
                          variant={workMode === "wfo" ? "default" : "outline"}
                          className="h-11 rounded-xl text-xs font-semibold"
                          onClick={() => setWorkMode("wfo")}
                        >
                          <Building2 className="mr-2 h-4 w-4" />
                          Work From Office
                        </Button>

                        <Button
                          type="button"
                          variant={workMode === "wfh" ? "default" : "outline"}
                          className="h-11 rounded-xl text-xs font-semibold"
                          onClick={() => setWorkMode("wfh")}
                        >
                          <Home className="mr-2 h-4 w-4" />
                          Work From Home
                        </Button>
                      </div>

                      <Button
                        className="mt-3 h-11 w-full rounded-xl bg-slate-950 text-xs font-semibold text-white hover:bg-slate-800"
                        disabled={clockIn.isPending}
                        onClick={() => handleClockIn(workMode)}
                      >
                        {clockIn.isPending ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <LogIn className="mr-2 h-4 w-4" />
                        )}
                        Clock In
                      </Button>
                    </div>
                  )}

                  {isClockedIn && (
                    <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        {todayRecord?.work_mode && (
                          <Badge className="bg-white text-slate-700 hover:bg-white">
                            {todayRecord.work_mode === "wfo" ? (
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

                        {isPaused && (
                          <Badge className="bg-amber-50 text-amber-700 hover:bg-amber-50">
                            <Coffee className="mr-1 h-3.5 w-3.5" />
                            On Break
                          </Badge>
                        )}
                      </div>

                      {isPaused ? (
                        <Button
                          className="h-11 w-full rounded-xl bg-emerald-600 text-xs font-semibold text-white hover:bg-emerald-700"
                          disabled={resumeMutation.isPending}
                          onClick={handleResume}
                        >
                          {resumeMutation.isPending ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Play className="mr-2 h-4 w-4" />
                          )}
                          Resume Work
                        </Button>
                      ) : (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Button
                            variant="outline"
                            className="h-11 rounded-xl border-slate-200 bg-white text-xs font-semibold"
                            disabled={pauseMutation.isPending}
                            onClick={handlePause}
                          >
                            {pauseMutation.isPending ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <Pause className="mr-2 h-4 w-4" />
                            )}
                            Pause
                          </Button>

                          <Button
                            className="h-11 rounded-xl bg-slate-950 text-xs font-semibold text-white hover:bg-slate-800"
                            disabled={clockOut.isPending}
                            onClick={handleClockOutAttempt}
                          >
                            {clockOut.isPending ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <LogOut className="mr-2 h-4 w-4" />
                            )}
                            Clock Out
                          </Button>
                        </div>
                      )}
                    </div>
                  )}

                  {todayRecord?.clock_out && (
                    <div className="mt-5 flex items-center gap-2 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-700">
                      <CheckCircle2 className="h-4 w-4" />
                      Completed for today
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

          {/* Monthly Summary */}
          <section className="space-y-4">
            <div>
              <h2 className="text-base font-semibold tracking-tight text-slate-950">
                My Monthly Summary
              </h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Attendance summary for {selectedMonthLabel} {selectedYear}.
              </p>
            </div>

            {reportLoading ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
                {[1, 2, 3, 4, 5].map((item) => (
                  <Skeleton key={item} className="h-32 rounded-2xl" />
                ))}
              </div>
            ) : !myReportData ? (
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
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
                <AttendanceMetricCard
                  label="Present Days"
                  value={myReportData.presentDays}
                  description="Days marked present."
                  icon={<CheckCircle2 className="h-5 w-5" />}
                  tone="emerald"
                />

                <AttendanceMetricCard
                  label="From Office"
                  value={myReportData.wfoDays}
                  description="Work from office days."
                  icon={<Briefcase className="h-5 w-5" />}
                  tone="sky"
                />

                <AttendanceMetricCard
                  label="Total Hours"
                  value={`${myReportData.totalHours.toFixed(1)}h`}
                  description="Total productive hours."
                  icon={<Timer className="h-5 w-5" />}
                  tone="indigo"
                />

                <AttendanceMetricCard
                  label="Avg Hours / Day"
                  value={`${
                    myReportData.totalDays > 0
                      ? (myReportData.totalHours / myReportData.totalDays).toFixed(1)
                      : "0"
                  }h`}
                  description="Average daily hours."
                  icon={<Clock className="h-5 w-5" />}
                  tone="slate"
                />

                {isAdminOrHR && (
                  <AttendanceMetricCard
                    label="Late Arrivals"
                    value={myReportData.lateDays}
                    description="Late arrival count."
                    icon={<AlertTriangle className="h-5 w-5" />}
                    tone="amber"
                  />
                )}
              </div>
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
                  {isAdminOrHR && countLateArrivals() > 0 && (
                    <Badge className="bg-amber-50 text-amber-700 hover:bg-amber-50">
                      Late Arrivals: {countLateArrivals()}
                    </Badge>
                  )}

                  {isAdminOrHR && (
                    <Badge className="bg-sky-50 text-sky-700 hover:bg-sky-50">
                      Overtime: {calculateMonthlyOvertime().toFixed(2)} hrs
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
                  {employeeError?.message || 'Could not fetch your employee profile. Please check if you are linked to an employee record.'}
                </p>
                <div className="bg-white rounded-lg p-4 mb-4 text-left">
                  <p className="text-xs font-mono text-gray-700">
                    <strong>User ID:</strong> {user?.id}<br />
                    <strong>Email:</strong> {user?.email}<br />
                    <strong>Error:</strong> {employeeError?.message}
                  </p>
                </div>
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
                <div className="bg-white rounded-lg p-4 mb-4 text-left">
                  <p className="text-xs font-mono text-gray-700">
                    <strong>User ID:</strong> {user?.id}<br />
                    <strong>Email:</strong> {user?.email}<br />
                    <strong>Status:</strong> No employee record found
                  </p>
                </div>
              </div>
            ) : recordsError ? (
              <div className="rounded-xl border-2 border-red-200 bg-red-50 p-8 text-center">
                <AlertTriangle className="mx-auto mb-3 h-12 w-12 text-red-500" />
                <h3 className="mb-2 text-lg font-semibold text-red-900">
                  Failed to Load Attendance History
                </h3>
                <p className="mb-4 text-sm text-red-700">
                  {recordsError?.message || 'An error occurred while fetching your attendance records.'}
                </p>
                <div className="bg-white rounded-lg p-4 mb-4 text-left">
                  <p className="text-xs font-mono text-gray-700">
                    <strong>Employee ID:</strong> {currentEmployee?.id}<br />
                    <strong>Month:</strong> {format(targetDate, 'MMMM yyyy')}<br />
                    <strong>Error:</strong> {recordsError?.message}
                  </p>
                </div>
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
                              {format(new Date(record.date), "MMM d, yyyy")}
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
                                <p>
                                  {record.clock_in
                                    ? format(new Date(record.clock_in), "hh:mm a")
                                    : "-"}
                                </p>

                                {isAdminOrHR && lateMinutes > 0 && (
                                  <p className="mt-1 text-xs font-semibold text-amber-700">
                                    {formatLateDuration(lateMinutes)} late
                                  </p>
                                )}
                              </div>
                            </TableCell>

                            <TableCell>
                              {record.clock_out
                                ? format(new Date(record.clock_out), "hh:mm a")
                                : "-"}
                            </TableCell>

                            <TableCell>
                              {record.total_hours
                                ? `${record.total_hours.toFixed(2)} hrs`
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
                                  {record.work_mode === "wfo" ? (
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

          {/* Early Clock-Out Warning */}
          <AlertDialog
            open={showEarlyClockOutWarning}
            onOpenChange={setShowEarlyClockOutWarning}
          >
            <AlertDialogContent className="rounded-2xl">
              <AlertDialogHeader>
                <AlertDialogTitle>Early Clock-Out Warning</AlertDialogTitle>

                <AlertDialogDescription className="space-y-3">
                  {earlyClockOutReasons.insufficientHours && (
                    <span className="block">
                      You have only worked{" "}
                      {formatHoursWorked(calculateCurrentHoursWorked())} today.
                      Your configured shift requires more working time.
                    </span>
                  )}

                  {earlyClockOutReasons.beforeEndTime &&
                    currentEmployee?.working_hours_end && (
                      <span className="block">
                        Your scheduled end time is{" "}
                        {formatTimeDisplay(currentEmployee.working_hours_end)}.
                      </span>
                    )}

                  <span className="block">
                    Are you sure you want to clock out early?
                  </span>
                </AlertDialogDescription>
              </AlertDialogHeader>

              <AlertDialogFooter>
                <AlertDialogCancel className="rounded-xl">
                  Continue Working
                </AlertDialogCancel>

                <AlertDialogAction
                  className="rounded-xl bg-amber-600 text-white hover:bg-amber-700"
                  onClick={handleClockOut}
                >
                  Clock Out Anyway
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* Late Clock-Out Dialog */}
          <AlertDialog
            open={showLateClockOutDialog}
            onOpenChange={setShowLateClockOutDialog}
          >
            <AlertDialogContent className="rounded-2xl">
              <AlertDialogHeader>
                <AlertDialogTitle>Clock Out After End Time</AlertDialogTitle>

                <AlertDialogDescription>
                  Your scheduled end time was{" "}
                  {formatTimeDisplay(
                    currentEmployee?.working_hours_end || "18:00:00"
                  )}{" "}
                  and you&apos;ve worked{" "}
                  {formatHoursWorked(calculateCurrentHoursWorked())}. Was this
                  overtime or did you forget to clock out?
                </AlertDialogDescription>
              </AlertDialogHeader>

              <div className="space-y-3">
                <Button
                  type="button"
                  variant={lateClockOutMode === "overtime" ? "default" : "outline"}
                  className="h-11 w-full rounded-xl text-xs font-semibold"
                  onClick={() => setLateClockOutMode("overtime")}
                >
                  It was overtime — use current time
                </Button>

                <Button
                  type="button"
                  variant={lateClockOutMode === "missed" ? "default" : "outline"}
                  className="h-11 w-full rounded-xl text-xs font-semibold"
                  onClick={() => setLateClockOutMode("missed")}
                >
                  I forgot to clock out — enter actual time
                </Button>

                {lateClockOutMode === "missed" && (
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-slate-700">
                      Actual clock-out time
                    </label>

                    <Input
                      type="time"
                      value={missedClockOutTime}
                      onChange={(event) =>
                        setMissedClockOutTime(event.target.value)
                      }
                      className="h-11 rounded-xl"
                    />
                  </div>
                )}
              </div>

              <AlertDialogFooter>
                <AlertDialogCancel
                  className="rounded-xl"
                  onClick={() => setLateClockOutMode(null)}
                >
                  Cancel
                </AlertDialogCancel>

                <AlertDialogAction
                  className="rounded-xl bg-slate-950 text-white hover:bg-slate-800"
                  onClick={handleLateClockOutConfirm}
                  disabled={
                    !lateClockOutMode ||
                    (lateClockOutMode === "missed" && !missedClockOutTime)
                  }
                >
                  Confirm Clock Out
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </TooltipProvider>
    </DashboardLayout>
  );
};

export default Attendance;