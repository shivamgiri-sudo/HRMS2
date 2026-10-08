import { useState } from "react";
import { hrmsApi } from "@/lib/hrmsApi";
import { leaveTypeChartVar } from "./leaveTheme";
import { fetchApprovedLeavesForMonth } from "./leaveCalendarData";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { AuthedAvatarImage } from "@/components/ui/AuthedAvatarImage";
import { normalizeMediaUrl } from "@/lib/mediaUrl";
import { Calendar } from "@/components/ui/calendar";
import { ChevronLeft, ChevronRight, CalendarDays, Users } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import {
  format,
  startOfMonth,
  endOfMonth,
  addMonths,
  subMonths,
  eachDayOfInterval,
  parseISO,
  isWithinInterval,
  isSameDay,
} from "date-fns";
import { normalizeDate } from "@/lib/utils";

// leaveTypeColors, leaveColorFallbacks, getLeaveColor imported from @/lib/leaveColors

export function LeaveCalendarView() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
  
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const monthName = format(currentDate, "MMMM yyyy");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["leave-calendar-view", format(monthStart, "yyyy-MM-dd")],
    queryFn: () => fetchApprovedLeavesForMonth(format(monthStart, "yyyy-MM-dd"), format(monthEnd, "yyyy-MM-dd")),
    staleTime: 60_000,
  });
  const leaves = data?.rows ?? [];

  // Generate all dates that have leaves
  const leaveDates = leaves.flatMap((leave) => {
    const start = parseISO(normalizeDate(leave.start_date ?? ""));
    const end = parseISO(normalizeDate(leave.end_date ?? ""));
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
    return eachDayOfInterval({ start, end });
  });

  // Get leaves for selected date
  const selectedDateLeaves = selectedDate
    ? leaves.filter((leave) => {
        const start = parseISO(normalizeDate(leave.start_date ?? ""));
        const end = parseISO(normalizeDate(leave.end_date ?? ""));
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
        return isWithinInterval(selectedDate, { start, end });
      })
    : [];

  const handlePrevMonth = () => setCurrentDate(subMonths(currentDate, 1));
  const handleNextMonth = () => setCurrentDate(addMonths(currentDate, 1));

  // Custom modifiers for calendar
  const modifiers = {
    hasLeave: leaveDates,
  };

  const modifiersStyles = {
    hasLeave: {
      backgroundColor: "hsl(var(--primary) / 0.15)",
      borderRadius: "50%",
    },
  };

  if (isLoading) {
    return (
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-border bg-card">
          <CardHeader>
            <Skeleton className="h-6 w-40 bg-muted" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-[300px] w-full bg-muted" />
          </CardContent>
        </Card>
        <Card className="border-border bg-card">
          <CardHeader>
            <Skeleton className="h-6 w-32 bg-muted" />
          </CardHeader>
          <CardContent className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 w-full bg-muted" />
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Calendar */}
      <Card className="border-border bg-card">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="flex items-center gap-2 text-lg text-foreground">
            <CalendarDays className="h-5 w-5 text-primary" />
            Leave Calendar
          </CardTitle>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={handlePrevMonth}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-[120px] text-center text-sm font-medium text-foreground">{monthName}</span>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={handleNextMonth}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={setSelectedDate}
            month={currentDate}
            onMonthChange={setCurrentDate}
            modifiers={modifiers}
            modifiersStyles={modifiersStyles}
            className="rounded-md border-0 p-0"
            classNames={{
              months: "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0",
              month: "space-y-4 w-full",
              caption: "hidden",
              table: "w-full border-collapse space-y-1",
              head_row: "flex w-full",
              head_cell: "text-muted-foreground rounded-md w-full font-normal text-[0.8rem]",
              row: "flex w-full mt-2",
              cell: "relative p-0 text-center text-sm focus-within:relative focus-within:z-20 w-full aspect-square",
              day: "h-full w-full p-0 font-normal text-foreground aria-selected:opacity-100 hover:bg-muted rounded-md transition-colors",
              day_selected: "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
              day_today: "ring-2 ring-primary ring-offset-2 ring-offset-background",
              day_outside: "text-muted-foreground opacity-50",
            }}
          />

          {isError && (
            <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">
              Could not load leave for this month.{" "}
              <button type="button" className="font-semibold underline" onClick={() => refetch()}>Retry</button>
            </p>
          )}
          {data?.truncated && (
            <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800" role="status">
              Showing {data.rows.length.toLocaleString("en-IN")} of {data.total.toLocaleString("en-IN")} approved leaves this month. Days
              with more leave than shown may be missing people; use History with filters for the full list.
            </p>
          )}

          {/* Legend */}
          <div className="mt-4 flex items-center gap-4 border-t border-border pt-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <div className="h-3 w-3 rounded-full bg-primary/30" />
              <span>Has leaves</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-3 w-3 rounded-full ring-2 ring-primary" />
              <span>Today</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Selected Date Details */}
      <Card className="border-border bg-card">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg text-foreground">
            <Users className="h-5 w-5 text-primary" />
            {selectedDate ? format(selectedDate, "EEEE, MMMM d, yyyy") : "Select a date"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {selectedDateLeaves.length > 0 ? (
            <div className="space-y-3">
              <p className="mb-4 text-sm text-muted-foreground">
                {selectedDateLeaves.length} employee{selectedDateLeaves.length > 1 ? "s" : ""} on leave
              </p>
              {selectedDateLeaves.map((leave) => {
                const fullName = leave.employee
                  ? `${leave.employee.first_name} ${leave.employee.last_name ?? ""}`.trim()
                  : "Unknown";
                const initials = leave.employee
                  ? `${leave.employee.first_name?.[0] ?? ""}${leave.employee.last_name?.[0] ?? ""}`.toUpperCase() || "?"
                  : "??";
                const leaveType = leave.leave_type?.name || "Leave";

                return (
                  <div
                    key={leave.id}
                    className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:bg-muted/60"
                  >
                    <div className="relative">
                      <Avatar className="h-10 w-10 rounded-lg">
                        {leave.employee?.avatar_url && (
                          <AuthedAvatarImage src={normalizeMediaUrl(leave.employee.avatar_url)} className="rounded-lg" />
                        )}
                        <AvatarFallback className="rounded-lg bg-muted text-foreground">{initials}</AvatarFallback>
                      </Avatar>
                      <div
                        className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card"
                        style={{ backgroundColor: leaveTypeChartVar(leaveType) }}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{fullName}</p>
                      <p className="text-xs text-muted-foreground">
                        {format(parseISO(normalizeDate(leave.start_date ?? "")), "MMM d")} - {format(parseISO(normalizeDate(leave.end_date ?? "")), "MMM d")}
                        <span className="ml-1">({leave.days_count ?? 0} day{Number(leave.days_count ?? 0) > 1 ? "s" : ""})</span>
                      </p>
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2.5 py-0.5 text-xs font-medium text-foreground">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: leaveTypeChartVar(leaveType) }} aria-hidden="true" />
                      {leaveType}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : selectedDate ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <CalendarDays className="mb-3 h-10 w-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No approved leaves on this date</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Click on highlighted dates to see who's out
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <CalendarDays className="mb-3 h-10 w-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Select a date to view leaves</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
