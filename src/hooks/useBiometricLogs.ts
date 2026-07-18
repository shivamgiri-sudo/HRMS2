import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

export type RawPunchLogItem = {
  cosecIndex: number;
  userId: string;
  punchTime: string;
  ioType: number;
  ioLabel: string;
  deviceId: number | null;
  syncedAt: string;
};

export type BiometricLogDay = {
  date: string;
  biometricSummary: {
    firstPunchIn: string | null;
    lastPunchOut: string | null;
    totalPunches: number;
    rawMinutes: number | null;
    sourceSystem: string | null;
  } | null;
  attendanceSummary: {
    clockInTime: string | null;
    clockOutTime: string | null;
    attendanceStatus: string;
    biometricMinutes: number | null;
    attendanceSource: string | null;
    sourceSystem: string | null;
    processedAt: string | null;
    isLocked: number;
  } | null;
  rawPunches: RawPunchLogItem[];
};

export type EmployeeBiometricLogsResponse = {
  employee: {
    id: string;
    employeeCode: string;
    employeeName: string;
    biometricCode: string | null;
    cosecUserId: string | null;
    branchName: string | null;
    processName: string | null;
  };
  fromDate: string;
  toDate: string;
  days: BiometricLogDay[];
};

export function useBiometricLogs(employeeId: string, fromDate: string, toDate: string) {
  return useQuery<EmployeeBiometricLogsResponse>({
    queryKey: ["biometric-logs", employeeId, fromDate, toDate],
    enabled: Boolean(employeeId && fromDate && toDate),
    queryFn: async () => {
      const query = new URLSearchParams({ fromDate, toDate }).toString();
      const res = await hrmsApi.get<{ success: boolean; data: EmployeeBiometricLogsResponse }>(
        `/api/wfm/biometric-logs/employee/${employeeId}?${query}`,
      );
      return res.data;
    },
  });
}
