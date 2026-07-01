import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { hrmsApi } from "@/lib/hrmsApi";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { format, startOfMonth, endOfMonth, addMonths, subMonths } from "date-fns";
import { parseLocalDate } from "@/lib/utils";

export function LeaveCalendar() {
  const [currentDate, setCurrentDate] = useState(new Date());
  
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const monthName = format(currentDate, "MMMM yyyy");

  const { data: leaves, isLoading } = useQuery({
    queryKey: ["leave-calendar", format(monthStart, "yyyy-MM-dd")],
    queryFn: async () => {
      const res = await hrmsApi.get<{success:boolean;data:any}>("/api/leave/requests");
      return res.data ?? [];
    },
  });

  const handlePrevMonth = () => setCurrentDate(subMonths(currentDate, 1));
  const handleNextMonth = () => setCurrentDate(addMonths(currentDate, 1));

  const formatLeaveDays = (startDate: string, endDate: string) => {
    const start = parseLocalDate(startDate);
    const end = parseLocalDate(endDate);
    
    if (startDate === endDate) {
      return format(start, "d MMM");
    }
    
    if (start.getMonth() === end.getMonth()) {
      return `${format(start, "d")}-${format(end, "d MMM")}`;
    }
    
    return `${format(start, "d MMM")} - ${format(end, "d MMM")}`;
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg font-semibold">Who's Out</CardTitle>
          <Skeleton className="h-8 w-32" />
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3 rounded-xl bg-muted/50 p-3">
              <Skeleton className="h-9 w-9 rounded-full" />
              <div className="flex-1 space-y-1">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-16" />
              </div>
              <Skeleton className="h-5 w-12" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="text-lg font-semibold">Who's Out</CardTitle>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={handlePrevMonth}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium min-w-[100px] text-center truncate">{monthName}</span>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={handleNextMonth}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {!leaves || leaves.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No approved leaves this month
          </p>
        ) : (
          leaves.map((leave) => {
            const employee = leave.employee as { first_name: string; last_name: string; avatar_url: string | null } | null;
            const leaveType = leave.leave_type as { name: string } | null;
            const fullName = employee ? `${employee.first_name} ${employee.last_name}` : "Unknown";
            const initials = employee 
              ? `${employee.first_name[0]}${employee.last_name[0]}`.toUpperCase()
              : "??";
            
            return (
              <div
                key={leave.id}
                className="flex items-center gap-3 rounded-xl bg-muted/50 p-3"
              >
                <Avatar className="h-9 w-9">
                  {employee?.avatar_url && <AvatarImage src={employee.avatar_url} />}
                  <AvatarFallback>{initials}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{fullName}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatLeaveDays(leave.start_date, leave.end_date)}
                  </p>
                </div>
                <Badge variant="secondary" className="text-xs">
                  {leaveType?.name || "Leave"}
                </Badge>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
