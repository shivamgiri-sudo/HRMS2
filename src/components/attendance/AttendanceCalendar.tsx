import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Clock, MapPin, Calendar as CalendarIcon } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AttendanceDay {
  date: string;
  status: "present" | "absent" | "leave" | "holiday" | "weekend" | "half-day";
  punchIn?: string;
  punchOut?: string;
  totalHours?: number;
  breakDuration?: number;
  location?: string;
  ipAddress?: string;
  remarks?: string;
  leaveType?: string;
}

interface AttendanceCalendarProps {
  employeeId: string;
  initialMonth?: number;
  initialYear?: number;
}

// ─── Utilities ───────────────────────────────────────────────────────────────

const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

function formatDate(year: number, month: number, day: number): string {
  const m = String(month + 1).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${year}-${m}-${d}`;
}

function formatTime(time?: string): string {
  if (!time) return "N/A";
  try {
    return new Date(time).toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return time;
  }
}

function getStatusColor(status: AttendanceDay["status"]): string {
  const colors = {
    present: "bg-emerald-100 border-emerald-300 text-emerald-800 hover:bg-emerald-200",
    absent: "bg-red-100 border-red-300 text-red-800 hover:bg-red-200",
    leave: "bg-blue-100 border-blue-300 text-blue-800 hover:bg-blue-200",
    holiday: "bg-purple-100 border-purple-300 text-purple-800 hover:bg-purple-200",
    weekend: "bg-slate-100 border-slate-300 text-slate-600 hover:bg-slate-200",
    "half-day": "bg-amber-100 border-amber-300 text-amber-800 hover:bg-amber-200",
  };
  return colors[status] || "bg-slate-50 border-slate-200 text-slate-500";
}

function getStatusBadgeColor(status: AttendanceDay["status"]): string {
  const colors = {
    present: "bg-emerald-500",
    absent: "bg-red-500",
    leave: "bg-blue-500",
    holiday: "bg-purple-500",
    weekend: "bg-slate-400",
    "half-day": "bg-amber-500",
  };
  return colors[status] || "bg-slate-300";
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function AttendanceCalendar({
  employeeId,
  initialMonth,
  initialYear,
}: AttendanceCalendarProps) {
  const today = new Date();
  const [currentMonth, setCurrentMonth] = useState(initialMonth ?? today.getMonth());
  const [currentYear, setCurrentYear] = useState(initialYear ?? today.getFullYear());
  const [selectedDate, setSelectedDate] = useState<AttendanceDay | null>(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);

  // Fetch attendance data
  const { data: attendanceData = [], isLoading } = useQuery<AttendanceDay[]>({
    queryKey: ["attendance-calendar", employeeId, currentYear, currentMonth],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: any[] }>(
        `/api/wfm/attendance?employee_id=${employeeId}&month=${currentMonth + 1}&year=${currentYear}`
      );
      return (res.data || []).map((record: any) => ({
        date: record.attendance_date || record.punch_date,
        status: record.status || "present",
        punchIn: record.punch_in || record.first_punch,
        punchOut: record.punch_out || record.last_punch,
        totalHours: record.total_hours || record.working_hours,
        breakDuration: record.break_minutes,
        location: record.location || record.punch_location,
        ipAddress: record.ip_address,
        remarks: record.remarks,
        leaveType: record.leave_type,
      }));
    },
    enabled: !!employeeId,
  });

  const attendanceMap = new Map<string, AttendanceDay>();
  attendanceData.forEach((day) => {
    attendanceMap.set(day.date, day);
  });

  const goToPreviousMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(currentYear - 1);
    } else {
      setCurrentMonth(currentMonth - 1);
    }
  };

  const goToNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(currentYear + 1);
    } else {
      setCurrentMonth(currentMonth + 1);
    }
  };

  const goToToday = () => {
    setCurrentMonth(today.getMonth());
    setCurrentYear(today.getFullYear());
  };

  const daysInMonth = getDaysInMonth(currentYear, currentMonth);
  const firstDayOfMonth = getFirstDayOfMonth(currentYear, currentMonth);
  const calendarDays: (number | null)[] = [];

  for (let i = 0; i < firstDayOfMonth; i++) {
    calendarDays.push(null);
  }
  for (let day = 1; day <= daysInMonth; day++) {
    calendarDays.push(day);
  }

  const handleDayClick = (day: number) => {
    const dateStr = formatDate(currentYear, currentMonth, day);
    const attendance = attendanceMap.get(dateStr);
    if (attendance) {
      setSelectedDate(attendance);
      setDetailModalOpen(true);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-8 w-48" />
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-2">
            {Array.from({ length: 35 }).map((_, i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{MONTHS[currentMonth]} {currentYear}</CardTitle>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={goToToday}>
                <CalendarIcon className="mr-2 h-4 w-4" />
                Today
              </Button>
              <Button variant="outline" size="icon" onClick={goToPreviousMonth}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" onClick={goToNextMonth}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex gap-3 text-xs">
            {[
              { status: "present", label: "Present" },
              { status: "absent", label: "Absent" },
              { status: "leave", label: "Leave" },
              { status: "holiday", label: "Holiday" },
            ].map(({ status, label }) => (
              <div key={status} className="flex items-center gap-1.5">
                <div className={`h-3 w-3 rounded-full ${getStatusBadgeColor(status as AttendanceDay["status"])}`} />
                <span>{label}</span>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-2">
            {DAYS_SHORT.map((day) => (
              <div key={day} className="p-2 text-center text-xs font-bold uppercase text-slate-600">
                {day}
              </div>
            ))}
            {calendarDays.map((day, index) => {
              if (day === null) return <div key={`empty-${index}`} className="p-2" />;
              const dateStr = formatDate(currentYear, currentMonth, day);
              const attendance = attendanceMap.get(dateStr);
              const dayOfWeek = new Date(currentYear, currentMonth, day).getDay();
              const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
              const status = attendance?.status || (isWeekend ? "weekend" : "absent");
              const colorClass = getStatusColor(status);
              return (
                <button
                  key={day}
                  onClick={() => handleDayClick(day)}
                  className={`min-h-[80px] rounded-lg border-2 p-2 text-left transition-all cursor-pointer ${colorClass}`}
                >
                  <div className="font-bold text-sm">{day}</div>
                  {attendance?.punchIn && (
                    <div className="mt-1 text-xs">
                      <Clock className="inline h-3 w-3 mr-1" />
                      {formatTime(attendance.punchIn).slice(0, 5)}
                    </div>
                  )}
                  {attendance?.totalHours && (
                    <div className="text-xs font-semibold">{attendance.totalHours.toFixed(1)}h</div>
                  )}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Dialog open={detailModalOpen} onOpenChange={setDetailModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Attendance Details</DialogTitle>
            <DialogDescription>
              {selectedDate && new Date(selectedDate.date).toLocaleDateString("en-IN", {
                weekday: "long", year: "numeric", month: "long", day: "numeric"
              })}
            </DialogDescription>
          </DialogHeader>
          {selectedDate && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <div className={`h-4 w-4 rounded-full ${getStatusBadgeColor(selectedDate.status)}`} />
                <Badge variant="secondary" className="capitalize">{selectedDate.status}</Badge>
              </div>
              {selectedDate.punchIn && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs font-medium text-slate-500">Punch In</p>
                    <p className="text-lg font-semibold">{formatTime(selectedDate.punchIn)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-slate-500">Punch Out</p>
                    <p className="text-lg font-semibold">{formatTime(selectedDate.punchOut)}</p>
                  </div>
                </div>
              )}
              {selectedDate.totalHours !== undefined && (
                <div>
                  <p className="text-xs font-medium text-slate-500">Total Hours</p>
                  <p className="text-lg font-semibold">{selectedDate.totalHours.toFixed(2)} hrs</p>
                </div>
              )}
              {selectedDate.location && (
                <div>
                  <p className="text-xs font-medium text-slate-500">Location</p>
                  <div className="flex items-center gap-2 mt-1">
                    <MapPin className="h-4 w-4" />
                    <p className="text-sm">{selectedDate.location}</p>
                  </div>
                  {selectedDate.ipAddress && (
                    <p className="text-xs text-slate-500 mt-1">IP: {selectedDate.ipAddress}</p>
                  )}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
