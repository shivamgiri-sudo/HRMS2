import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CalendarCheck } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useUserRole } from "@/hooks/useUserRole";
import { hrmsApi } from "@/lib/hrmsApi";
import { canAccessDashboard } from "../../../../backend/src/shared/dashboardAccessRegistry";

export function MyAttendanceWidget() {
  const { data: roleData, isLoading: roleLoading } = useUserRole();
  const canLoadSelfAttendance = canAccessDashboard(
    "EMPLOYEE_SELF_DASHBOARD",
    roleData?.roleKeys ?? [],
  );

  // Use employee dashboard summary — has att metric
  const { data, isLoading, isError } = useQuery<any>({
    queryKey: ["dashboard-employee-summary"],
    queryFn: () => hrmsApi.get("/api/dashboards/employee/summary"),
    enabled: !roleLoading && canLoadSelfAttendance,
    staleTime: 1000 * 60 * 5,
  });

  const metrics = data?.data?.metrics ?? {};
  const attValue = metrics.att?.value;
  const attDetail = metrics.att?.detail ?? {};
  const hasAttendanceMetric = typeof attValue === "number" && Number.isFinite(attValue);
  const present = typeof attDetail.present === "number" ? attDetail.present : null;
  const absent = typeof attDetail.absent === "number" ? attDetail.absent : null;
  const halfDay = typeof attDetail.halfDay === "number" ? attDetail.halfDay : null;
  const attendancePct = hasAttendanceMetric ? attValue : null;

  const stats = [
    { label: "Present",  value: present,  color: "text-emerald-600", bg: "bg-emerald-50 border-emerald-100" },
    { label: "Half Day", value: halfDay,  color: "text-amber-600",   bg: "bg-amber-50 border-amber-100"    },
    { label: "Absent",   value: absent,   color: "text-red-500",     bg: "bg-red-50 border-red-100"        },
  ];

  const barWidth = Math.min(Math.max(attendancePct ?? 0, 0), 100);

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
        {roleLoading || isLoading ? (
          <Skeleton className="h-20 w-full rounded-lg" />
        ) : !canLoadSelfAttendance ? (
          <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-4">
            <p className="text-sm font-semibold text-slate-700">Attendance is available from My Dashboard.</p>
            <p className="mt-1 text-xs text-slate-500">Open your employee workspace to view month-to-date attendance.</p>
          </div>
        ) : isError ? (
          <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-4">
            <p className="text-sm font-semibold text-red-700">Unable to load attendance.</p>
            <p className="mt-1 text-xs text-red-600">Please retry from My Dashboard.</p>
          </div>
        ) : !hasAttendanceMetric ? (
          <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-4">
            <p className="text-sm font-semibold text-slate-700">Attendance data is unavailable.</p>
            <p className="mt-1 text-xs text-slate-500">No month-to-date attendance summary was returned.</p>
          </div>
        ) : (
          <>
            <div className="flex items-end gap-3">
              <span className="dash-metric text-[32px]">
                {`${attendancePct.toFixed(1)}%`}
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
                  <p className={`dash-metric text-[17px] ${s.color}`}>{s.value ?? "—"}</p>
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
