import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ClipboardList, ArrowRight } from "lucide-react";
import { usePendingApprovals } from "@/hooks/usePendingApprovals";
import { Skeleton } from "@/components/ui/skeleton";
import { useNavigate } from "react-router-dom";
import { formatDate } from "@/lib/utils";

export function PendingApprovalsWidget() {
  const { data, isLoading } = usePendingApprovals();
  const navigate = useNavigate();

  // Don't render if user has no direct reports
  if (!isLoading && data?.count === 0 && data?.requests.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-lg font-semibold flex items-center gap-2">
          <ClipboardList className="h-5 w-5 text-warning" />
          Pending Approvals
        </CardTitle>
        {data && data.count > 0 && (
          <Badge variant="secondary" className="bg-warning/10 text-warning">
            {data.count} pending
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <>
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </>
        ) : data?.requests && data.requests.length > 0 ? (
          <>
            {data.requests.slice(0, 3).map((request) => (
              <div
                key={request.id}
                className="flex items-center justify-between p-2 rounded-lg bg-muted/50"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {request.employees?.first_name} {request.employees?.last_name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {request.leave_types?.name} · {request.days_count} day{request.days_count !== 1 ? 's' : ''}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground whitespace-nowrap ml-2">
                  {formatDate(request.start_date, "MMM d") || "Date pending"}
                </span>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              className="w-full mt-2"
              onClick={() => navigate("/leave-approvals")}
            >
              View All
              <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">
            No pending requests
          </p>
        )}
      </CardContent>
    </Card>
  );
}
