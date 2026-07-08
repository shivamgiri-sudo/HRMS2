import { useQuery } from "@tanstack/react-query";
import { Sparkles, ThumbsUp, ThumbsDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { hrmsApi } from "@/lib/hrmsApi";

interface AiBriefingPanelProps {
  dashboardCode?: string;
  title?: string;
  subtitle?: string;
}

export function AiBriefingPanel({
  dashboardCode = "hr",
  title = "AI Briefing",
  subtitle = "AI-analyzed insights based on live data",
}: AiBriefingPanelProps) {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["dashboard-good-bad-insights", dashboardCode],
    queryFn: () => hrmsApi.get(`/api/dashboards/${dashboardCode}/good-bad-insights`),
    staleTime: 1000 * 60 * 5,
  });

  const good: string[] = data?.data?.good ?? [];
  const bad: string[] = data?.data?.bad ?? [];
  const hasData = good.length > 0 || bad.length > 0;

  return (
    <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
      <CardHeader className="border-b border-slate-100 pb-4 pt-5 px-5">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-violet-100 flex items-center justify-center text-violet-600">
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <div>
            <CardTitle className="text-sm font-bold text-slate-900">{title}</CardTitle>
            <p className="text-[11px] text-slate-400 mt-0.5">{subtitle}</p>
          </div>
          <span className="ml-auto text-[10px] font-bold uppercase tracking-wider text-violet-600 bg-violet-50 border border-violet-200 px-2 py-0.5 rounded-full">AI</span>
        </div>
      </CardHeader>
      <CardContent className="p-5">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        ) : !hasData ? (
          <p className="text-sm text-slate-400 text-center py-4">No insights available yet</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {good.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <ThumbsUp className="w-3.5 h-3.5 text-emerald-500" />
                  <p className="text-[11px] font-bold text-emerald-600 uppercase tracking-wider">Good Insights</p>
                </div>
                <ul className="space-y-2">
                  {good.map((item, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                      <p className="text-xs text-slate-600 leading-relaxed">{item}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {bad.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <ThumbsDown className="w-3.5 h-3.5 text-red-500" />
                  <p className="text-[11px] font-bold text-red-600 uppercase tracking-wider">Bad Insights</p>
                </div>
                <ul className="space-y-2">
                  {bad.map((item, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
                      <p className="text-xs text-slate-600 leading-relaxed">{item}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
