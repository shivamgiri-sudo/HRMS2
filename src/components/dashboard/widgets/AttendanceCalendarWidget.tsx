import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { hrmsApi } from "@/lib/hrmsApi";

interface Props { employeeId: string; month: string; }

const STATUS_STYLE: Record<string, string> = {
  present:  "bg-emerald-100 text-emerald-700",
  absent:   "bg-red-100 text-red-600",
  late:     "bg-amber-100 text-amber-700",
  leave:    "bg-blue-100 text-blue-700",
  week_off: "bg-slate-100 text-slate-500",
};
const STATUS_LABEL: Record<string, string> = {
  present: "P", absent: "A", late: "L", leave: "L", week_off: "WO",
};

export function AttendanceCalendarWidget({ employeeId, month }: Props) {
  const [year, mon] = month.split("-").map(Number);
  const monthEndDay = new Date(year, mon, 0).getDate();
  const fromDate = `${month}-01`;
  const toDate = `${month}-${String(monthEndDay).padStart(2, "0")}`;

  const { data, isLoading } = useQuery<any>({
    queryKey: ["attendance-calendar", employeeId, month],
    queryFn: () => hrmsApi.get(`/api/wfm/attendance/ncosec-monthly?employeeId=${employeeId}&fromDate=${fromDate}&toDate=${toDate}&limit=500`),
    enabled: !!employeeId,
    staleTime: 1000 * 60 * 5,
  });

  const records: any[] = Array.isArray(data?.data) ? data.data.filter((r: any) => r.date?.startsWith(month)) : [];
  const statusMap: Record<string, string> = {};
  records.forEach(r => { statusMap[r.date] = r.status; });

  const monthLabel = new Date(year, mon - 1, 1).toLocaleString("default", { month: "long", year: "numeric" });
  const daysInMonth = new Date(year, mon, 0).getDate();
  const firstDayOfWeek = new Date(year, mon - 1, 1).getDay(); // 0=Sun
  const startOffset = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1; // Mon=0

  const cells: Array<{ day: number | null; dateStr: string | null }> = [];
  for (let i = 0; i < startOffset; i++) cells.push({ day: null, dateStr: null });
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${month}-${String(d).padStart(2, "0")}`;
    cells.push({ day: d, dateStr });
  }

  return (
    <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
      <CardHeader className="border-b border-slate-100 pb-4 pt-5 px-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <CardTitle className="text-sm font-bold text-slate-900">Monthly Attendance — {monthLabel}</CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            {[["P","bg-emerald-100 text-emerald-700"],["A","bg-red-100 text-red-600"],["L","bg-blue-100 text-blue-700"],["WO","bg-slate-100 text-slate-500"]].map(([label, cls]) => (
              <span key={label} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${cls}`}>{label === "P" ? "Present" : label === "A" ? "Absent" : label === "L" ? "Leave" : "Week Off"}</span>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4">
        {isLoading ? <Skeleton className="h-40 w-full rounded-xl" /> : (
          <>
            <div className="grid grid-cols-7 gap-1 mb-2">
              {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(d => (
                <div key={d} className="text-center text-[10px] font-semibold text-slate-400 uppercase py-1">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {cells.map((cell, i) => {
                if (!cell.day || !cell.dateStr) return <div key={i} />;
                const dow = new Date(cell.dateStr).getDay();
                const status = dow === 0 ? "week_off" : statusMap[cell.dateStr];
                const style = status ? STATUS_STYLE[status] : "";
                const label = status ? STATUS_LABEL[status] : "";
                return (
                  <div key={i} className="flex flex-col items-center gap-0.5 py-1">
                    <span className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold ${style || "text-slate-700"}`}>
                      {label || cell.day}
                    </span>
                    {!label && <span className="text-[9px] text-slate-400">{cell.day}</span>}
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-slate-400 mt-3">Note: Attendance is updated real-time</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
