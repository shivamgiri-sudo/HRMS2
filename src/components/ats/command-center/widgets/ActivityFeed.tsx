import { CheckCircle2, Clock, UserCheck, UserX, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistanceToNow } from "date-fns";

interface ActivityItem {
  id: string;
  type: "selection" | "rejection" | "interview" | "arrival" | "alert";
  candidateName: string;
  action: string;
  timestamp: Date | string;
  branch?: string;
  role?: string;
}

interface ActivityFeedProps {
  activities: ActivityItem[];
  loading?: boolean;
  className?: string;
  maxItems?: number;
}

export function ActivityFeed({
  activities,
  loading,
  className,
  maxItems = 10,
}: ActivityFeedProps) {
  if (loading) {
    return (
      <Card className={className}>
        <CardHeader>
          <Skeleton className="h-6 w-40" />
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-start gap-3">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  const getActivityIcon = (type: ActivityItem["type"]) => {
    switch (type) {
      case "selection":
        return <CheckCircle2 className="h-5 w-5 text-emerald-600" />;
      case "rejection":
        return <UserX className="h-5 w-5 text-rose-600" />;
      case "interview":
        return <UserCheck className="h-5 w-5 text-blue-600" />;
      case "arrival":
        return <Clock className="h-5 w-5 text-amber-600" />;
      case "alert":
        return <AlertCircle className="h-5 w-5 text-rose-600" />;
      default:
        return <Clock className="h-5 w-5 text-slate-500" />;
    }
  };

  const getActivityColor = (type: ActivityItem["type"]) => {
    switch (type) {
      case "selection":
        return "bg-emerald-50 border-emerald-200";
      case "rejection":
        return "bg-rose-50 border-rose-200";
      case "interview":
        return "bg-blue-50 border-blue-200";
      case "arrival":
        return "bg-amber-50 border-amber-200";
      case "alert":
        return "bg-rose-50 border-rose-200";
      default:
        return "bg-slate-50 border-slate-200";
    }
  };

  const displayedActivities = activities.slice(0, maxItems);

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-bold text-slate-900">
            Real-Time Activity
          </CardTitle>
          <Badge variant="outline" className="text-xs">
            Live
          </Badge>
        </div>
        <p className="text-sm text-slate-500">Recent candidate movements</p>
      </CardHeader>
      <CardContent>
        {displayedActivities.length > 0 ? (
          <div className="space-y-3">
            {displayedActivities.map((activity) => {
              const timestamp =
                typeof activity.timestamp === "string"
                  ? new Date(activity.timestamp)
                  : activity.timestamp;

              return (
                <div
                  key={activity.id}
                  className={`flex items-start gap-3 rounded-lg border p-3 transition-all hover:shadow-md ${getActivityColor(
                    activity.type
                  )}`}
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm">
                    {getActivityIcon(activity.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-900 truncate">
                      {activity.candidateName}
                    </p>
                    <p className="text-sm text-slate-600 mt-0.5">{activity.action}</p>
                    {(activity.branch || activity.role) && (
                      <div className="flex items-center gap-2 mt-1">
                        {activity.branch && (
                          <Badge variant="secondary" className="text-xs">
                            {activity.branch}
                          </Badge>
                        )}
                        {activity.role && (
                          <Badge variant="outline" className="text-xs">
                            {activity.role}
                          </Badge>
                        )}
                      </div>
                    )}
                    <p className="text-xs text-slate-500 mt-1">
                      {formatDistanceToNow(timestamp, { addSuffix: true })}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex h-[200px] items-center justify-center text-slate-500">
            No recent activity
          </div>
        )}
      </CardContent>
    </Card>
  );
}
