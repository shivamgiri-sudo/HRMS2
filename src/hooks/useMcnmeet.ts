import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

export type MeetingType =
  | 'team_meeting' | 'live_broadcast' | 'training_induction'
  | 'interview' | 'coaching_1on1' | 'compliance_policy';

export type MeetingStatus = 'draft' | 'scheduled' | 'live' | 'completed' | 'cancelled';

export type AudienceType =
  | 'all_company' | 'branch' | 'department' | 'process'
  | 'lob' | 'designation' | 'reporting_manager_team' | 'selected_employees';

export interface AudienceRow { type: AudienceType; value?: string; label?: string }

export interface CreateMeetingPayload {
  title: string;
  description?: string;
  meeting_type: MeetingType;
  start_at: string;
  end_at?: string;
  duration_minutes?: number;
  timezone?: string;
  host_employee_id: string;
  co_host_ids?: string[];
  audience: AudienceRow[];
  mcnmeet_room_name?: string;
  google_meet_backup_url?: string;
  recording_required?: boolean;
  attendance_required?: boolean;
  acknowledgement_required?: boolean;
}

export interface Meeting {
  id: string;
  meeting_code: string;
  title: string;
  description: string | null;
  meeting_type: MeetingType;
  status: MeetingStatus;
  host_employee_id: string;
  start_at: string;
  end_at: string | null;
  timezone: string;
  mcnmeet_room_name: string;
  mcnmeet_join_url: string;
  google_meet_backup_url: string | null;
  recording_required: number;
  attendance_required: number;
  acknowledgement_required: number;
  recording_url: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  audience?: AudienceRow[];
  invitees?: Invitee[];
}

export interface Invitee {
  id: string;
  meeting_id: string;
  employee_id: string;
  employee_code: string | null;
  employee_name: string;
  email: string | null;
  invite_status: 'pending' | 'accepted' | 'declined';
  joined_status: 'not_joined' | 'joined' | 'late';
  acknowledgement_status: 'pending' | 'acknowledged';
  joined_at: string | null;
  left_at: string | null;
  duration_seconds: number | null;
}

export interface McnmeetConfig {
  enabled: boolean;
  base_url: string | null;
  google_backup_enabled: boolean;
  google_auto_create: boolean;
  can_create: boolean;
  allowed_meeting_types: MeetingType[];
}

export function useMcnmeetConfig() {
  return useQuery<McnmeetConfig>({
    queryKey: ['mcnmeet', 'config'],
    queryFn: () => hrmsApi.get<any>('/api/mcnmeet/config').then(r => ({
      enabled: r.enabled,
      base_url: r.base_url,
      google_backup_enabled: r.google_backup_enabled,
      google_auto_create: r.google_auto_create,
      can_create: r.can_create ?? false,
      allowed_meeting_types: r.allowed_meeting_types ?? [],
    })),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

export function useMeetingsList(filters?: { status?: string; type?: string; from?: string; to?: string; page?: number }) {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.type)   params.set('type', filters.type);
  if (filters?.from)   params.set('from', filters.from);
  if (filters?.to)     params.set('to', filters.to);
  if (filters?.page)   params.set('page', String(filters.page));
  const qs = params.toString();

  return useQuery<{ meetings: Meeting[]; total: number }>({
    queryKey: ['mcnmeet', 'meetings', filters],
    queryFn: () => hrmsApi.get<any>(`/api/mcnmeet/meetings${qs ? `?${qs}` : ''}`).then(r => ({
      meetings: r.meetings ?? [],
      total: r.total ?? 0,
    })),
    staleTime: 30 * 1000,
  });
}

export function useMyMeetings(filters?: { status?: string; from?: string; to?: string; page?: number }) {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.from)   params.set('from', filters.from);
  if (filters?.to)     params.set('to', filters.to);
  if (filters?.page)   params.set('page', String(filters.page));
  const qs = params.toString();

  return useQuery<{ meetings: Meeting[]; total: number }>({
    queryKey: ['mcnmeet', 'my-meetings', filters],
    queryFn: () => hrmsApi.get<any>(`/api/mcnmeet/my-meetings${qs ? `?${qs}` : ''}`).then(r => ({
      meetings: r.meetings ?? [],
      total: r.total ?? 0,
    })),
    staleTime: 30 * 1000,
  });
}

export function useMeeting(id: string | null) {
  return useQuery<Meeting>({
    queryKey: ['mcnmeet', 'meeting', id],
    queryFn: () => hrmsApi.get<any>(`/api/mcnmeet/meetings/${id}`).then(r => r.meeting),
    enabled: !!id,
    staleTime: 15 * 1000,
  });
}

export function useMcnmeetReport(filters?: { from?: string; to?: string }) {
  const params = new URLSearchParams();
  if (filters?.from) params.set('from', filters.from);
  if (filters?.to)   params.set('to', filters.to);
  const qs = params.toString();

  return useQuery({
    queryKey: ['mcnmeet', 'report', filters],
    queryFn: () => hrmsApi.get<any>(`/api/mcnmeet/reports/summary${qs ? `?${qs}` : ''}`).then(r => r.report),
    staleTime: 60 * 1000,
  });
}

export function useCreateMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateMeetingPayload) =>
      hrmsApi.post<{ success: boolean; id: string }>('/api/mcnmeet/meetings', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mcnmeet', 'meetings'] }),
  });
}

export function useUpdateMeeting(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<CreateMeetingPayload> & { status?: MeetingStatus; recording_url?: string }) =>
      hrmsApi.patch<{ success: boolean }>(`/api/mcnmeet/meetings/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mcnmeet', 'meetings'] });
      qc.invalidateQueries({ queryKey: ['mcnmeet', 'meeting', id] });
    },
  });
}

export function useCancelMeeting(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cancel_reason: string) =>
      hrmsApi.post<{ success: boolean }>(`/api/mcnmeet/meetings/${id}/cancel`, { cancel_reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mcnmeet'] }),
  });
}

export function useResolveInvitees(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      hrmsApi.post<{ success: boolean; invitees_added: number }>(`/api/mcnmeet/meetings/${id}/invitees/resolve`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mcnmeet', 'meeting', id] }),
  });
}

export function useSelfJoin(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => hrmsApi.post<{ success: boolean }>(`/api/mcnmeet/meetings/${id}/self-join`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mcnmeet', 'my-meetings'] }),
  });
}

export function useAcknowledge(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => hrmsApi.post<{ success: boolean }>(`/api/mcnmeet/meetings/${id}/acknowledge`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mcnmeet', 'my-meetings'] }),
  });
}

export function useAddRecording(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (recording_url: string) =>
      hrmsApi.post<{ success: boolean }>(`/api/mcnmeet/meetings/${id}/recording`, { recording_url }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mcnmeet', 'meeting', id] }),
  });
}

export function getCalendarDownloadUrl(id: string): string {
  return `/api/mcnmeet/meetings/${id}/calendar.ics`;
}

export function useMarkAttendance(meetingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { invitee_id: string; joined_status: 'not_joined' | 'joined' | 'late'; remarks?: string }) =>
      hrmsApi.post<{ success: boolean }>(`/api/mcnmeet/meetings/${meetingId}/attendance`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mcnmeet', 'meeting', meetingId] }),
  });
}

export const MEETING_TYPE_LABELS: Record<MeetingType, string> = {
  team_meeting:       'Team Meeting',
  live_broadcast:     'Live Broadcast',
  training_induction: 'Training / Induction',
  interview:          'Interview',
  coaching_1on1:      '1:1 Coaching',
  compliance_policy:  'Compliance / Policy',
};

export const MEETING_STATUS_LABELS: Record<MeetingStatus, string> = {
  draft:     'Draft',
  scheduled: 'Scheduled',
  live:      'Live',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const STATUS_COLORS: Record<MeetingStatus, string> = {
  draft:     'bg-slate-100 text-slate-600',
  scheduled: 'bg-blue-100 text-blue-700',
  live:      'bg-green-100 text-green-700',
  completed: 'bg-purple-100 text-purple-700',
  cancelled: 'bg-red-100 text-red-600',
};

export const AUDIENCE_TYPE_LABELS: Record<AudienceType, string> = {
  all_company:            'Entire Company',
  branch:                 'Branch',
  department:             'Department',
  process:                'Process',
  lob:                    'LOB',
  designation:            'Designation',
  reporting_manager_team: 'Reporting Manager Team',
  selected_employees:     'Selected Employees',
};
