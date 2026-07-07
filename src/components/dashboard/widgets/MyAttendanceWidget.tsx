import { useQuery } from "@tanstack/react-query";
import { Calendar } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { hrmsApi } from "@/lib/hrmsApi";

export function MyAttendanceWidget() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["dashboard-my-attendance"],
    queryFn: () => hrmsApi.get("/api/attendance/my-summary"),
    staleTime: 1000 * 60 * 5,
  });

  const summary = data?.data;
  const present = summary?.present_days ?? 0;
  const absent = summary?.absent_days ?? 0;
  const halfDay = summary?.half_days ?? 0;
  const total = present + absent + halfDay;
  const attendancePct = total > 0 ? ((present + halfDay * 0.5) / total) * 100 : 0;

  return (
    <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
      <CardHeader className="border-b border-slate-100 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600">
            <Calendar className="h-4 w-4" />
          </div>
          <div>
            <CardTitle className="text-sm font-bold text-slate-900">My Attendance (MTD)</CardTitle>
            <p className="text-[10px] text-slate-500">{summary?.month ?? "This month"}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4 space-y-3">
        {isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black text-slate-900 tabular-nums" style={{ fontFamily: "'Fira Code', monospace" }}>
                {attendancePct.toFixed(0)}%
              </span>
              <span className="text-xs text-slate-500">attendance</span>
            </div>
            <div className="grid grid-cols-3 gap-3 pt-2">
              <div>
                <p className="text-[10px] uppercase text-slate-400 font-semibold">Present</p>
                <p className="text-base font-black text-emerald-600 tabular-nums" style={{ fontFamily: "'Fira Code', monospace" }}>
                  {present}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-slate-400 font-semibold">Half Day</p>
                <p className="text-base font-black text-amber-600 tabular-nums" style={{ fontFamily: "'Fira Code', monospace" }}>
                  {halfDay}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-slate-400 font-semibold">Absent</p>
                <p className="text-base font-black text-red-600 tabular-nums" style={{ fontFamily: "'Fira Code', monospace" }}>
                  {absent}
                </p>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
