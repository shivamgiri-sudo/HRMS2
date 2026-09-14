import { CheckCircle2, Circle, Clock, Calendar } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn, normalizeDate } from "@/lib/utils";

interface DevPlanGoal {
  id: string;
  title: string;
  description?: string;
  target_date: string;
  status: "not_started" | "in_progress" | "completed" | "overdue";
  progress?: number;
}

interface DevPlanTimelineProps {
  goals: DevPlanGoal[];
  className?: string;
}

export function DevPlanTimeline({ goals, className }: DevPlanTimelineProps) {
  const sortedGoals = [...goals].sort(
    (a, b) => new Date(normalizeDate(a.target_date)).getTime() - new Date(normalizeDate(b.target_date)).getTime()
  );

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "text-emerald-600 bg-emerald-50 border-emerald-200";
      case "in_progress":
        return "text-blue-600 bg-blue-50 border-blue-200";
      case "overdue":
        return "text-rose-600 bg-rose-50 border-rose-200";
      default:
        return "text-muted-foreground bg-muted border-muted";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <CheckCircle2 className="h-5 w-5 text-emerald-600" />;
      case "in_progress":
        return <Clock className="h-5 w-5 text-blue-600" />;
      case "overdue":
        return <Circle className="h-5 w-5 text-rose-600" />;
      default:
        return <Circle className="h-5 w-5 text-muted-foreground" />;
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "completed":
        return "Completed";
      case "in_progress":
        return "In Progress";
      case "overdue":
        return "Overdue";
      case "not_started":
        return "Not Started";
      default:
        return status;
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(normalizeDate(dateString));
    return date.toLocaleDateString("en-IN", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "Asia/Kolkata",
    });
  };

  const getDaysUntil = (dateString: string) => {
    const today = new Date();
    const targetDate = new Date(normalizeDate(dateString));
    const diffTime = targetDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) return `${Math.abs(diffDays)} days overdue`;
    if (diffDays === 0) return "Due today";
    if (diffDays === 1) return "Due tomorrow";
    return `${diffDays} days remaining`;
  };

  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader className="border-b bg-muted/30">
        <CardTitle className="flex items-center gap-2">
          <Calendar className="h-5 w-5 text-primary" />
          Development Plan Timeline
        </CardTitle>
      </CardHeader>

      <CardContent className="p-6">
        {sortedGoals.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Circle className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p className="text-sm">No development goals added yet</p>
          </div>
        ) : (
          <div className="space-y-6">
            {sortedGoals.map((goal, index) => (
              <div key={goal.id} className="relative">
                {/* Timeline connector line */}
                {index < sortedGoals.length - 1 && (
                  <div className="absolute left-[19px] top-10 bottom-0 w-0.5 bg-border -translate-x-1/2" />
                )}

                <div className="flex gap-4">
                  {/* Status Icon */}
                  <div className="relative z-10 flex-shrink-0 mt-1">
                    <div
                      className={cn(
                        "flex items-center justify-center w-10 h-10 rounded-full border-2 bg-background",
                        goal.status === "completed"
                          ? "border-emerald-500"
                          : goal.status === "in_progress"
                          ? "border-blue-500"
                          : goal.status === "overdue"
                          ? "border-rose-500"
                          : "border-muted"
                      )}
                    >
                      {getStatusIcon(goal.status)}
                    </div>
                  </div>

                  {/* Goal Content */}
                  <div className="flex-1 pb-4 space-y-2">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1 flex-1">
                        <h4 className="font-semibold text-base leading-tight">
                          {goal.title}
                        </h4>
                        {goal.description && (
                          <p className="text-sm text-muted-foreground leading-relaxed">
                            {goal.description}
                          </p>
                        )}
                      </div>

                      <Badge
                        variant="outline"
                        className={cn("text-xs font-semibold", getStatusColor(goal.status))}
                      >
                        {getStatusLabel(goal.status)}
                      </Badge>
                    </div>

                    {/* Progress bar */}
                    {goal.progress !== undefined && goal.status !== "completed" && (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">Progress</span>
                          <span className="font-medium">{goal.progress}%</span>
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className={cn(
                              "h-full transition-all duration-500 rounded-full",
                              goal.status === "in_progress"
                                ? "bg-blue-500"
                                : "bg-muted-foreground"
                            )}
                            style={{ width: `${goal.progress}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Target Date */}
                    <div className="flex items-center gap-4 text-xs">
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Calendar className="h-3.5 w-3.5" />
                        <span>Target: {formatDate(goal.target_date)}</span>
                      </div>

                      <div
                        className={cn(
                          "flex items-center gap-1.5 font-medium",
                          goal.status === "overdue"
                            ? "text-rose-600"
                            : goal.status === "completed"
                            ? "text-emerald-600"
                            : "text-muted-foreground"
                        )}
                      >
                        <Clock className="h-3.5 w-3.5" />
                        <span>
                          {goal.status === "completed"
                            ? "Completed"
                            : getDaysUntil(goal.target_date)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
