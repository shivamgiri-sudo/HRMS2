import { v4 as uuidv4 } from "uuid";
import { sqlLimitOffset } from "../../db/pagination.js";
import crypto from "crypto";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { db } from "../../db/mysql.js";
import { env } from "../../config/env.js";
import type { MeetingType, MeetingStatus, AudienceRow, CreateMeetingInput, UpdateMeetingInput } from "./mcnmeet.types.js";
import { notifyMeetingCreated, notifyMeetingCancelled, notifyRecordingAvailable } from "./mcnmeet.notification.js";

interface MeetingRow extends RowDataPacket {
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

interface AudienceDbRow extends RowDataPacket {
  id: string;
  meeting_id: string;
  audience_type: string;
  audience_value: string | null;
  audience_label: string | null;
  created_at: Date;
}

interface InviteeRow extends RowDataPacket {
  id: string;
  meeting_id: string;
  employee_id: string;
  invite_status: string;
  joined_status: string;
  acknowledgement_status: string;
  joined_at: Date | null;
  left_at: Date | null;
  duration_seconds: number | null;
  remarks: string | null;
  created_at: Date;
  updated_at: Date;
  employee_code?: string;
  employee_name?: string;
  email?: string;
}

interface CountRow extends RowDataPacket {
  cnt: number;
}

interface IdRow extends RowDataPacket {
  id: string;
}

const MEETING_TYPE_SHORT: Record<MeetingType, string> = {
  team_meeting: 'team',
  live_broadcast: 'bcast',
  training_induction: 'train',
  interview: 'intv',
  coaching_1on1: '1on1',
  compliance_policy: 'comp',
};

export function generateRoomName(type: MeetingType, startAt: string): string {
  const dateStr = new Date(startAt).toISOString().slice(0, 10).replace(/-/g, '');
  const hex = crypto.randomBytes(3).toString('hex');
  return `mcnmeet-${MEETING_TYPE_SHORT[type] || 'mtg'}-${dateStr}-${hex}`;
}

export function buildJoinUrl(roomName: string): string {
  const base = env.MCNMEET_BASE_URL || 'https://mcnmeet.teammas.in';
  return `${base}/${roomName}#config.prejoinPageEnabled=true&config.disableDeepLinking=true`;
}

function generateMeetingCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'MCN-';
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export async function createMeeting(input: CreateMeetingInput, createdBy: string): Promise<string> {
  const id = uuidv4();
  const meetingCode = generateMeetingCode();
  const roomName = input.mcnmeet_room_name || generateRoomName(input.meeting_type, input.start_at);
  const joinUrl = buildJoinUrl(roomName);

  await db.execute<ResultSetHeader>(
    `INSERT INTO mcnmeet_meeting (
      id, meeting_code, title, description, meeting_type, status,
      host_employee_id, co_host_ids, start_at, end_at, duration_minutes, timezone,
      mcnmeet_room_name, mcnmeet_join_url, google_meet_backup_url,
      recording_required, attendance_required, acknowledgement_required, created_by
    ) VALUES (?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, meetingCode, input.title, input.description ?? null, input.meeting_type,
      input.host_employee_id, input.co_host_ids ? JSON.stringify(input.co_host_ids) : null,
      input.start_at, input.end_at ?? null, input.duration_minutes ?? null, input.timezone ?? 'Asia/Kolkata',
      roomName, joinUrl, input.google_meet_backup_url ?? null,
      input.recording_required ? 1 : 0, input.attendance_required ? 1 : 0, input.acknowledgement_required ? 1 : 0,
      createdBy,
    ]
  );

  for (const aud of input.audience) {
    await db.execute<ResultSetHeader>(
      `INSERT INTO mcnmeet_meeting_audience (id, meeting_id, audience_type, audience_value, audience_label)
       VALUES (?, ?, ?, ?, ?)`,
      [uuidv4(), id, aud.type, aud.value ?? null, aud.label ?? null]
    );
  }

  await logMeetingEvent(id, 'created', createdBy, { title: input.title });
  return id;
}

export async function getMeeting(id: string): Promise<MeetingRow | null> {
  const [rows] = await db.execute<MeetingRow[]>(
    `SELECT * FROM mcnmeet_meeting WHERE id = ?`,
    [id]
  );
  return rows[0] ?? null;
}

export async function getMeetingWithDetails(id: string) {
  const meeting = await getMeeting(id);
  if (!meeting) return null;

  const [audience] = await db.execute<AudienceDbRow[]>(
    `SELECT * FROM mcnmeet_meeting_audience WHERE meeting_id = ?`,
    [id]
  );

  const [invitees] = await db.execute<InviteeRow[]>(
    `SELECT i.*, e.employee_code, CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS employee_name, e.email
     FROM mcnmeet_meeting_invitee i
     LEFT JOIN employees e ON i.employee_id = e.id
     WHERE i.meeting_id = ?
     ORDER BY i.created_at`,
    [id]
  );

  return {
    ...meeting,
    audience: audience.map(a => ({ type: a.audience_type, value: a.audience_value, label: a.audience_label })),
    invitees,
  };
}

interface ListFilters {
  status?: MeetingStatus;
  type?: MeetingType;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

export async function listMeetings(filters: ListFilters = {}) {
  const conditions: string[] = [];
  const params: any[] = [];

  if (filters.status) {
    conditions.push('status = ?');
    params.push(filters.status);
  }
  if (filters.type) {
    conditions.push('meeting_type = ?');
    params.push(filters.type);
  }
  if (filters.from) {
    conditions.push('start_at >= ?');
    params.push(filters.from);
  }
  if (filters.to) {
    conditions.push('start_at <= ?');
    params.push(filters.to);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters.limit ?? 20;
  const offset = ((filters.page ?? 1) - 1) * limit;

  const [[meetings], [countResult]] = await Promise.all([
    db.execute<MeetingRow[]>(
      `SELECT * FROM mcnmeet_meeting ${where} ORDER BY start_at DESC ${sqlLimitOffset(limit, offset)}`,
      params
    ),
    db.execute<CountRow[]>(
      `SELECT COUNT(*) as cnt FROM mcnmeet_meeting ${where}`,
      params
    ),
  ]);

  return { meetings, total: countResult[0]?.cnt ?? 0 };
}

export async function listMyMeetings(employeeId: string, filters: ListFilters = {}) {
  const conditions: string[] = ['i.employee_id = ?'];
  const params: any[] = [employeeId];

  if (filters.status) {
    conditions.push('m.status = ?');
    params.push(filters.status);
  }
  if (filters.from) {
    conditions.push('m.start_at >= ?');
    params.push(filters.from);
  }
  if (filters.to) {
    conditions.push('m.start_at <= ?');
    params.push(filters.to);
  }

  const where = conditions.join(' AND ');
  const limit = filters.limit ?? 20;
  const offset = ((filters.page ?? 1) - 1) * limit;

  const [[meetings], [countResult]] = await Promise.all([
    db.execute<MeetingRow[]>(
      `SELECT m.* FROM mcnmeet_meeting m
       INNER JOIN mcnmeet_meeting_invitee i ON m.id = i.meeting_id
       WHERE ${where}
       ORDER BY m.start_at DESC ${sqlLimitOffset(limit, offset)}`,
      params
    ),
    db.execute<CountRow[]>(
      `SELECT COUNT(DISTINCT m.id) as cnt FROM mcnmeet_meeting m
       INNER JOIN mcnmeet_meeting_invitee i ON m.id = i.meeting_id
       WHERE ${where}`,
      params
    ),
  ]);

  return { meetings, total: countResult[0]?.cnt ?? 0 };
}

export async function updateMeeting(id: string, input: UpdateMeetingInput, updatedBy: string): Promise<boolean> {
  const sets: string[] = [];
  const params: any[] = [];

  if (input.title !== undefined) { sets.push('title = ?'); params.push(input.title); }
  if (input.description !== undefined) { sets.push('description = ?'); params.push(input.description); }
  if (input.meeting_type !== undefined) { sets.push('meeting_type = ?'); params.push(input.meeting_type); }
  if (input.status !== undefined) { sets.push('status = ?'); params.push(input.status); }
  if (input.start_at !== undefined) { sets.push('start_at = ?'); params.push(input.start_at); }
  if (input.end_at !== undefined) { sets.push('end_at = ?'); params.push(input.end_at); }
  if (input.duration_minutes !== undefined) { sets.push('duration_minutes = ?'); params.push(input.duration_minutes); }
  if (input.timezone !== undefined) { sets.push('timezone = ?'); params.push(input.timezone); }
  if (input.google_meet_backup_url !== undefined) { sets.push('google_meet_backup_url = ?'); params.push(input.google_meet_backup_url || null); }
  if (input.recording_required !== undefined) { sets.push('recording_required = ?'); params.push(input.recording_required ? 1 : 0); }
  if (input.attendance_required !== undefined) { sets.push('attendance_required = ?'); params.push(input.attendance_required ? 1 : 0); }
  if (input.acknowledgement_required !== undefined) { sets.push('acknowledgement_required = ?'); params.push(input.acknowledgement_required ? 1 : 0); }
  if (input.recording_url !== undefined) { sets.push('recording_url = ?'); params.push(input.recording_url || null); }

  if (sets.length === 0) return false;

  params.push(id);
  const [result] = await db.execute<ResultSetHeader>(`UPDATE mcnmeet_meeting SET ${sets.join(', ')} WHERE id = ?`, params);
  return result.affectedRows > 0;
}

export async function cancelMeeting(id: string, reason: string, cancelledBy: string): Promise<boolean> {
  const [result] = await db.execute<ResultSetHeader>(
    `UPDATE mcnmeet_meeting SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = ?, cancel_reason = ? WHERE id = ?`,
    [cancelledBy, reason, id]
  );
  if (result.affectedRows > 0) {
    await logMeetingEvent(id, 'cancelled', cancelledBy, { reason });
    // Fire-and-forget push notification to invitees
    notifyMeetingCancelled(id, reason).catch(() => {});
  }
  return result.affectedRows > 0;
}

export async function resolveInvitees(meetingId: string, resolvedBy: string): Promise<number> {
  const [audience] = await db.execute<AudienceDbRow[]>(
    `SELECT * FROM mcnmeet_meeting_audience WHERE meeting_id = ?`,
    [meetingId]
  );

  const employeeIds = new Set<string>();

  for (const aud of audience) {
    let ids: string[] = [];

    switch (aud.audience_type) {
      case 'all_company': {
        const [allRows] = await db.execute<IdRow[]>(`SELECT id FROM employees WHERE status = 'active'`);
        ids = allRows.map(r => r.id);
        break;
      }
      case 'branch':
        if (aud.audience_value) {
          const [branchRows] = await db.execute<IdRow[]>(
            `SELECT id FROM employees WHERE status = 'active' AND branch_id = ?`,
            [aud.audience_value]
          );
          ids = branchRows.map(r => r.id);
        }
        break;
      case 'process':
        if (aud.audience_value) {
          const [processRows] = await db.execute<IdRow[]>(
            `SELECT id FROM employees WHERE status = 'active' AND process_id = ?`,
            [aud.audience_value]
          );
          ids = processRows.map(r => r.id);
        }
        break;
      case 'lob':
        if (aud.audience_value) {
          const [lobRows] = await db.execute<IdRow[]>(
            `SELECT id FROM employees WHERE status = 'active' AND lob_id = ?`,
            [aud.audience_value]
          );
          ids = lobRows.map(r => r.id);
        }
        break;
      case 'designation':
        if (aud.audience_value) {
          const [desigRows] = await db.execute<IdRow[]>(
            `SELECT id FROM employees WHERE status = 'active' AND designation_id = ?`,
            [aud.audience_value]
          );
          ids = desigRows.map(r => r.id);
        }
        break;
      case 'reporting_manager_team':
        if (aud.audience_value) {
          const [teamRows] = await db.execute<IdRow[]>(
            `SELECT id FROM employees WHERE status = 'active' AND reporting_manager_id = ?`,
            [aud.audience_value]
          );
          ids = teamRows.map(r => r.id);
        }
        break;
      case 'selected_employees':
        if (aud.audience_value) {
          ids = aud.audience_value.split(',').map(s => s.trim()).filter(Boolean);
        }
        break;
    }

    ids.forEach(id => employeeIds.add(id));
  }

  let added = 0;
  for (const empId of employeeIds) {
    try {
      await db.execute<ResultSetHeader>(
        `INSERT IGNORE INTO mcnmeet_meeting_invitee (id, meeting_id, employee_id) VALUES (?, ?, ?)`,
        [uuidv4(), meetingId, empId]
      );
      added++;
    } catch {
      // duplicate, skip
    }
  }

  await logMeetingEvent(meetingId, 'invitees_resolved', resolvedBy, { count: added });

  // Fire-and-forget push notifications to newly resolved invitees
  if (added > 0) {
    notifyMeetingCreated(meetingId).catch(() => {});
  }

  return added;
}

export async function updateAttendance(
  meetingId: string,
  inviteeId: string,
  joinedStatus: 'not_joined' | 'joined' | 'late',
  remarks?: string,
  updatedBy?: string
): Promise<boolean> {
  const [result] = await db.execute<ResultSetHeader>(
    `UPDATE mcnmeet_meeting_invitee SET joined_status = ?, remarks = ?, joined_at = IF(? != 'not_joined', COALESCE(joined_at, NOW()), joined_at)
     WHERE id = ? AND meeting_id = ?`,
    [joinedStatus, remarks ?? null, joinedStatus, inviteeId, meetingId]
  );
  if (result.affectedRows > 0) {
    await logMeetingEvent(meetingId, 'attendance_marked', updatedBy ?? null, { inviteeId, joinedStatus });
  }
  return result.affectedRows > 0;
}

export async function selfJoin(meetingId: string, employeeId: string): Promise<boolean> {
  const [result] = await db.execute<ResultSetHeader>(
    `UPDATE mcnmeet_meeting_invitee SET joined_status = 'joined', joined_at = NOW()
     WHERE meeting_id = ? AND employee_id = ? AND joined_status = 'not_joined'`,
    [meetingId, employeeId]
  );
  return result.affectedRows > 0;
}

export async function acknowledgeInvite(meetingId: string, employeeId: string): Promise<boolean> {
  const [result] = await db.execute<ResultSetHeader>(
    `UPDATE mcnmeet_meeting_invitee SET acknowledgement_status = 'acknowledged'
     WHERE meeting_id = ? AND employee_id = ?`,
    [meetingId, employeeId]
  );
  return result.affectedRows > 0;
}

export async function updateRecording(meetingId: string, recordingUrl: string, updatedBy: string): Promise<boolean> {
  const [result] = await db.execute<ResultSetHeader>(
    `UPDATE mcnmeet_meeting SET recording_url = ? WHERE id = ?`,
    [recordingUrl, meetingId]
  );
  if (result.affectedRows > 0) {
    await logMeetingEvent(meetingId, 'recording_added', updatedBy, { recordingUrl });
    // Fire-and-forget push notification to attendees about recording
    notifyRecordingAvailable(meetingId, recordingUrl).catch(() => {});
  }
  return result.affectedRows > 0;
}

interface StatusCountRow extends RowDataPacket {
  status: string;
  cnt: number;
}

interface TypeCountRow extends RowDataPacket {
  meeting_type: string;
  cnt: number;
}

interface JoinedStatusCountRow extends RowDataPacket {
  joined_status: string;
  cnt: number;
}

export async function getSummaryReport(from?: string, to?: string) {
  const conditions: string[] = [];
  const params: any[] = [];

  if (from) { conditions.push('start_at >= ?'); params.push(from); }
  if (to) { conditions.push('start_at <= ?'); params.push(to); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [[statusCounts], [typeCounts], [totalInvitees], [attendanceStats]] = await Promise.all([
    db.execute<StatusCountRow[]>(
      `SELECT status, COUNT(*) as cnt FROM mcnmeet_meeting ${where} GROUP BY status`,
      params
    ),
    db.execute<TypeCountRow[]>(
      `SELECT meeting_type, COUNT(*) as cnt FROM mcnmeet_meeting ${where} GROUP BY meeting_type`,
      params
    ),
    db.execute<CountRow[]>(
      `SELECT COUNT(*) as cnt FROM mcnmeet_meeting_invitee i
       INNER JOIN mcnmeet_meeting m ON i.meeting_id = m.id ${where ? where : ''}`,
      params
    ),
    db.execute<JoinedStatusCountRow[]>(
      `SELECT i.joined_status, COUNT(*) as cnt FROM mcnmeet_meeting_invitee i
       INNER JOIN mcnmeet_meeting m ON i.meeting_id = m.id ${where ? where : ''}
       GROUP BY i.joined_status`,
      params
    ),
  ]);

  return {
    by_status: Object.fromEntries(statusCounts.map(r => [r.status, r.cnt])),
    by_type: Object.fromEntries(typeCounts.map(r => [r.meeting_type, r.cnt])),
    total_invitees: totalInvitees[0]?.cnt ?? 0,
    attendance: Object.fromEntries(attendanceStats.map(r => [r.joined_status, r.cnt])),
  };
}

async function logMeetingEvent(meetingId: string, eventType: string, actorId: string | null, eventData: any) {
  await db.execute<ResultSetHeader>(
    `INSERT INTO mcnmeet_meeting_event (id, meeting_id, event_type, actor_id, event_data) VALUES (?, ?, ?, ?, ?)`,
    [uuidv4(), meetingId, eventType, actorId, JSON.stringify(eventData)]
  );
}
