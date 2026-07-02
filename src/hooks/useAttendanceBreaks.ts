import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { LocationData } from "@/hooks/useAttendance";

export interface AttendanceBreak {
  id: string;
  attendance_record_id: string;
  pause_time: string;
  resume_time: string | null;
  pause_latitude: number | null;
  pause_longitude: number | null;
  pause_location_name: string | null;
  resume_latitude: number | null;
  resume_longitude: number | null;
  resume_location_name: string | null;
  created_at: string;
}

export function useActiveBreak(attendanceRecordId?: string) {
  return useQuery({
    queryKey: ["active-break", attendanceRecordId],
    queryFn: async () => {
      if (!attendanceRecordId) return null;
      return null as AttendanceBreak | null;
    },
    enabled: !!attendanceRecordId,
  });
}

export function useBreaksForRecord(attendanceRecordId?: string) {
  return useQuery({
    queryKey: ["attendance-breaks", attendanceRecordId],
    queryFn: async () => {
      if (!attendanceRecordId) return [];
      return [] as AttendanceBreak[];
    },
    enabled: !!attendanceRecordId,
  });
}

export function usePause() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ attendanceRecordId, location }: { attendanceRecordId: string; location?: LocationData }) => {
      await hrmsApi.post('/api/wfm/sessions/break', { sessionId: attendanceRecordId, breakType: 'Break' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["active-break"] });
      queryClient.invalidateQueries({ queryKey: ["attendance-breaks"] });
    },
  });
}

export function useResume() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ breakId }: { breakId: string; location?: LocationData }) => {
      return { id: breakId };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["active-break"] });
      queryClient.invalidateQueries({ queryKey: ["attendance-breaks"] });
    },
  });
}

/** Calculate total break duration in hours for a set of breaks */
export function calculateTotalBreakHours(breaks: AttendanceBreak[]): number {
  return breaks.reduce((total, b) => {
    if (!b.resume_time) return total;
    const pauseMs = new Date(b.pause_time).getTime();
    const resumeMs = new Date(b.resume_time).getTime();
    return total + (resumeMs - pauseMs) / (1000 * 60 * 60);
  }, 0);
}
