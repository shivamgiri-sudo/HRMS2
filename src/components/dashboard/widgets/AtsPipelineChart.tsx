import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { hrmsApi } from "@/lib/hrmsApi";

const BLUE_SHADES = ["#1B6AB5", "#2D86D4", "#40A3F5", "#7CC2FF", "#B3DAFF", "#D6ECFF"];

export function AtsPipelineChart() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["dashboard-ats-pipeline"],
    queryFn: () => hrmsApi.get("/api/management/workforce-dashboard"),
    staleTime: 1000 * 60 * 5,
  });

  const pipeline: Array<{ stage: string; value: number }> = data?.data?.pipeline ?? [];
  const chartData = pipeline.map((p, i) => ({ ...p, fill: BLUE_SHADES[i % BLUE_SHADES.length] }));

  return (
    <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
      <CardHeader className="flex flex-row items-start justify-between border-b border-slate-100 pb-4">
        <div>
          <CardTitle className="text-base font-bold text-slate-900">ATS Hiring Pipeline</CardTitle>
          <p className="mt-0.5 text-xs text-slate-500">Candidates by stage</p>
        </div>
        <Link to="/ats/command-center" className="text-xs font-semibold text-[#1B6AB5] hover:underline">View ATS →</Link>
      </CardHeader>
      <CardContent className="p-4">
        {isLoading ? (
          <Skeleton className="h-40 w-full rounded-xl" />
        ) : chartData.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-sm text-slate-400">No pipeline data</div>
        ) : (
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={chartData} layout="vertical" barSize={14}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
              <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="stage" tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} width={110} />
              <Tooltip
                contentStyle={{ backgroundColor: "#0f172a", border: "none", borderRadius: "10px", color: "#f1f5f9", fontSize: 12 }}
                cursor={{ fill: "rgba(0,0,0,0.04)" }}
              />
              <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                {chartData.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
