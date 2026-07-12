import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { format, startOfMonth, endOfMonth } from "date-fns";
import type { AttendanceRecord } from "@/hooks/useAttendance";

interface AttendanceReportRecord {
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  department: string;
  branch: string;
  process: string;
  costCentre: string;
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

const EMPLOYEE_PAGE_SIZE = 500;
const ATTENDANCE_PAGE_SIZE = 500;
const ATTENDANCE_ENDPOINT = "/api/wfm/attendance/ncosec-monthly";

function safeNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getExpectedHours(workStart: string | null, workEnd: string | null): number {
  if (!workStart || !workEnd) return 9;
  const [sh, sm] = workStart.split(":").map(Number);
  const [eh, em] = workEnd.split(":").map(Number);
  if (![sh, sm, eh, em].every(Number.isFinite)) return 9;
  return Math.max(0, (eh * 60 + em - (sh * 60 + sm)) / 60);
}

function getLateMinutes(record: AttendanceRecord): number {
  const clockIn = record.clock_in_time ?? record.clock_in;
  const workStart = record.employee?.working_hours_start ?? null;
  if (!clockIn || !workStart) return 0;
  const [startHour, startMinute] = workStart.split(":").map(Number);
  if (![startHour, startMinute].every(Number.isFinite)) return 0;
  const isoClockIn = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(clockIn)
    ? clockIn.replace(" ", "T") + "+05:30"
    : clockIn;
  const inDate = new Date(isoClockIn);
  if (Number.isNaN(inDate.getTime())) return 0;
  const istTime = inDate.toLocaleString("en-US", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const [hourText, minuteText] = istTime.split(":");
  const actualMinutes = safeNumber(hourText) * 60 + safeNumber(minuteText);
  const scheduledMinutes = startHour * 60 + startMinute;
  return Math.max(0, actualMinutes - scheduledMinutes);
}

function getOvertimeHours(record: AttendanceRecord): number {
  const totalHours = safeNumber(record.total_hours ?? (record.raw_minutes != null ? safeNumber(record.raw_minutes) / 60 : 0));
  if (!record.clock_out && !record.clock_out_time) return 0;
  const expectedHours = getExpectedHours(
    record.employee?.working_hours_start ?? null,
    record.employee?.working_hours_end ?? null,
  );
  return Math.max(0, totalHours - expectedHours);
}

async function fetchAttendancePages(params: URLSearchParams): Promise<AttendanceRecord[]> {
  const allRecords: AttendanceRecord[] = [];
  let page = 1;
  let total = Number.POSITIVE_INFINITY;

  while (allRecords.length < total) {
    const paged = new URLSearchParams(params);
    paged.set("limit", String(ATTENDANCE_PAGE_SIZE));
    paged.set("page", String(page));
    const res = await hrmsApi.get<{ success: boolean; data: AttendanceRecord[]; total?: number }>(
      `${ATTENDANCE_ENDPOINT}?${paged}`
    );
    if (!res.success) throw new Error((res as any).message || "Failed to fetch attendance records");
    const batch = res.data ?? [];
    allRecords.push(...batch);
    total = typeof res.total === "number" ? res.total : allRecords.length;
    if (batch.length < ATTENDANCE_PAGE_SIZE) break;
    page += 1;
  }

  return allRecords;
}

export function useAttendanceReportData(month: number, year: number, branchId?: string, processId?: string, costCentreId?: string) {
  const startDate = startOfMonth(new Date(year, month - 1));
  const endDate = endOfMonth(startDate);
  const start = format(startDate, "yyyy-MM-dd");
  const end = format(endDate, "yyyy-MM-dd");

  return useQuery({
    queryKey: ["attendance-report-data", month, year, branchId, processId, costCentreId],
    staleTime: 5 * 60_000,   // 5 min — this report paginates 65K employees, avoid redundant refetches
    gcTime: 10 * 60_000,
    queryFn: async (): Promise<AttendanceReportSummary> => {
      let empPage = 1;
      const allEmployees: any[] = [];
      const empFilters = [
        "recordStatus=active",
        `limit=${EMPLOYEE_PAGE_SIZE}`,
        branchId ? `branchId=${branchId}` : "",
        processId ? `processId=${processId}` : "",
        costCentreId ? `costCentreId=${costCentreId}` : "",
      ].filter(Boolean).join("&");
      while (true) {
        const empRes = await hrmsApi.get<{ success?: boolean; data: any[]; total: number; page: number; limit: number }>(
          `/api/employees?${empFilters}&page=${empPage}`
        );
        const batch = empRes.data ?? [];
        allEmployees.push(...batch);
        const total = Number((empRes as any).total ?? batch.length);
        if (allEmployees.length >= total || batch.length < EMPLOYEE_PAGE_SIZE) break;
        empPage++;
      }

      const attFilters = [
        `fromDate=${start}`,
        `toDate=${end}`,
        branchId ? `branchId=${branchId}` : "",
        processId ? `processId=${processId}` : "",
        costCentreId ? `costCentreId=${costCentreId}` : "",
      ].filter(Boolean).join("&");
      const allSessions = await fetchAttendancePages(new URLSearchParams(attFilters));

      const attMap = new Map<string, {
        totalDays: number; totalHours: number; lateArrivals: number; totalLateMinutes: number;
        totalOvertimeHours: number;
        employeeName: string; employeeCode: string; department: string; branch: string; process: string; costCentre: string;
      }>();

      for (const s of allSessions) {
        const employeeId = String(s.employee_id ?? s.employeeId ?? "");
        if (!employeeId) continue;
        if (!attMap.has(employeeId)) {
          attMap.set(employeeId, {
            totalDays: 0,
            totalHours: 0,
            lateArrivals: 0,
            totalLateMinutes: 0,
            totalOvertimeHours: 0,
            employeeName: s.employee_name ?? `${s.employee?.first_name ?? ""} ${s.employee?.last_name ?? ""}`.trim(),
            employeeCode: s.employee_code ?? s.employee?.employee_code ?? "",
            department: s.department_name ?? "-",
            branch: s.branch_name ?? "-",
            process: s.process_name ?? "-",
            costCentre: s.cost_centre_name ?? "-",
          });
        }
        const r = attMap.get(employeeId)!;
        const status = String(s.attendance_status ?? s.status ?? "").toLowerCase();
        if (["present", "half_day"].includes(status)) r.totalDays++;
        r.totalHours += safeNumber(s.raw_minutes ?? s.biometric_minutes ?? 0) / 60;
        const lateMinutes = getLateMinutes(s);
        if (lateMinutes > 0) {
          r.lateArrivals++;
          r.totalLateMinutes += lateMinutes;
        }
        r.totalOvertimeHours += getOvertimeHours(s);
      }

      const records: AttendanceReportRecord[] = allEmployees.map((emp: any) => {
        const employeeId = String(emp.id ?? emp.employee_id ?? "");
        const att = attMap.get(employeeId);
        return {
          employeeId,
          employeeName: att?.employeeName ?? emp.full_name ?? `${emp.first_name ?? ""} ${emp.last_name ?? ""}`.trim(),
          employeeCode: att?.employeeCode ?? emp.employee_code ?? "",
          department: att?.department ?? emp.department_name ?? emp.dept_name ?? "-",
          branch: att?.branch ?? emp.branch_name ?? "-",
          process: att?.process ?? emp.process_name ?? "-",
          costCentre: att?.costCentre ?? emp.cost_centre_name ?? "-",
          totalDays: att?.totalDays ?? 0,
          totalHours: att?.totalHours ?? 0,
          lateArrivals: att?.lateArrivals ?? 0,
          totalLateMinutes: att?.totalLateMinutes ?? 0,
          totalOvertimeHours: att?.totalOvertimeHours ?? 0,
          workingHoursStart: emp.working_hours_start ?? null,
          workingHoursEnd: emp.working_hours_end ?? null,
        };
      }).sort((a, b) => a.employeeName.localeCompare(b.employeeName));

      const totalLateArrivals = records.reduce((s, r) => s + r.lateArrivals, 0);
      const totalLateMinutes = records.reduce((s, r) => s + r.totalLateMinutes, 0);
      return {
        monthName: format(startDate, "MMMM yyyy"),
        records,
        totalEmployees: records.length,
        totalLateArrivals,
        totalOvertimeHours: records.reduce((s, r) => s + r.totalOvertimeHours, 0),
        avgLateMinutes: totalLateArrivals > 0 ? Math.round(totalLateMinutes / totalLateArrivals) : 0,
      };
    },
  });
}
