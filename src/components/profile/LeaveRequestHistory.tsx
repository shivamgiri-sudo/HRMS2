import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ClipboardList, Loader2 } from "lucide-react";
import { format, parseISO } from "date-fns";
import { normalizeDate } from "@/lib/utils";

interface LeaveRequestHistoryProps {
  employeeId: string;
}

interface LeaveRequest {
  id: string | number;
  from_date: string;
  to_date: string;
  total_days: number;
  reason: string | null;
  status: "pending" | "pending_branch_head" | "approved" | "rejected" | "cancelled";
  created_at?: string;
  applied_at?: string;
  leave_type_name: string | null;
  leave_type_code?: string | null;
  source?: "hrms" | "legacy";
}

const statusStyles: Record<string, string> = {
  pending: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  pending_branch_head: "bg-orange-500/10 text-orange-600 border-orange-500/20",
  approved: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  rejected: "bg-destructive/10 text-destructive border-destructive/20",
  cancelled: "bg-muted text-muted-foreground border-border",
};

const statusLabel: Record<string, string> = {
  pending: "Pending",
  pending_branch_head: "Awaiting Branch Head",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

function safeFormat(dateStr: string | null | undefined, fmt: string, fallback = "—"): string {
  if (!dateStr) return fallback;
  try {
    return format(parseISO(normalizeDate(dateStr)), fmt);
  } catch {
    return fallback;
  }
}

export function LeaveRequestHistory({ employeeId }: LeaveRequestHistoryProps) {
  const { data: hrmsRequests, isLoading: loadingHrms } = useQuery({
    queryKey: ["leave-requests", employeeId],
    queryFn: async () => {
      const res = await hrmsApi.get<{success:boolean;data:any}>(`/api/leave/requests?employeeId=${employeeId}`);
      return ((res.data ?? []) as LeaveRequest[]).map(r => ({ ...r, source: "hrms" as const }));
    },
    enabled: !!employeeId,
  });

  const { data: legacyRequests, isLoading: loadingLegacy } = useQuery({
    queryKey: ["leave-requests-legacy", employeeId],
    queryFn: async () => {
      const res = await hrmsApi.get<{success:boolean;data:any}>(`/api/leave/requests/legacy?employeeId=${employeeId}`);
      return ((res.data ?? []) as LeaveRequest[]).map(r => ({
        ...r,
        leave_type_name: r.leave_type_code ?? null,
        source: "legacy" as const,
      }));
    },
    enabled: !!employeeId,
  });

  const isLoading = loadingHrms || loadingLegacy;

  // Merge: hrms requests take priority; de-dup by legacy_leave_id if present
  const hrmsLegacyIds = new Set(
    (hrmsRequests ?? []).map((r: any) => r.legacy_leave_id).filter(Boolean)
  );
  const filteredLegacy = (legacyRequests ?? []).filter(r => !hrmsLegacyIds.has(r.id));
  const requests: LeaveRequest[] = [
    ...(hrmsRequests ?? []),
    ...filteredLegacy,
  ].sort((a, b) => new Date(normalizeDate(b.from_date)).getTime() - new Date(normalizeDate(a.from_date)).getTime());

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const pendingRequests = requests?.filter((r) =>
    r.status === "pending" || r.status === "pending_branch_head"
  ) || [];
  const pastRequests = requests?.filter((r) =>
    r.status !== "pending" && r.status !== "pending_branch_head"
  ) || [];

  const renderTable = (items: LeaveRequest[]) => (
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
          {items.map((request) => (
            <TableRow key={request.id}>
              <TableCell className="font-medium">
                {request.leave_type_name || "Leave"}
              </TableCell>
              <TableCell>
                {safeFormat(request.from_date, "MMM d")} –{" "}
                {safeFormat(request.to_date, "MMM d, yyyy")}
              </TableCell>
              <TableCell>{request.total_days}</TableCell>
              <TableCell>
                <Badge
                  variant="outline"
                  className={statusStyles[request.status] ?? ""}
                >
                  {statusLabel[request.status] ?? request.status}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );

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
        {pendingRequests.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-3">
              Pending Approval ({pendingRequests.length})
            </h4>
            {renderTable(pendingRequests)}
          </div>
        )}

        {pastRequests.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-3">
              Past Requests ({pastRequests.length})
            </h4>
            {renderTable(pastRequests)}
          </div>
        )}

        {(!requests || requests.length === 0) && (
          <div className="text-center py-6 text-muted-foreground">
            <ClipboardList className="mx-auto h-8 w-8 mb-2 opacity-50" />
            <p>No leave requests yet</p>
            <p className="text-sm">Submit a request using the form above</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
