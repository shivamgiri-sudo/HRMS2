import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistanceToNow } from "date-fns";
import { Activity } from "lucide-react";

interface ActivityItem {
  id: string;
  userName: string;
  avatarUrl?: string;
  action: string;
  type: string;
  status: "pending" | "completed" | "approved" | "rejected" | "created";
  createdAt: string;
}

const statusStyles = {
  pending: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  completed: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  approved: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  rejected: "bg-destructive/10 text-destructive border-destructive/20",
  created: "bg-primary/10 text-primary border-primary/20",
};

const getInitials = (name: string) => {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
};

async function fetchActivityFromAuditLog(): Promise<ActivityItem[]> {
  const res = await hrmsApi.get<{ data: any[] }>("/api/access/audit-log?limit=10");
  const logs = res.data ?? [];

  return logs.map((log: any): ActivityItem => {
    const details =
      typeof log.details === "object" && log.details !== null
        ? (log.details as Record<string, unknown>)
        : null;

    const employeeName =
      (details?.employee_name as string) ||
      (log.actor_name as string) ||
      "Someone";

    let status: ActivityItem["status"] = "completed";
    const action = String(log.action ?? "").toLowerCase();
    if (action.includes("approved") || action === "approved") status = "approved";
    else if (action.includes("rejected") || action === "rejected") status = "rejected";
    else if (action.includes("pending") || action === "pending") status = "pending";
    else if (action.includes("created") || action === "created") status = "created";

    const entityName =
      (details?.leave_type as string) ||
      (details?.asset_name as string) ||
      (details?.name as string) ||
      String(log.entity_type ?? "activity").replace(/_/g, " ");

    let formattedAction = action.replace(/_/g, " ");
    let type = entityName;

    if (log.entity_type === "leave_request") {
      if (status === "approved") {
        formattedAction = "'s leave request was approved";
        type = `(${entityName})`;
      } else if (status === "rejected") {
        formattedAction = "'s leave request was rejected";
        type = `(${entityName})`;
      } else {
        formattedAction = "requested";
        type = `${entityName} leave`;
      }
    } else if (log.entity_type === "attendance") {
      formattedAction = action.includes("out") ? "clocked out" : "clocked in";
      type = "";
    } else if (log.entity_type === "asset_assignment") {
      formattedAction = action.includes("return") ? "returned" : "was assigned";
      type = String(details?.asset_name ?? "an asset");
    }

    return {
      id: log.id,
      userName: employeeName,
      action: formattedAction,
      type,
      status,
      createdAt: log.created_at ?? log.timestamp ?? new Date().toISOString(),
    };
  });
}

export function RecentActivity() {
  const { data: activities, isLoading } = useQuery({
    queryKey: ["recent-activity"],
    queryFn: async () => {
      try {
        const logs = await fetchActivityFromAuditLog();
        if (logs.length > 0) return logs;
      } catch { /* fall through to empty */ }
      return [] as ActivityItem[];
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            Recent Activity
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center gap-4 p-3">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/4" />
              </div>
              <Skeleton className="h-6 w-16" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  if (!activities || activities.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            Recent Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Activity className="h-10 w-10 text-muted-foreground/50 mb-3" />
            <p className="text-sm text-muted-foreground">No recent activity</p>
            <p className="text-xs text-muted-foreground mt-1">
              Activities will appear here as actions are performed
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-semibold flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          Recent Activity
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {activities.map((activity) => {
          const timeAgo = formatDistanceToNow(new Date(activity.createdAt), { addSuffix: true });

          return (
            <div
              key={activity.id}
              className="flex items-center gap-3 rounded-xl p-3 transition-colors hover:bg-muted/50"
            >
              <Avatar className="h-9 w-9">
                <AvatarFallback>{getInitials(activity.userName)}</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm">
                  <span className="font-medium text-foreground">{activity.userName}</span>{" "}
                  <span className="text-muted-foreground">{activity.action}</span>{" "}
                  <span className="font-medium text-foreground">{activity.type}</span>
                </p>
                <p className="text-xs text-muted-foreground">{timeAgo}</p>
              </div>
              <Badge
                variant="outline"
                className={statusStyles[activity.status] || statusStyles.completed}
              >
                {activity.status}
              </Badge>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
