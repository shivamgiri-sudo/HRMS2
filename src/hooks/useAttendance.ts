import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { format, startOfMonth, endOfMonth } from "date-fns";

export interface AttendanceRecord {
  id: string;
  employee_id: string;
  date: string;
  clock_in: string | null;
  clock_out: string | null;
  total_hours: number | null;
  status: string;
  notes: string | null;
  clock_in_latitude: number | null;
  clock_in_longitude: number | null;
  clock_in_location_name: string | null;
  clock_out_latitude: number | null;
  clock_out_longitude: number | null;
  clock_out_location_name: string | null;
  work_mode: 'wfh' | 'wfo' | null;
  employee?: {
    first_name: string;
    last_name: string;
    employee_code: string;
    working_hours_start: string | null;
    working_hours_end: string | null;
  };
}

export interface LocationData {
  latitude: number;
  longitude: number;
  locationName?: string;
}

export type WorkMode = 'wfh' | 'wfo';

export function useAttendance(month?: Date, employeeId?: string) {
  const targetMonth = month || new Date();
  const start = format(startOfMonth(targetMonth), "yyyy-MM-dd");
  const end = format(endOfMonth(targetMonth), "yyyy-MM-dd");

  return useQuery({
    queryKey: ["attendance", start, end, employeeId ?? "all"],
    queryFn: async () => {
      const params = new URLSearchParams({ fromDate: start, toDate: end, limit: "200" });
      if (employeeId) params.set("employeeId", employeeId);
      const res = await hrmsApi.get<{ success: boolean; data: any[] }>(`/api/wfm/attendance/daily?${params}`);
      return (res.data || []) as unknown as AttendanceRecord[];
    },
    enabled: employeeId === undefined ? true : !!employeeId,
  });
}

export function useTodayAttendance(employeeId?: string) {
  const today = format(new Date(), "yyyy-MM-dd");
  const yesterday = format(new Date(Date.now() - 86400000), "yyyy-MM-dd");

  return useQuery({
    queryKey: ["attendance-today", today, employeeId],
    queryFn: async () => {
      if (!employeeId) return null;

      // First check today's record
      try {
        const res = await hrmsApi.get<{ success: boolean; data: any }>(
          `/api/wfm/attendance/daily/${employeeId}/${today}`
        );
        if (res.data) return res.data as unknown as AttendanceRecord;
      } catch {
        // 404 means no record yet — fall through
      }

      // If no today record, check for yesterday's unclosed record (cross-midnight shifts)
      try {
        const res = await hrmsApi.get<{ success: boolean; data: any }>(
          `/api/wfm/attendance/daily/${employeeId}/${yesterday}`
        );
        const record = res.data as any;
        // Only return if clock_out is null (still open shift)
        if (record && !record.clock_out_time) return record as unknown as AttendanceRecord;
      } catch {
        // No record for yesterday either
      }

      return null;
    },
    enabled: !!employeeId,
  });
}

export function useClockIn() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ employeeId, location, workMode }: { employeeId: string; location?: LocationData; workMode?: WorkMode }) => {
      const res = await hrmsApi.post<{ success: boolean; data: any }>("/api/wfm/attendance/clock-in", {
        employee_id: employeeId,
        work_mode: workMode ?? "office",
        latitude: location?.latitude ?? null,
        longitude: location?.longitude ?? null,
        location_name: location?.locationName ?? null,
      });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
      queryClient.invalidateQueries({ queryKey: ["attendance-today"] });
    },
  });
}

export function useClockOut() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ recordId, location }: { recordId: string; clockIn: string; location?: LocationData; customClockOut?: Date }) => {
      const res = await hrmsApi.post<{ success: boolean; data: any }>("/api/wfm/attendance/clock-out", {
        record_id: recordId,
        latitude: location?.latitude ?? null,
        longitude: location?.longitude ?? null,
        location_name: location?.locationName ?? null,
      });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
      queryClient.invalidateQueries({ queryKey: ["attendance-today"] });
    },
  });
}

export function useAttendanceReport(month: Date) {
  const start = format(startOfMonth(month), "yyyy-MM-dd");
  const end = format(endOfMonth(month), "yyyy-MM-dd");

  return useQuery({
    queryKey: ["attendance-report", start, end],
    queryFn: async () => {
      const params = new URLSearchParams({ fromDate: start, toDate: end, limit: "500" });
      const res = await hrmsApi.get<{ success: boolean; data: any[] }>(`/api/wfm/attendance/daily?${params}`);
      const records = res.data || [];

      // Group by employee
      const employeeMap = new Map<string, {
        employeeId: string;
        employeeName: string;
        employeeCode: string;
        department: string;
        records: AttendanceRecord[];
        totalDays: number;
        totalHours: number;
        presentDays: number;
        lateDays: number;
        wfoDays: number;
      }>();

      records.forEach((record: any) => {
        const key = record.employee_id;
        if (!employeeMap.has(key)) {
          const firstName = record.first_name ?? record.employee?.first_name ?? "";
          const lastName = record.last_name ?? record.employee?.last_name ?? "";
          employeeMap.set(key, {
            employeeId: record.employee_id,
            employeeName: `${firstName} ${lastName}`.trim() || "Unknown",
            employeeCode: record.employee_code ?? record.employee?.employee_code ?? "",
            department: record.department_name ?? record.employee?.department?.name ?? "-",
            records: [],
            totalDays: 0,
            totalHours: 0,
            presentDays: 0,
            lateDays: 0,
            wfoDays: 0,
          });
        }

        const empData = employeeMap.get(key)!;
        empData.records.push(record as unknown as AttendanceRecord);
        empData.totalDays++;
        empData.totalHours += record.total_hours || 0;
        if (record.attendance_status === "present" || record.status === "present") empData.presentDays++;
        if (record.attendance_status === "late" || record.status === "late") empData.lateDays++;
        if (record.work_mode === "wfo" || record.work_mode === "office") empData.wfoDays++;
      });

      return Array.from(employeeMap.values());
    },
  });
}
