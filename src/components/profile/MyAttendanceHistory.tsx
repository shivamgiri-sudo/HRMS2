import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { hrmsApi } from "@/lib/hrmsApi";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Clock, MapPin, CalendarDays, Coffee } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { calculateTotalBreakHours, AttendanceBreak } from "@/hooks/useAttendanceBreaks";

interface MyAttendanceHistoryProps {
  employeeId: string;
}

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

const statusStyles: Record<string, string> = {
  present: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  late: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  absent: "bg-destructive/10 text-destructive border-destructive/20",
  "half-day": "bg-sky-500/10 text-sky-600 border-sky-500/20",
};

export function MyAttendanceHistory({ employeeId }: MyAttendanceHistoryProps) {
  const { data: records, isLoading } = useQuery({
    queryKey: ["my-attendance-history", employeeId],
    queryFn: async () => {
      const res = await hrmsApi.get<{success:boolean;data:any}>("/api/wfm/attendance/daily");
      return (res.data ?? []) as AttendanceRecord[];
    },
    enabled: !!employeeId,
  });

  // Fetch breaks for all records
  const recordIds = records?.map(r => r.id) || [];
  const { data: allBreaks } = useQuery({
    queryKey: ["my-attendance-breaks", recordIds],
    queryFn: async () => {
      if (recordIds.length === 0) return [];
      const res = await hrmsApi.get<{success:boolean;data:any}>("/api/wfm/attendance/daily");
      return (res.data ?? []) as unknown as AttendanceBreak[];
    },
    enabled: recordIds.length > 0,
  });

  const getBreaksForRecord = (recordId: string) => {
    return (allBreaks || []).filter(b => b.attendance_record_id === recordId);
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Attendance History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const formatTime = (timestamp: string | null) => {
    if (!timestamp) return "-";
    return format(new Date(timestamp), "h:mm a");
  };

  const formatHours = (hours: number | null) => {
    if (hours === null) return "-";
    return `${hours.toFixed(1)}h`;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5" />
          Attendance History
        </CardTitle>
        <CardDescription>Your recent attendance records (last 30 days)</CardDescription>
      </CardHeader>
      <CardContent>
        {records && records.length > 0 ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Clock In</TableHead>
                  <TableHead>Clock Out</TableHead>
                  <TableHead>Breaks</TableHead>
                  <TableHead>Hours</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((record) => (
                  <TableRow key={record.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <CalendarDays className="h-4 w-4 text-muted-foreground" />
                        {format(new Date(record.date), "MMM d, yyyy")}
                      </div>
                    </TableCell>
                    <TableCell>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger className="flex items-center gap-1">
                            {formatTime(record.clock_in)}
                            {record.clock_in_location_name && (
                              <MapPin className="h-3 w-3 text-muted-foreground" />
                            )}
                          </TooltipTrigger>
                          {record.clock_in_location_name && (
                            <TooltipContent>
                              <p>{record.clock_in_location_name}</p>
                            </TooltipContent>
                          )}
                        </Tooltip>
                      </TooltipProvider>
                    </TableCell>
                    <TableCell>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger className="flex items-center gap-1">
                            {formatTime(record.clock_out)}
                            {record.clock_out_location_name && (
                              <MapPin className="h-3 w-3 text-muted-foreground" />
                            )}
                          </TooltipTrigger>
                          {record.clock_out_location_name && (
                            <TooltipContent>
                              <p>{record.clock_out_location_name}</p>
                            </TooltipContent>
                          )}
                        </Tooltip>
                      </TooltipProvider>
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const breaks = getBreaksForRecord(record.id);
                        if (breaks.length === 0) return "-";
                        const totalHrs = calculateTotalBreakHours(breaks);
                        return (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger>
                                <Badge variant="outline" className="text-xs">
                                  <Coffee className="h-3 w-3 mr-1" />
                                  {breaks.length} · {totalHrs.toFixed(1)}h
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>{breaks.length} break{breaks.length > 1 ? 's' : ''}, {totalHrs.toFixed(1)}h total</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        );
                      })()}
                    </TableCell>
                    <TableCell>{formatHours(record.total_hours)}</TableCell>
                    <TableCell>
                      {record.work_mode ? (
                        <Badge variant="outline" className="text-xs">
                          {record.work_mode === "wfh" ? "WFH" : "Office"}
                        </Badge>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={statusStyles[record.status] || ""}>
                        {record.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <Clock className="mx-auto h-8 w-8 mb-2 opacity-50" />
            <p>No attendance records yet</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
