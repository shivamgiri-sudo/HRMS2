import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CalendarCheck } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { hrmsApi } from "@/lib/hrmsApi";

export function MyAttendanceWidget() {
  // Use employee dashboard summary — has att metric
  const { data, isLoading } = useQuery<any>({
    queryKey: ["dashboard-employee-summary"],
    queryFn: () => hrmsApi.get("/api/dashboards/employee/summary"),
    staleTime: 1000 * 60 * 5,
  });

  const metrics = data?.data?.metrics ?? {};
  const attValue = metrics.att?.value;
  const attDetail = metrics.att?.detail ?? {};
  const present = attDetail.present ?? 0;
  const absent = attDetail.absent ?? 0;
  const halfDay = attDetail.half_day ?? 0;
  const attendancePct = typeof attValue === "number" ? attValue : 0;

  const stats = [
    { label: "Present",  value: present,  color: "text-emerald-600", bg: "bg-emerald-50 border-emerald-100" },
    { label: "Half Day", value: halfDay,  color: "text-amber-600",   bg: "bg-amber-50 border-amber-100"    },
    { label: "Absent",   value: absent,   color: "text-red-500",     bg: "bg-red-50 border-red-100"        },
  ];

  const barWidth = Math.min(attendancePct, 100);

  return (
    <div className="dashboard-card h-full">
      <div className="dashboard-card-header">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 flex-shrink-0">
            <CalendarCheck className="w-3.5 h-3.5" />
          </div>
          <div>
            <p className="dashboard-card-title">My Attendance</p>
            <p className="dashboard-card-subtitle">Month to date</p>
          </div>
        </div>
        <Link to="/attendance" className="dash-link">View →</Link>
      </div>

      <div className="p-4 space-y-4">
        {isLoading ? (
          <Skeleton className="h-20 w-full rounded-lg" />
        ) : (
          <>
            <div className="flex items-end gap-3">
              <span className="dash-metric text-[32px]">
                {attendancePct > 0 ? `${attendancePct.toFixed(1)}%` : "—"}
              </span>
              <div className="mb-1.5 flex-1">
                <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                    style={{ width: `${barWidth}%` }}
                  />
                </div>
                <p className="text-[10px] text-slate-400 mt-1 font-medium">attendance rate</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {stats.map((s) => (
                <div key={s.label} className={`rounded-lg border px-2.5 py-2 ${s.bg}`}>
                  <p className={`dash-metric text-[17px] ${s.color}`}>{s.value}</p>
                  <p className="dash-label mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
