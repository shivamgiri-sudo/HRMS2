import { useQuery } from "@tanstack/react-query";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2 } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";

const COLORS = {
  present: "#3BAD49",
  absent: "#E8231A",
  halfDay: "#F59E0B",
  leave: "#22D3EE",
};

export function AttendanceDonutChart() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["dashboard-attendance"],
    queryFn: () => hrmsApi.get("/api/management/workforce-dashboard"),
    staleTime: 1000 * 60 * 5,
  });

  const att = data?.data?.attendance;
  const chartData = att
    ? [
        { name: "Present", value: att.present ?? 0, fill: COLORS.present },
        { name: "Absent", value: att.absent ?? 0, fill: COLORS.absent },
        { name: "Half Day", value: att.half_day ?? 0, fill: COLORS.halfDay },
        { name: "On Leave", value: att.on_leave ?? 0, fill: COLORS.leave },
      ].filter((d) => d.value > 0)
    : [];

  const total = chartData.reduce((sum, d) => sum + d.value, 0);

  return (
    <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
      <CardHeader className="flex flex-row items-start justify-between border-b border-slate-100 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600">
            <CheckCircle2 className="h-4 w-4" />
          </div>
          <div>
            <CardTitle className="text-base font-bold text-slate-900">Attendance Today</CardTitle>
            <p className="mt-0.5 text-xs text-slate-500">Live snapshot</p>
          </div>
        </div>
        <Link to="/attendance" className="text-xs font-semibold text-[#1B6AB5] hover:underline">View Attendance →</Link>
      </CardHeader>
      <CardContent className="p-4">
        {isLoading ? (
          <Skeleton className="h-48 w-full rounded-xl" />
        ) : chartData.length === 0 ? (
          <div className="flex h-48 items-center justify-center text-sm text-slate-400">No attendance data</div>
        ) : (
          <div className="flex items-center gap-4">
            <ResponsiveContainer width="50%" height={160}>
              <PieChart>
                <Pie data={chartData} dataKey="value" cx="50%" cy="50%" innerRadius={40} outerRadius={70} paddingAngle={2}>
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: "#0f172a", border: "none", borderRadius: "10px", color: "#f1f5f9", fontSize: 12 }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex-1 space-y-2">
              {chartData.map((d) => (
                <div key={d.name} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: d.fill }} />
                    <span className="text-xs text-slate-600">{d.name}</span>
                  </div>
                  <span className="text-xs font-bold text-slate-900 tabular-nums" style={{ fontFamily: "'Fira Code', monospace" }}>
                    {d.value}
                  </span>
                </div>
              ))}
              <div className="pt-2 border-t border-slate-100">
                <span className="text-[10px] text-slate-400">Total: {total}</span>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
