import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { hrmsApi } from "@/lib/hrmsApi";

const COLORS = ["#1B6AB5", "#3BAD49", "#F59E0B", "#8B5CF6", "#22D3EE", "#E8231A"];

interface LeaveDonutChartProps {
  employeeId?: string;
  title?: string;
}

export function LeaveDonutChart({ title = "Leave Balance by Type" }: LeaveDonutChartProps) {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["dashboard-leave-balance"],
    queryFn: () => hrmsApi.get("/api/leave/balance"),
    staleTime: 1000 * 60 * 5,
  });

  const items: any[] = Array.isArray(data?.data) ? data.data : [];
  const chartData = items.map((lt, i) => ({
    name: lt.leave_name ?? lt.leave_code,
    value: Number(lt.available_days ?? 0),
    allocated: Number(lt.allocated_days ?? 0),
    used: Number(lt.used_days ?? 0),
    fill: COLORS[i % COLORS.length],
  })).filter(d => d.allocated > 0);

  const totalDays = chartData.reduce((s, d) => s + d.value, 0);

  return (
    <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
      <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100 pb-4 pt-5 px-5">
        <CardTitle className="text-sm font-bold text-slate-900">{title}</CardTitle>
        <Link to="/leaves" className="text-xs font-semibold text-[#1B6AB5] hover:underline">View Details →</Link>
      </CardHeader>
      <CardContent className="p-5">
        {isLoading ? <Skeleton className="h-48 w-full rounded-xl" /> : (
          <div className="flex items-center gap-5">
            <div className="relative flex-shrink-0">
              <ResponsiveContainer width={140} height={140}>
                <PieChart>
                  <Pie data={chartData} dataKey="value" cx="50%" cy="50%" innerRadius={38} outerRadius={62} paddingAngle={2}>
                    {chartData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: "#0f172a", border: "none", borderRadius: "10px", color: "#f1f5f9", fontSize: 12 }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <p className="text-lg font-bold text-slate-900" style={{ fontFamily: "'Fira Code', monospace" }}>{totalDays.toFixed(1)}</p>
                <p className="text-[9px] font-semibold uppercase text-slate-500 tracking-wide">Total</p>
              </div>
            </div>
            <div className="flex-1 space-y-2">
              {chartData.map((d, i) => (
                <div key={i} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: d.fill }} />
                    <span className="text-xs text-slate-600 font-medium">{d.name}</span>
                  </div>
                  <span className="text-xs font-bold text-slate-800 tabular-nums" style={{ fontFamily: "'Fira Code', monospace" }}>
                    {d.value} Days
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
