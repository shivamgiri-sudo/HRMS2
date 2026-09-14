import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { GraduationCap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { hrmsApi } from "@/lib/hrmsApi";

export function TrainingProgressWidget() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["engagement-me"],
    queryFn: () => hrmsApi.get("/api/engagement/me"),
    staleTime: 1000 * 60 * 5,
  });
  const eng = data?.data ?? {};
  const badges: any[] = Array.isArray(eng.badges_earned) ? eng.badges_earned : [];
  const progress = eng.progress_percentage ?? 0;

  const items = [
    { label: "Engagement Points", value: `${(eng.total_points ?? 0).toLocaleString()} pts`, pct: Math.min(progress, 100), color: "bg-violet-500" },
    { label: eng.current_tier?.tier_name ? `${eng.current_tier.tier_name} Tier` : "Current Tier", value: `${badges.length} badges`, pct: Math.min(badges.length * 25, 100), color: "bg-blue-500" },
  ];

  return (
    <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
      <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100 pb-4 pt-5 px-5">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-violet-50 border border-violet-100 flex items-center justify-center">
            <GraduationCap className="w-3.5 h-3.5 text-violet-600" />
          </div>
          <CardTitle className="text-sm font-bold text-slate-900">Training Progress</CardTitle>
        </div>
        <Link to="/lms" className="text-xs font-semibold text-[#1B6AB5] hover:underline">View All →</Link>
      </CardHeader>
      <CardContent className="p-5 space-y-4">
        {isLoading ? <Skeleton className="h-20 w-full rounded-xl" /> : (
          items.map((item, i) => (
            <div key={i} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700">{item.label}</span>
                <span className="text-xs font-bold text-slate-800" style={{ fontFamily: "'Fira Code', monospace" }}>{item.value}</span>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className={`h-full ${item.color} rounded-full transition-all duration-500`} style={{ width: `${item.pct}%` }} />
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
