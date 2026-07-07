import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowUpRight, GraduationCap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { hrmsApi } from "@/lib/hrmsApi";

export function TrainingWidget() {
  const { data: wfData, isLoading } = useQuery<any>({
    queryKey: ["dashboard-workforce-training"],
    queryFn: () => hrmsApi.get("/api/management/workforce-dashboard"),
    staleTime: 1000 * 60 * 5,
  });

  const training = wfData?.data?.training;

  const rows = [
    { label: "Analysts in Training", value: training?.analysts_in_training ?? 0 },
    { label: "Onboarding in Progress", value: training?.onboarding_in_progress ?? 0 },
    { label: "LMS Active Learners", value: training?.lms_in_progress ?? 0 },
  ];

  return (
    <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
      <CardHeader className="border-b border-slate-100 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-100 text-cyan-600">
            <GraduationCap className="h-4 w-4" />
          </div>
          <div>
            <CardTitle className="text-sm font-bold text-slate-900">Training & Onboarding</CardTitle>
            <p className="text-[10px] text-slate-500">Current batch status</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4 space-y-3">
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-full" />
          </div>
        ) : (
          <>
            {rows.map((row) => (
              <div key={row.label} className="flex items-center justify-between">
                <span className="text-xs text-slate-500">{row.label}</span>
                <span className="text-sm font-black text-slate-800 tabular-nums" style={{ fontFamily: "'Fira Code', monospace" }}>
                  {row.value}
                </span>
              </div>
            ))}
            <Link
              to="/lms"
              className="flex items-center justify-center gap-2 rounded-xl bg-cyan-50 border border-cyan-200 px-3 py-2 text-xs font-semibold text-cyan-700 hover:bg-cyan-100 transition"
            >
              LMS Dashboard <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </>
        )}
      </CardContent>
    </Card>
  );
}
