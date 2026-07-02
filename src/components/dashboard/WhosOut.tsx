import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { UserX } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { Skeleton } from "@/components/ui/skeleton";
import { format, parseISO } from "date-fns";
import { normalizeDate } from "@/lib/utils";

interface LeaveInfo {
  id: string;
  employee_name: string;
  employee_avatar?: string;
  leave_type: string;
  from_date: string | null;
  to_date: string | null;
}

function getLeaveDurationLabel(leave: LeaveInfo): string {
  if (!leave.to_date || leave.from_date === leave.to_date) {
    return "Today only";
  }

  return `Until ${format(parseISO(normalizeDate(leave.to_date)), "MMM d")}`;
}

export function WhosOut() {
  const today = new Date().toISOString().split("T")[0];

  const { data: whosOut = [], isLoading } = useQuery({
    queryKey: ["whos-out-today", today],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: any[] }>(
        `/api/leave/requests?status=approved&activeOn=${today}`
      );
      const leaves = res.data ?? [];
      if (leaves.length === 0) return [];

      return leaves.map((leave: any): LeaveInfo => ({
        id: leave.id,
        employee_name: leave.employee_name
          ? leave.employee_name
          : `${leave.first_name ?? ""} ${leave.last_name ?? ""}`.trim() || "Unknown",
        employee_avatar: leave.avatar_url ?? undefined,
        leave_type: leave.leave_type_name ?? leave.leave_type ?? "Leave",
        from_date: leave.from_date,
        to_date: leave.to_date,
      }));
    },
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <UserX className="h-5 w-5 text-warning" />
          Who's Out Today
          {whosOut.length > 0 && (
            <Badge variant="secondary" className="ml-auto">
              {whosOut.length}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : whosOut.length > 0 ? (
          <div className="space-y-3">
            {whosOut.map((leave) => (
              <div
                key={leave.id}
                className="flex items-center gap-3 rounded-lg bg-muted/50 p-2"
              >
                <Avatar className="h-8 w-8">
                  <AvatarImage src={leave.employee_avatar} />
                  <AvatarFallback className="text-xs">
                    {leave.employee_name
                      .split(" ")
                      .map((n) => n[0])
                      .join("")}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{leave.employee_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {getLeaveDurationLabel(leave)}
                  </p>
                </div>
                <Badge variant="outline" className="text-xs shrink-0">
                  {leave.leave_type}
                </Badge>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">
            Everyone is in today! 🎉
          </p>
        )}
      </CardContent>
    </Card>
  );
}
