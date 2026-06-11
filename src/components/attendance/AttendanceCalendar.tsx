import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Clock, MapPin } from "lucide-react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

interface AttendanceRecord {
  id: string;
  date: string;
  clock_in: string | null;
  clock_out: string | null;
  total_hours: number | null;
  status: string;
  work_mode: string | null;
  clock_in_location_name: string | null;
  clock_out_location_name: string | null;
}

interface AttendanceCalendarProps {
  employeeId: string;
}

const statusColors: Record<string, string> = {
  present: "bg-emerald-500 hover:bg-emerald-600 text-white",
  late: "bg-amber-500 hover:bg-amber-600 text-white",
  absent: "bg-red-500 hover:bg-red-600 text-white",
  "half-day": "bg-sky-500 hover:bg-sky-600 text-white",
  leave: "bg-blue-500 hover:bg-blue-600 text-white",
  holiday: "bg-purple-500 hover:bg-purple-600 text-white",
  weekend: "bg-gray-300 hover:bg-gray-400 text-gray-700",
};

export function AttendanceCalendar({ employeeId }: AttendanceCalendarProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<AttendanceRecord | null>(null);

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);

  // Fetch attendance records for the current month
  const { data: records, isLoading } = useQuery({
    queryKey: ["attendance-calendar", employeeId, format(currentDate, "yyyy-MM")],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: AttendanceRecord[] }>(
        `/api/wfm/attendance/daily?employeeId=${employeeId}&fromDate=${format(monthStart, "yyyy-MM-dd")}&toDate=${format(monthEnd, "yyyy-MM-dd")}`
      );
      return res.data ?? [];
    },
    enabled: !!employeeId,
  });

  // Create a map of date -> record for quick lookup
  const recordsByDate = new Map<string, AttendanceRecord>();
  records?.forEach((record) => {
    recordsByDate.set(record.date, record);
  });

  // Generate all days in the month
  const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });

  // Get the starting day of week (0 = Sunday, 1 = Monday, etc.)
  const startingDayOfWeek = monthStart.getDay();

  // Add empty cells for days before the month starts
  const emptyCells = Array(startingDayOfWeek).fill(null);

  const handlePreviousMonth = () => {
    setCurrentDate(subMonths(currentDate, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(addMonths(currentDate, 1));
  };

  const handleDateClick = (date: Date) => {
    const dateStr = format(date, "yyyy-MM-dd");
    const record = recordsByDate.get(dateStr);
    if (record) {
      setSelectedDate(date);
      setSelectedRecord(record);
    }
  };

  const getStatusForDate = (date: Date): string => {
    const dateStr = format(date, "yyyy-MM-dd");
    const record = recordsByDate.get(dateStr);

    if (record) {
      return record.status;
    }

    // Check if it's a weekend (Saturday or Sunday)
    const dayOfWeek = date.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return "weekend";
    }

    // Future dates
    if (date > new Date()) {
      return "";
    }

    // Past dates with no record are likely absent
    return "absent";
  };

  const formatTime = (timestamp: string | null) => {
    if (!timestamp) return "-";
    return format(new Date(timestamp), "h:mm a");
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <CalendarIcon className="h-5 w-5" />
                Attendance Calendar
              </CardTitle>
              <CardDescription>
                View your attendance records day by day
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handlePreviousMonth}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="min-w-[140px] text-center font-semibold">
                {format(currentDate, "MMMM yyyy")}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleNextMonth}
                disabled={currentDate >= new Date()}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-64 w-full" />
            </div>
          ) : (
            <>
              {/* Legend */}
              <div className="mb-4 flex flex-wrap gap-2 text-xs">
                <Badge className={statusColors.present}>Present</Badge>
                <Badge className={statusColors.late}>Late</Badge>
                <Badge className={statusColors.absent}>Absent</Badge>
                <Badge className={statusColors["half-day"]}>Half Day</Badge>
                <Badge className={statusColors.leave}>Leave</Badge>
                <Badge className={statusColors.weekend}>Weekend</Badge>
              </div>

              {/* Calendar Grid */}
              <div className="grid grid-cols-7 gap-2">
                {/* Weekday headers */}
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                  <div
                    key={day}
                    className="text-center text-sm font-semibold text-muted-foreground p-2"
                  >
                    {day}
                  </div>
                ))}

                {/* Empty cells before month starts */}
                {emptyCells.map((_, index) => (
                  <div key={`empty-${index}`} className="aspect-square" />
                ))}

                {/* Days of the month */}
                {daysInMonth.map((date) => {
                  const status = getStatusForDate(date);
                  const isToday = isSameDay(date, new Date());
                  const hasRecord = recordsByDate.has(format(date, "yyyy-MM-dd"));
                  const isFuture = date > new Date();

                  return (
                    <button
                      key={date.toString()}
                      onClick={() => handleDateClick(date)}
                      disabled={!hasRecord}
                      className={`
                        aspect-square p-1 rounded-lg border-2 transition-all
                        ${isToday ? "border-primary" : "border-transparent"}
                        ${status && statusColors[status] ? statusColors[status] : "bg-gray-100 hover:bg-gray-200"}
                        ${!hasRecord ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
                        ${isFuture ? "opacity-30" : ""}
                        flex flex-col items-center justify-center
                      `}
                    >
                      <div className={`text-sm font-semibold ${status === "weekend" ? "text-gray-700" : ""}`}>
                        {format(date, "d")}
                      </div>
                      {hasRecord && (
                        <div className="text-[10px] opacity-90">
                          {status}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Details Dialog */}
      <Dialog open={!!selectedDate} onOpenChange={(open) => !open && setSelectedDate(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Attendance Details - {selectedDate && format(selectedDate, "MMMM d, yyyy")}
            </DialogTitle>
            <DialogDescription>
              Your attendance record for this day
            </DialogDescription>
          </DialogHeader>
          {selectedRecord && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="font-medium">Status:</span>
                <Badge className={statusColors[selectedRecord.status] || ""}>
                  {selectedRecord.status}
                </Badge>
              </div>

              {selectedRecord.work_mode && (
                <div className="flex items-center justify-between">
                  <span className="font-medium">Work Mode:</span>
                  <Badge variant="outline">
                    {selectedRecord.work_mode === "wfh" ? "Work From Home" : "Office"}
                  </Badge>
                </div>
              )}

              <div className="space-y-2 rounded-lg border p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    <span>Clock In:</span>
                  </div>
                  <div className="font-medium">{formatTime(selectedRecord.clock_in)}</div>
                </div>
                {selectedRecord.clock_in_location_name && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground ml-6">
                    <MapPin className="h-3 w-3" />
                    {selectedRecord.clock_in_location_name}
                  </div>
                )}
              </div>

              <div className="space-y-2 rounded-lg border p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    <span>Clock Out:</span>
                  </div>
                  <div className="font-medium">{formatTime(selectedRecord.clock_out)}</div>
                </div>
                {selectedRecord.clock_out_location_name && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground ml-6">
                    <MapPin className="h-3 w-3" />
                    {selectedRecord.clock_out_location_name}
                  </div>
                )}
              </div>

              {selectedRecord.total_hours !== null && (
                <div className="flex items-center justify-between rounded-lg border-2 border-primary/20 bg-primary/5 p-4">
                  <span className="font-semibold">Total Hours:</span>
                  <span className="text-lg font-bold text-primary">
                    {selectedRecord.total_hours.toFixed(1)}h
                  </span>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
