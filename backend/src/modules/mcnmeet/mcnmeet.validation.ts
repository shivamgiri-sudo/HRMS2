import { z } from "zod";

const meetingTypes = ['team_meeting', 'live_broadcast', 'training_induction', 'interview', 'coaching_1on1', 'compliance_policy'] as const;
const meetingStatuses = ['draft', 'scheduled', 'live', 'completed', 'cancelled'] as const;
const audienceTypes = ['all_company', 'branch', 'department', 'process', 'lob', 'designation', 'reporting_manager_team', 'selected_employees'] as const;
const joinedStatuses = ['not_joined', 'joined', 'late'] as const;

const audienceRowSchema = z.object({
  type: z.enum(audienceTypes),
  value: z.string().optional(),
  label: z.string().optional(),
});

export const createMeetingSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().max(5000).optional(),
  meeting_type: z.enum(meetingTypes),
  start_at: z.string().min(1),
  end_at: z.string().optional(),
  duration_minutes: z.number().int().positive().optional(),
  timezone: z.string().max(50).default('Asia/Kolkata'),
  host_employee_id: z.string().min(1),
  co_host_ids: z.array(z.string()).optional(),
  audience: z.array(audienceRowSchema).min(1),
  mcnmeet_room_name: z.string().regex(/^[A-Za-z0-9_-]{0,80}$/).optional(),
  google_meet_backup_url: z.string().url().optional().or(z.literal('')),
  recording_required: z.boolean().default(false),
  attendance_required: z.boolean().default(false),
  acknowledgement_required: z.boolean().default(false),
});

export const updateMeetingSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(5000).optional(),
  meeting_type: z.enum(meetingTypes).optional(),
  status: z.enum(meetingStatuses).optional(),
  start_at: z.string().optional(),
  end_at: z.string().optional(),
  duration_minutes: z.number().int().positive().optional(),
  timezone: z.string().max(50).optional(),
  google_meet_backup_url: z.string().url().optional().or(z.literal('')),
  recording_required: z.boolean().optional(),
  attendance_required: z.boolean().optional(),
  acknowledgement_required: z.boolean().optional(),
  recording_url: z.string().url().optional().or(z.literal('')),
});

export const cancelMeetingSchema = z.object({
  cancel_reason: z.string().min(1).max(1000),
});

export const attendanceUpdateSchema = z.object({
  invitee_id: z.string().min(1),
  joined_status: z.enum(joinedStatuses),
  remarks: z.string().max(500).optional(),
});

export const recordingUpdateSchema = z.object({
  recording_url: z.string().url(),
});

export const selfJoinSchema = z.object({
  joined_at: z.string().optional(),
});

export type CreateMeetingPayload = z.infer<typeof createMeetingSchema>;
export type UpdateMeetingPayload = z.infer<typeof updateMeetingSchema>;
