import { useQuery } from "@tanstack/react-query";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { hrmsApi } from "@/lib/hrmsApi";

const COLOR_MAP: Record<string, string> = {
  present: "#3BAD49",
  half_day: "#F59E0B",
  absent: "#E8231A",
  leave_approved: "#818CF8",
  week_off: "#64748B",
  holiday: "#22D3EE",
  unreconciled: "#D97706",
};

export function AttendanceDonut() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["dashboard-workforce-attendance"],
    queryFn: () => hrmsApi.get("/api/management/workforce-dashboard"),
    staleTime: 1000 * 60 * 5,
  });

  const statuses: Array<{ label: string; value: number }> = data?.data?.attendance?.statuses ?? [];
  const chartData = statuses
    .filter((s) => s.value > 0)
    .map((s) => ({ name: s.label, value: s.value, fill: COLOR_MAP[s.label] ?? "#64748B" }));

  return (
    <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
      <CardHeader className="border-b border-slate-100 pb-4">
        <CardTitle className="text-base font-bold text-slate-900">Attendance Today</CardTitle>
        <p className="text-xs text-slate-500">Status distribution</p>
      </CardHeader>
      <CardContent className="p-4">
        {isLoading ? (
          <Skeleton className="h-48 w-full rounded-xl" />
        ) : chartData.length === 0 ? (
          <div className="flex h-48 items-center justify-center text-sm text-slate-400">No attendance data</div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie data={chartData} cx="50%" cy="50%" innerRadius={48} outerRadius={72} paddingAngle={3} dataKey="value">
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: "#0f172a", border: "none", borderRadius: "10px", color: "#f1f5f9", fontSize: 12 }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="mt-3 grid grid-cols-2 gap-1.5">
              {chartData.map((d) => (
                <div key={d.name} className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: d.fill }} />
                  <span className="text-[10px] text-slate-500 truncate capitalize">{d.name.replace(/_/g, " ")}</span>
                  <span className="ml-auto text-[10px] font-bold text-slate-700">{d.value}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
