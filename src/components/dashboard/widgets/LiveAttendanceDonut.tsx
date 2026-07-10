import { useQuery } from "@tanstack/react-query";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { hrmsApi } from "@/lib/hrmsApi";

export function LiveAttendanceDonut() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["wfm-live-attendance"],
    queryFn: () => hrmsApi.get("/api/management/workforce-dashboard"),
    staleTime: 1000 * 60 * 2,
    refetchInterval: 1000 * 60 * 2,
  });

  const summary = data?.data?.summary ?? {};
  const total = summary.active_headcount ?? 0;
  const attPct = summary.attendance_pct ?? 0;
  const present = Math.round((attPct / 100) * total);
  // TODO: Use actual live attendance breakdown from /api/rta/live-summary or /api/wfm/attendance/today-live
  // Current values use fixed percentages (1.8% leave, 18.9% absent, 2.8% WFH, 7.8% late) — these are placeholders
  const onLeave = Math.round(total * 0.018);
  const absent = Math.round(total * 0.189);
  const wfh = Math.round(total * 0.028);
  const late = Math.round(total * 0.078);
  const notMarked = Math.max(0, total - present - onLeave - absent - wfh - late);

  const chartData = [
    { name: "Present",    value: present,   fill: "#3BAD49", pct: attPct.toFixed(1) },
    { name: "Late",       value: late,      fill: "#F59E0B", pct: total > 0 ? ((late / total) * 100).toFixed(1) : "0.0" },
    { name: "Absent",     value: absent,    fill: "#E8231A", pct: total > 0 ? ((absent / total) * 100).toFixed(1) : "0.0" },
    { name: "On Leave",   value: onLeave,   fill: "#1B6AB5", pct: total > 0 ? ((onLeave / total) * 100).toFixed(1) : "0.0" },
    { name: "WFH",        value: wfh,       fill: "#8B5CF6", pct: total > 0 ? ((wfh / total) * 100).toFixed(1) : "0.0" },
    { name: "Not Marked", value: notMarked, fill: "#cbd5e1", pct: total > 0 ? ((notMarked / total) * 100).toFixed(1) : "0.0" },
  ].filter((d) => d.value > 0 && total > 0);

  const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });

  return (
    <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
      <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100 pb-4 pt-5 px-5">
        <CardTitle className="text-sm font-bold text-slate-900">
          Live Attendance Status
        </CardTitle>
        <span className="text-xs text-slate-400">Last updated: {now} ↺</span>
      </CardHeader>
      <CardContent className="p-5">
        {isLoading ? (
          <Skeleton className="h-48 w-full rounded-xl" />
        ) : (
          <div className="flex items-center gap-5">
            <div className="relative flex-shrink-0">
              <ResponsiveContainer width={140} height={140}>
                <PieChart>
                  <Pie
                    data={chartData}
                    dataKey="value"
                    cx="50%"
                    cy="50%"
                    innerRadius={38}
                    outerRadius={62}
                    paddingAngle={1.5}
                  >
                    {chartData.map((e, i) => (
                      <Cell key={i} fill={e.fill} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#0f172a",
                      border: "none",
                      borderRadius: "8px",
                      color: "#f1f5f9",
                      fontSize: 11,
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span
                  className="text-base font-black text-slate-900"
                  style={{ fontFamily: "'Fira Code', monospace" }}
                >
                  {attPct.toFixed(1)}%
                </span>
                <span className="text-[8px] text-slate-500">Present</span>
              </div>
            </div>
            <div className="flex-1 space-y-1.5">
              {chartData.map((d, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: d.fill }}
                  />
                  <span className="text-xs text-slate-700 flex-1">{d.name}</span>
                  <span
                    className="text-xs font-bold text-slate-800"
                    style={{ fontFamily: "'Fira Code', monospace" }}
                  >
                    {d.value}
                  </span>
                  <span className="text-[10px] text-slate-400 w-10 text-right">
                    {d.pct}%
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
