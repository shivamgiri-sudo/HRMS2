import { AlertTriangle, TrendingUp, Target, AlertCircle, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Insight {
  id: string;
  type: "warning" | "success" | "info" | "critical";
  title: string;
  description: string;
  metric?: string;
  action?: string;
}

interface InsightPanelProps {
  insights: Insight[];
  className?: string;
}

export function InsightPanel({ insights, className }: InsightPanelProps) {
  const getInsightIcon = (type: Insight["type"]) => {
    switch (type) {
      case "warning":
        return <AlertTriangle className="h-5 w-5 text-amber-600" />;
      case "success":
        return <TrendingUp className="h-5 w-5 text-emerald-600" />;
      case "info":
        return <Info className="h-5 w-5 text-blue-600" />;
      case "critical":
        return <AlertCircle className="h-5 w-5 text-rose-600" />;
      default:
        return <Target className="h-5 w-5 text-slate-500" />;
    }
  };

  const getInsightStyle = (type: Insight["type"]) => {
    switch (type) {
      case "warning":
        return "border-l-4 border-l-amber-500 bg-amber-50";
      case "success":
        return "border-l-4 border-l-emerald-500 bg-emerald-50";
      case "info":
        return "border-l-4 border-l-blue-500 bg-blue-50";
      case "critical":
        return "border-l-4 border-l-rose-500 bg-rose-50";
      default:
        return "border-l-4 border-l-slate-500 bg-slate-50";
    }
  };

  const getBadgeVariant = (type: Insight["type"]): "default" | "secondary" | "destructive" | "outline" => {
    switch (type) {
      case "warning":
        return "outline";
      case "success":
        return "secondary";
      case "critical":
        return "destructive";
      default:
        return "default";
    }
  };

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-lg font-bold text-slate-900">
          Key Insights
        </CardTitle>
        <p className="text-sm text-slate-500">
          Auto-generated insights and recommendations
        </p>
      </CardHeader>
      <CardContent>
        {insights.length > 0 ? (
          <div className="space-y-3">
            {insights.map((insight) => (
              <div
                key={insight.id}
                className={`rounded-lg p-4 ${getInsightStyle(insight.type)}`}
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white shadow-sm">
                    {getInsightIcon(insight.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="text-sm font-bold text-slate-900">
                        {insight.title}
                      </h4>
                      {insight.metric && (
                        <Badge variant={getBadgeVariant(insight.type)} className="text-xs shrink-0">
                          {insight.metric}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-slate-700">
                      {insight.description}
                    </p>
                    {insight.action && (
                      <button className="mt-2 text-xs font-semibold text-blue-600 hover:text-blue-700 hover:underline">
                        {insight.action} →
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex h-[150px] items-center justify-center text-slate-500">
            No insights available
          </div>
        )}
      </CardContent>
    </Card>
  );
}
