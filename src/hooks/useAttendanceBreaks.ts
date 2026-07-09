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
      const res = await hrmsApi.get(`/api/wfm/sessions/${attendanceRecordId}/breaks`);
      const rawBreaks: any[] = res.data?.data ?? [];
      const active = rawBreaks.find(b => !b.break_end);
      if (!active) return null;
      return {
        id: active.id,
        attendance_record_id: active.session_id,
        pause_time: active.break_start,
        resume_time: null,
        pause_latitude: null,
        pause_longitude: null,
        pause_location_name: null,
        resume_latitude: null,
        resume_longitude: null,
        resume_location_name: null,
        created_at: active.created_at,
      } as AttendanceBreak;
    },
    enabled: !!attendanceRecordId,
  });
}

export function useBreaksForRecord(attendanceRecordId?: string) {
  return useQuery({
    queryKey: ["attendance-breaks", attendanceRecordId],
    queryFn: async () => {
      if (!attendanceRecordId) return [];
      const res = await hrmsApi.get(`/api/wfm/sessions/${attendanceRecordId}/breaks`);
      const breaks = res.data?.data ?? [];
      return breaks.map((b: any) => ({
        id: b.id,
        attendance_record_id: b.session_id,
        pause_time: b.break_start,
        resume_time: b.break_end ?? null,
        pause_latitude: null,
        pause_longitude: null,
        pause_location_name: null,
        resume_latitude: null,
        resume_longitude: null,
        resume_location_name: null,
        created_at: b.created_at,
      })) as AttendanceBreak[];
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
      await hrmsApi.patch(`/api/wfm/breaks/${breakId}/end`);
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
