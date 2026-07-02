import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { ChevronLeft, ChevronRight, Users, CalendarDays } from "lucide-react";
import { useTeamLeaves, useIsManager } from "@/hooks/useTeamLeaves";
import { Skeleton } from "@/components/ui/skeleton";
import { format, isSameDay, isWithinInterval, parseISO, addMonths, subMonths, isValid } from "date-fns";
import { cn, formatDate, normalizeDate } from "@/lib/utils";

export function TeamLeaveCalendar() {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  
  const { data: isManager, isLoading: loadingManager } = useIsManager();
  const { data: teamLeaves = [], isLoading } = useTeamLeaves(currentMonth);

  // Don't render if user is not a manager
  if (loadingManager) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-40" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!isManager) {
    return null;
  }

  const handlePrevMonth = () => setCurrentMonth(subMonths(currentMonth, 1));
  const handleNextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));

  // Get leaves that overlap with selected date
  const selectedDateLeaves = selectedDate
    ? teamLeaves.filter((leave) => {
        const start = parseISO(normalizeDate(leave.start_date));
        const end = parseISO(normalizeDate(leave.end_date));
        if (!isValid(start) || !isValid(end)) return false;

        return isWithinInterval(selectedDate, { start, end }) || 
               isSameDay(selectedDate, start) || 
               isSameDay(selectedDate, end);
      })
    : [];

  // Get all dates that have leaves
  const leaveDates = teamLeaves.flatMap((leave) => {
    const dates: Date[] = [];
    const start = parseISO(normalizeDate(leave.start_date));
    const end = parseISO(normalizeDate(leave.end_date));
    if (!isValid(start) || !isValid(end)) return dates;

    const current = new Date(start);
    while (current <= end) {
      dates.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }
    return dates;
  });

  const formatLeaveRange = (startDate: string, endDate: string) => {
    const start = formatDate(startDate, "MMM d");
    const end = formatDate(endDate, "MMM d");
    return [start, end].filter(Boolean).join(" - ") || "Dates pending";
  };

  const modifiers = {
    hasLeave: leaveDates,
  };

  const modifiersStyles = {
    hasLeave: {
      backgroundColor: "hsl(var(--warning) / 0.2)",
      borderRadius: "50%",
    },
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            Team Calendar
          </CardTitle>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handlePrevMonth}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium min-w-[100px] text-center">
              {format(currentMonth, "MMM yyyy")}
            </span>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleNextMonth}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <>
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={setSelectedDate}
              month={currentMonth}
              onMonthChange={setCurrentMonth}
              modifiers={modifiers}
              modifiersStyles={modifiersStyles}
              className={cn("p-0 pointer-events-auto")}
              classNames={{
                months: "flex flex-col w-full",
                month: "space-y-2 w-full",
                caption: "hidden",
                nav: "hidden",
                table: "w-full border-collapse",
                head_row: "flex justify-between w-full",
                head_cell: "text-muted-foreground font-normal text-xs flex-1 text-center",
                row: "flex w-full mt-1 justify-between",
                cell: "flex-1 text-center text-sm p-0 relative aspect-square",
                day: "h-full w-full p-0 font-normal hover:bg-accent rounded-full flex items-center justify-center",
                day_selected: "bg-primary text-primary-foreground hover:bg-primary",
                day_today: "border border-primary",
                day_outside: "text-muted-foreground opacity-50",
              }}
            />

            {/* Leaves for selected date */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <CalendarDays className="h-4 w-4" />
                {selectedDate ? format(selectedDate, "EEEE, MMMM d") : "Select a date"}
              </div>

              {selectedDate && selectedDateLeaves.length > 0 ? (
                <div className="space-y-2">
                  {selectedDateLeaves.map((leave) => (
                    <div
                      key={leave.id}
                      className="flex items-center gap-3 rounded-lg bg-muted/50 p-2"
                    >
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={leave.employee_avatar || undefined} />
                        <AvatarFallback className="text-xs">
                          {leave.employee_name.split(" ").map((n) => n[0]).join("")}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{leave.employee_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatLeaveRange(leave.start_date, leave.end_date)}
                        </p>
                      </div>
                      <Badge variant="secondary" className="text-xs shrink-0">
                        {leave.leave_type}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : selectedDate ? (
                <p className="text-sm text-muted-foreground py-2">No team members on leave</p>
              ) : (
                <p className="text-sm text-muted-foreground py-2">
                  {teamLeaves.length > 0 
                    ? `${teamLeaves.length} approved leave${teamLeaves.length !== 1 ? "s" : ""} this month`
                    : "No approved leaves this month"
                  }
                </p>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
