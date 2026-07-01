import { useState } from "react";
import { hrmsApi } from "@/lib/hrmsApi";
import { leaveTypeColors, getLeaveColor } from "@/lib/leaveColors";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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

interface LeaveData {
  id: string;
  start_date?: string;
  end_date?: string;
  from_date?: string;
  to_date?: string;
  days_count?: number;
  total_days?: number;
  employee_name?: string;
  avatar_url?: string | null;
  leave_type_name?: string;
  employee: {
    first_name: string;
    last_name: string;
    avatar_url: string | null;
  } | null;
  leave_type: {
    name: string;
  } | null;
}

function normalizeLeave(row: any): LeaveData {
  if (row.start_date && row.end_date && row.employee && row.leave_type) return row as LeaveData;
  const employeeName = String(row.employee_name ?? "Unknown").trim();
  const [firstName = "Unknown", ...rest] = employeeName.split(/\s+/);
  return {
    ...row,
    start_date: row.from_date ?? row.start_date,
    end_date: row.to_date ?? row.end_date,
    days_count: Number(row.total_days ?? row.days_count ?? 0),
    employee: {
      first_name: firstName,
      last_name: rest.join(" "),
      avatar_url: row.avatar_url ?? null,
    },
    leave_type: {
      name: row.leave_type_name ?? row.leave_type?.name ?? "Leave",
    },
  };
}

async function fetchApprovedLeavesForYear(year: number): Promise<LeaveData[]> {
  const limit = 100;
  const first = await hrmsApi.get<{success:boolean;data:any[];total?:number}>(
    `/api/leave/requests?status=approved&year=${year}&page=1&limit=${limit}`
  );
  const rows = first.data ?? [];
  const total = Number(first.total ?? rows.length);
  const totalPages = Math.ceil(total / limit);

  const remaining = totalPages > 1
    ? await Promise.all(
        Array.from({ length: totalPages - 1 }, (_, index) =>
          hrmsApi.get<{success:boolean;data:any[]}>(
            `/api/leave/requests?status=approved&year=${year}&page=${index + 2}&limit=${limit}`
          )
        )
      )
    : [];

  const byId = new Map<string, LeaveData>();
  for (const raw of rows.concat(...remaining.map((page) => page.data ?? []))) {
    const leave = normalizeLeave(raw);
    const key = String(leave.id ?? "");
    if (!key || byId.has(key) || !leave.start_date || !leave.end_date) continue;
    byId.set(key, leave);
  }
  return Array.from(byId.values());
}

// leaveTypeColors, leaveColorFallbacks, getLeaveColor imported from @/lib/leaveColors

export function LeaveCalendarView() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
  
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const monthName = format(currentDate, "MMMM yyyy");

  const { data: leaves = [], isLoading } = useQuery({
    queryKey: ["leave-calendar-view", format(monthStart, "yyyy-MM-dd")],
    queryFn: async () => {
      return fetchApprovedLeavesForYear(currentDate.getFullYear());
    },
  });

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
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-40" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-[300px] w-full" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-32" />
          </CardHeader>
          <CardContent className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Calendar */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-primary" />
            Leave Calendar
          </CardTitle>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handlePrevMonth}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium min-w-[120px] text-center">{monthName}</span>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleNextMonth}>
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
              day: "h-full w-full p-0 font-normal aria-selected:opacity-100 hover:bg-muted rounded-md transition-colors",
              day_selected: "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
              day_today: "ring-2 ring-primary ring-offset-2 ring-offset-background",
              day_outside: "text-muted-foreground opacity-50",
            }}
          />
          
          {/* Legend */}
          <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground border-t pt-4">
            <div className="flex items-center gap-1.5">
              <div className="h-3 w-3 rounded-full bg-primary/20" />
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
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            {selectedDate ? format(selectedDate, "EEEE, MMMM d, yyyy") : "Select a date"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {selectedDateLeaves.length > 0 ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground mb-4">
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
                    className="flex items-center gap-3 rounded-lg border p-3"
                  >
                    <div className="relative">
                      <Avatar className="h-10 w-10">
                        {leave.employee?.avatar_url && (
                          <AvatarImage src={leave.employee.avatar_url} />
                        )}
                        <AvatarFallback>{initials}</AvatarFallback>
                      </Avatar>
                      <div 
                        className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background ${getLeaveColor(leaveType)}`}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{fullName}</p>
                      <p className="text-xs text-muted-foreground">
                        {format(parseISO(normalizeDate(leave.start_date ?? "")), "MMM d")} - {format(parseISO(normalizeDate(leave.end_date ?? "")), "MMM d")}
                        <span className="ml-1">({leave.days_count ?? 0} day{Number(leave.days_count ?? 0) > 1 ? "s" : ""})</span>
                      </p>
                    </div>
                    <Badge 
                      variant="secondary"
                      className={`shrink-0 ${
                        leaveType === "Annual" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" :
                        leaveType === "Sick" ? "bg-rose-500/10 text-rose-600 dark:text-rose-400" :
                        leaveType === "Casual" ? "bg-sky-500/10 text-sky-600 dark:text-sky-400" :
                        leaveType === "Unpaid" ? "bg-slate-500/10 text-slate-600 dark:text-slate-400" :
                        "bg-primary/10 text-primary"
                      }`}
                    >
                      {leaveType}
                    </Badge>
                  </div>
                );
              })}
            </div>
          ) : selectedDate ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <CalendarDays className="h-10 w-10 text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">No approved leaves on this date</p>
              <p className="text-xs text-muted-foreground mt-1">
                Click on highlighted dates to see who's out
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <CalendarDays className="h-10 w-10 text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">Select a date to view leaves</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
