export type MeetingType =
  | 'team_meeting'
  | 'live_broadcast'
  | 'training_induction'
  | 'interview'
  | 'coaching_1on1'
  | 'compliance_policy';

export type MeetingStatus = 'draft' | 'scheduled' | 'live' | 'completed' | 'cancelled';

export type AudienceType =
  | 'all_company'
  | 'branch'
  | 'department'
  | 'process'
  | 'lob'
  | 'designation'
  | 'reporting_manager_team'
  | 'selected_employees';

export type InviteStatus = 'pending' | 'accepted' | 'declined';
export type JoinedStatus = 'not_joined' | 'joined' | 'late';
export type AckStatus = 'pending' | 'acknowledged';

export interface AudienceRow {
  type: AudienceType;
  value?: string;
  label?: string;
}

export interface CreateMeetingInput {
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

export interface UpdateMeetingInput {
  title?: string;
  description?: string;
  meeting_type?: MeetingType;
  status?: MeetingStatus;
  start_at?: string;
  end_at?: string;
  duration_minutes?: number;
  timezone?: string;
  google_meet_backup_url?: string;
  recording_required?: boolean;
  attendance_required?: boolean;
  acknowledgement_required?: boolean;
  recording_url?: string;
}

export interface MeetingRow {
  id: string;
  meeting_code: string;
  title: string;
  description: string | null;
  meeting_type: MeetingType;
  status: MeetingStatus;
  host_employee_id: string;
  co_host_ids: string | null;
  start_at: Date;
  end_at: Date | null;
  duration_minutes: number | null;
  timezone: string;
  mcnmeet_room_name: string;
  mcnmeet_join_url: string;
  google_meet_backup_url: string | null;
  recording_required: number;
  attendance_required: number;
  acknowledgement_required: number;
  recording_url: string | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
  cancelled_at: Date | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
}

export interface InviteeRow {
  id: string;
  meeting_id: string;
  employee_id: string;
  invite_status: InviteStatus;
  joined_status: JoinedStatus;
  acknowledgement_status: AckStatus;
  joined_at: Date | null;
  left_at: Date | null;
  duration_seconds: number | null;
  remarks: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface AudienceDbRow {
  id: string;
  meeting_id: string;
  audience_type: AudienceType;
  audience_value: string | null;
  audience_label: string | null;
  created_at: Date;
}
