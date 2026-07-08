import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { format, startOfMonth, endOfMonth } from "date-fns";

const ATTENDANCE_PAGE_LIMIT = 500;
const NCOSEC_ENDPOINT = "/api/wfm/attendance/ncosec-monthly";

export interface AttendanceRecord {
  id: string;
  employee_id: string;
  // Native DB columns
  record_date: string;
  clock_in_time: string | null;
  clock_out_time: string | null;
  raw_minutes: number | null;
  attendance_status: string;
  work_mode: string | null;
  clock_in_lat: number | null;
  clock_in_lng: number | null;
  clock_in_location: string | null;
  clock_out_lat: number | null;
  clock_out_lng: number | null;
  clock_out_location: string | null;
  late_mark: number | null;
  late_by_minutes: number | null;
  is_locked: number | null;
  // Aliased columns returned by backend (match frontend usage)
  date: string;
  clock_in: string | null;
  clock_out: string | null;
  total_hours: number | null;
  status: string;
  clock_in_location_name: string | null;
  clock_out_location_name: string | null;
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

export interface MonthlySummary {
  presentDays: number;
  halfDays: number;
  absentDays: number;
  leaveDays: number;
  holidayDays: number;
  weekOffDays: number;
  totalLwp: number;
  lateMarks: number;
  totalWorkingDays: number;
  totalHours: number;
  wfoDays: number;
}

export type WorkMode = 'wfh' | 'wfo';

async function fetchAttendancePages(params: URLSearchParams): Promise<AttendanceRecord[]> {
  const allRecords: AttendanceRecord[] = [];
  let page = 1;
  let total = Number.POSITIVE_INFINITY;

  while (allRecords.length < total) {
    const paged = new URLSearchParams(params);
    paged.set("limit", String(ATTENDANCE_PAGE_LIMIT));
    paged.set("page", String(page));
    const res = await hrmsApi.get<{ success: boolean; data: AttendanceRecord[]; total?: number }>(`${NCOSEC_ENDPOINT}?${paged}`);
    if (!res.success) throw new Error((res as any).message || "Failed to fetch attendance records");
    const rows = res.data ?? [];
    allRecords.push(...rows);
    total = typeof res.total === "number" ? res.total : allRecords.length;
    if (rows.length < ATTENDANCE_PAGE_LIMIT) break;
    page += 1;
  }

  return allRecords;
}

export function useAttendance(month?: Date, employeeId?: string) {
  const targetMonth = month || new Date();
  const start = format(startOfMonth(targetMonth), "yyyy-MM-dd");
  const end = format(endOfMonth(targetMonth), "yyyy-MM-dd");

  return useQuery({
    queryKey: ["attendance-ncosec", start, end, employeeId ?? "all"],
    queryFn: async () => {
      const params = new URLSearchParams({ fromDate: start, toDate: end, limit: String(ATTENDANCE_PAGE_LIMIT) });
      if (employeeId) {
        params.set("employeeId", employeeId);
      }

      return fetchAttendancePages(params);
    },
    enabled: true,
    retry: 2,
    retryDelay: 1000,
    staleTime: 30000,
    refetchInterval: 2 * 60 * 1000,
    refetchIntervalInBackground: false,
  });
}

export function useTodayAttendance(employeeId?: string) {
  const today = format(new Date(), "yyyy-MM-dd");
  const yesterday = format(new Date(Date.now() - 86400000), "yyyy-MM-dd");

  return useQuery({
    queryKey: ["attendance-today", today, employeeId],
    queryFn: async () => {
      if (!employeeId) return null;

      const getRecordForDate = async (date: string) => {
        const params = new URLSearchParams({
          employeeId,
          fromDate: date,
          toDate: date,
          limit: "1",
        });
        const res = await hrmsApi.get<{ success: boolean; data: AttendanceRecord[] }>(
          `/api/wfm/attendance/daily?${params}`
        );
        return res.data?.[0] ?? null;
      };

      const todayRecord = await getRecordForDate(today);
      if (todayRecord) return todayRecord;

      const yesterdayRecord = await getRecordForDate(yesterday);
      if (
        yesterdayRecord &&
        !yesterdayRecord.clock_out_time &&
        !yesterdayRecord.clock_out
      ) {
        return yesterdayRecord;
      }

      return null;
    },
    enabled: !!employeeId,
    staleTime: 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
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

export function useWebPunchIn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (location?: { latitude?: number; longitude?: number; location_name?: string }) => {
      const res = await hrmsApi.post<{ success: boolean; record_id: string; web_punch_in: string; error?: string }>(
        "/api/wfm/attendance/web-punch-in",
        location ?? {},
      );
      if (!res.success) throw new Error((res as any).error ?? "Web punch-in failed");
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendance-ncosec"] });
      queryClient.invalidateQueries({ queryKey: ["attendance-today"] });
    },
  });
}

export function useWebPunchOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (location?: { latitude?: number; longitude?: number; location_name?: string }) => {
      const res = await hrmsApi.post<{ success: boolean; record_id: string; web_punch_out: string; error?: string }>(
        "/api/wfm/attendance/web-punch-out",
        location ?? {},
      );
      if (!res.success) throw new Error((res as any).error ?? "Web punch-out failed");
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendance-ncosec"] });
      queryClient.invalidateQueries({ queryKey: ["attendance-today"] });
    },
  });
}

export interface LivePunchData {
  punch_date: string;
  first_punch_in: string | null;
  last_punch_out: string | null;
  raw_minutes: number;
  total_punches: number;
  source: "biometric_live";
}

export function useTodayLivePunch(employeeId?: string) {
  return useQuery({
    queryKey: ["attendance-today-live", employeeId],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: LivePunchData | null }>(
        "/api/wfm/attendance/today-live"
      );
      return res.data ?? null;
    },
    enabled: !!employeeId,
    staleTime: 10 * 1000,
    refetchInterval: 15 * 1000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
}

export function useAttendanceReport(month: Date) {
  const start = format(startOfMonth(month), "yyyy-MM-dd");
  const end = format(endOfMonth(month), "yyyy-MM-dd");

  return useQuery({
    queryKey: ["attendance-ncosec-report", start, end],
    queryFn: async () => {
      const params = new URLSearchParams({ fromDate: start, toDate: end });
      const records = await fetchAttendancePages(params);

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
          const employeeName = record.employee_name ?? (`${firstName} ${lastName}`.trim() || "Unknown");
          employeeMap.set(key, {
            employeeId: record.employee_id,
            employeeName,
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
        empData.records.push(record as AttendanceRecord);
        empData.totalDays++;
        empData.totalHours += record.raw_minutes != null ? record.raw_minutes / 60 : (record.total_hours || 0);
        if (record.attendance_status === "present" || record.status === "present") empData.presentDays++;
        if (record.attendance_status === "late" || record.status === "late" || record.late_mark === 1) empData.lateDays++;
        if (record.work_mode === "wfo" || record.work_mode === "office") empData.wfoDays++;
      });

      return Array.from(employeeMap.values());
    },
  });
}

export function useMyAttendanceSummary(employeeId?: string, month?: Date) {
  const monthStr = format(month ?? new Date(), 'yyyy-MM');
  return useQuery({
    queryKey: ['attendance-my-summary', employeeId, monthStr],
    queryFn: async () => {
      if (!employeeId) throw new Error('employeeId is required');
      const res = await hrmsApi.get<{ success: boolean; data: MonthlySummary }>(
        `/api/wfm/attendance/summary/${employeeId}/${monthStr}`
      );
      if (!res.success) throw new Error('Failed to fetch summary');
      return res.data;
    },
    enabled: !!employeeId,
    staleTime: 60_000,
  });
}

export interface RegularizationInput {
  sessionDate: string;           // 'YYYY-MM-DD'
  reasonCode?: string;
  reason: string;
  requestedStatus?: 'present' | 'half_day' | 'absent';
  disputeType?: string;
  newPunchIn?: string;           // 'HH:mm'
  newPunchOut?: string;          // 'HH:mm'
}

export function useSubmitRegularization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: RegularizationInput) => {
      const res = await hrmsApi.post<{ success: boolean; data: any; message?: string }>(
        '/api/wfm/regularizations',
        {
          sessionDate: input.sessionDate,
          reason_code: input.reasonCode,
          reason: input.reason,
          requested_status: input.requestedStatus,
          disputeType: input.disputeType,
          newPunchIn: input.newPunchIn,
          newPunchOut: input.newPunchOut,
        }
      );
      if (!res.success) throw new Error((res as any).message || 'Failed to submit regularization');
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance-calendar'] });
      queryClient.invalidateQueries({ queryKey: ['attendance-ncosec'] });
      queryClient.invalidateQueries({ queryKey: ['attendance-my-summary'] });
      queryClient.invalidateQueries({ queryKey: ['day-detail'] });
    },
  });
}

export interface LeaveRequestInput {
  leaveTypeId: string;
  fromDate: string;      // 'YYYY-MM-DD'
  toDate: string;        // 'YYYY-MM-DD'
  totalDays: number;     // 0.5 for half-day, 1 for full day
  reason?: string;
}

export function useSubmitLeaveRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: LeaveRequestInput) => {
      const res = await hrmsApi.post<{ success: boolean; data: any; message?: string }>(
        '/api/leave/requests',
        {
          leaveTypeId: input.leaveTypeId,
          fromDate: input.fromDate,
          toDate: input.toDate,
          totalDays: input.totalDays,
          reason: input.reason,
        }
      );
      if (!res.success) throw new Error((res as any).message || 'Failed to submit leave request');
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance-calendar'] });
      queryClient.invalidateQueries({ queryKey: ['attendance-ncosec'] });
      queryClient.invalidateQueries({ queryKey: ['attendance-my-summary'] });
      queryClient.invalidateQueries({ queryKey: ['leave'] });
    },
  });
}
