import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { format, startOfMonth, endOfMonth } from "date-fns";

interface AttendanceReportRecord {
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  department: string;
  totalDays: number;
  totalHours: number;
  lateArrivals: number;
  totalLateMinutes: number;
  totalOvertimeHours: number;
  workingHoursStart: string | null;
  workingHoursEnd: string | null;
}

interface AttendanceReportSummary {
  monthName: string;
  records: AttendanceReportRecord[];
  totalEmployees: number;
  totalLateArrivals: number;
  totalOvertimeHours: number;
  avgLateMinutes: number;
}

export function useAttendanceReportData(month: number, year: number) {
  const startDate = startOfMonth(new Date(year, month - 1));
  const endDate = endOfMonth(startDate);
  const start = format(startDate, "yyyy-MM-dd");
  const end = format(endDate, "yyyy-MM-dd");

  return useQuery({
    queryKey: ["attendance-report-data", month, year],
    queryFn: async (): Promise<AttendanceReportSummary> => {
      // Fetch all active employees from employee master (paginate if large)
      let empPage = 1;
      const allEmployees: any[] = [];
      while (true) {
        const empRes = await hrmsApi.get<{ success: boolean; data: any[]; total: number }>(
          `/api/employees?recordStatus=active&limit=500&page=${empPage}`
        );
        const batch = empRes.data ?? [];
        allEmployees.push(...batch);
        const total = (empRes as any).total ?? batch.length;
        if (allEmployees.length >= total || batch.length < 500) break;
        empPage++;
      }

      // Fetch all attendance pages — backend caps at 200 per page
      let page = 1;
      const allSessions: any[] = [];
      while (true) {
        const res = await hrmsApi.get<{ success: boolean; data: any[]; total: number; limit: number }>(
          `/api/wfm/attendance/daily?fromDate=${start}&toDate=${end}&limit=200&page=${page}`
        );
        const batch = res.data ?? [];
        allSessions.push(...batch);
        const total = (res as any).total ?? batch.length;
        if (allSessions.length >= total || batch.length < 200) break;
        page++;
      }

      // Build map of attendance data keyed by employee_id
      const attMap = new Map<string, {
        totalDays: number; totalHours: number; lateArrivals: number; totalLateMinutes: number;
        employeeName: string; employeeCode: string; department: string;
      }>();

      for (const s of allSessions) {
        if (!attMap.has(s.employee_id)) {
          attMap.set(s.employee_id, {
            totalDays: 0, totalHours: 0, lateArrivals: 0, totalLateMinutes: 0,
            employeeName: s.employee_name ?? `${s.first_name ?? ''} ${s.last_name ?? ''}`.trim(),
            employeeCode: s.employee_code ?? "",
            department: s.department_name ?? s.dept_name ?? "-",
          });
        }
        const r = attMap.get(s.employee_id)!;
        if (['present', 'half_day'].includes(String(s.attendance_status ?? '').toLowerCase())) {
          r.totalDays++;
        }
        r.totalHours += Number(s.raw_minutes ?? 0) / 60;
        if (s.late_mark) {
          r.lateArrivals++;
          r.totalLateMinutes += Number(s.late_by_minutes ?? 0);
        }
      }

      // Merge: start from employee master so all employees are shown
      const records: AttendanceReportRecord[] = allEmployees.map((emp: any) => {
        const att = attMap.get(emp.id);
        return {
          employeeId: emp.id,
          employeeName: att?.employeeName ?? `${emp.first_name ?? ''} ${emp.last_name ?? ''}`.trim(),
          employeeCode: att?.employeeCode ?? emp.employee_code ?? "",
          department: att?.department ?? emp.department_name ?? "-",
          totalDays: att?.totalDays ?? 0,
          totalHours: att?.totalHours ?? 0,
          lateArrivals: att?.lateArrivals ?? 0,
          totalLateMinutes: att?.totalLateMinutes ?? 0,
          totalOvertimeHours: 0,
          workingHoursStart: null,
          workingHoursEnd: null,
        };
      }).sort((a, b) => a.employeeName.localeCompare(b.employeeName));

      const totalLateArrivals = records.reduce((s, r) => s + r.lateArrivals, 0);
      const totalLateMinutes = records.reduce((s, r) => s + r.totalLateMinutes, 0);
      return {
        monthName: format(startDate, "MMMM yyyy"),
        records,
        totalEmployees: records.length,
        totalLateArrivals,
        totalOvertimeHours: 0,
        avgLateMinutes: totalLateArrivals > 0 ? Math.round(totalLateMinutes / totalLateArrivals) : 0,
      };
    },
  });
}
