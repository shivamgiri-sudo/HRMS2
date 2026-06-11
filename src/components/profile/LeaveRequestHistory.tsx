import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ClipboardList, Loader2 } from "lucide-react";
import { format } from "date-fns";

interface LeaveRequestHistoryProps {
  employeeId: string;
}

interface LeaveRequest {
  id: string;
  start_date: string;
  end_date: string;
  days_count: number;
  reason: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  created_at: string;
  leave_types: { name: string } | null;
}

const statusStyles: Record<string, string> = {
  pending: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  approved: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  rejected: "bg-destructive/10 text-destructive border-destructive/20",
  cancelled: "bg-muted text-muted-foreground border-border",
};

export function LeaveRequestHistory({ employeeId }: LeaveRequestHistoryProps) {
  const { data: requests, isLoading } = useQuery({
    queryKey: ["leave-requests", employeeId],
    queryFn: async () => {
      const res = await hrmsApi.get<{success:boolean;data:any}>("/api/leave/requests");
      return (res.data ?? []) as LeaveRequest[];
    },
    enabled: !!employeeId,
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const pendingRequests = requests?.filter((r) => r.status === "pending") || [];
  const pastRequests = requests?.filter((r) => r.status !== "pending") || [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardList className="h-5 w-5" />
          Leave Requests
        </CardTitle>
        <CardDescription>Track your submitted leave requests</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Pending Requests */}
        {pendingRequests.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-3">Pending Approval ({pendingRequests.length})</h4>
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Dates</TableHead>
                    <TableHead>Days</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingRequests.map((request) => (
                    <TableRow key={request.id}>
                      <TableCell className="font-medium">
                        {request.leave_types?.name || "Leave"}
                      </TableCell>
                      <TableCell>
                        {format(new Date(request.start_date), "MMM d")} - {format(new Date(request.end_date), "MMM d, yyyy")}
                      </TableCell>
                      <TableCell>{request.days_count}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={statusStyles[request.status]}>
                          {request.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        {/* Past Requests */}
        {pastRequests.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-3">Past Requests ({pastRequests.length})</h4>
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Dates</TableHead>
                    <TableHead>Days</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pastRequests.map((request) => (
                    <TableRow key={request.id}>
                      <TableCell className="font-medium">
                        {request.leave_types?.name || "Leave"}
                      </TableCell>
                      <TableCell>
                        {format(new Date(request.start_date), "MMM d")} - {format(new Date(request.end_date), "MMM d, yyyy")}
                      </TableCell>
                      <TableCell>{request.days_count}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={statusStyles[request.status]}>
                          {request.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        {(!requests || requests.length === 0) && (
          <div className="text-center py-6 text-muted-foreground">
            <ClipboardList className="mx-auto h-8 w-8 mb-2 opacity-50" />
            <p>No leave requests yet</p>
            <p className="text-sm">Submit a request using the form</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
