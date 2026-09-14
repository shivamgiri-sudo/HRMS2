import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { hrmsApi } from "@/lib/hrmsApi";

const STAGE_COLORS: Record<string, string> = {
  new: "#1B6AB5",
  screening: "#3BAD49",
  interview: "#F59E0B",
  assessment: "#8B5CF6",
  offer: "#22D3EE",
  selected: "#10b981",
  on_hold: "#94a3b8",
  rejected: "#E8231A",
};

export function RecruitmentFunnelWidget() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["dashboard-ats-stats"],
    queryFn: () => hrmsApi.get("/api/ats/stats"),
    staleTime: 1000 * 60 * 5,
  });

  const pipeline: any[] = data?.data?.pipeline ?? [];
  const chartData = pipeline
    .filter(p => p.value > 0)
    .map(p => ({
      name: (p.stage ?? "").replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
      value: p.value,
      fill: STAGE_COLORS[(p.stage ?? "").toLowerCase()] ?? "#94a3b8",
    }));

  const total = chartData.reduce((s, d) => s + d.value, 0);

  return (
    <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
      <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100 pb-4 pt-5 px-5">
        <div>
          <CardTitle className="text-sm font-bold text-slate-900">Candidate Pipeline</CardTitle>
          <p className="text-[11px] text-slate-400 mt-0.5">Active candidates by stage</p>
        </div>
        <Link to="/ats/command-center" className="text-xs font-semibold text-[#1B6AB5] hover:underline">View ATS →</Link>
      </CardHeader>
      <CardContent className="p-5">
        {isLoading ? <Skeleton className="h-48 w-full rounded-xl" /> : chartData.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-8">No pipeline data</p>
        ) : (
          <div className="flex items-center gap-5">
            <div className="relative flex-shrink-0">
              <ResponsiveContainer width={130} height={130}>
                <PieChart>
                  <Pie data={chartData} dataKey="value" cx="50%" cy="50%" innerRadius={35} outerRadius={58} paddingAngle={2}>
                    {chartData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                  </Pie>
                  <Tooltip contentStyle={{ backgroundColor: "#0f172a", border: "none", borderRadius: "10px", color: "#f1f5f9", fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <p className="text-lg font-bold text-slate-900" style={{ fontFamily: "'Fira Code', monospace" }}>{total}</p>
                <p className="text-[9px] text-slate-500 uppercase tracking-wide">Total</p>
              </div>
            </div>
            <div className="flex-1 space-y-1.5">
              {chartData.map((d, i) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: d.fill }} />
                    <span className="text-xs text-slate-600">{d.name}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-slate-800 tabular-nums" style={{ fontFamily: "'Fira Code', monospace" }}>{d.value}</span>
                    <span className="text-[10px] text-slate-400">{total > 0 ? `${((d.value / total) * 100).toFixed(0)}%` : ""}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
