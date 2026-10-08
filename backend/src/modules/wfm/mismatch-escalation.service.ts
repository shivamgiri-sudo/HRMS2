// backend/src/modules/wfm/mismatch-escalation.service.ts
//
// Reporting-manager escalation for the WFM mismatch queue (mismatch-review.routes.ts).
//
// Flow: WFM/HR escalates an open mismatch -> the employee's reporting manager gets a Work Inbox
// item and records a recommended status -> WFM/HR makes the final resolution (which closes the
// escalation). A pending escalation past its due date can be pushed one level up (skip-level).
//
// Storage: attendance_mismatch_escalation (migration 1832). While that migration is not applied
// every function here degrades: reads return "no escalation", writes throw EscalationError(503).
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { randomUUID } from 'crypto';
import { db } from '../../db/mysql.js';
import { logger } from '../../logger.js';

export const ESCALATION_DUE_DAYS = 2;
export const MAX_ESCALATION_LEVEL = 2;
export const RECOMMENDABLE_STATUSES = [
  'present', 'half_day', 'absent', 'leave_approved', 'holiday', 'week_off', 'week_off_worked',
] as const;

const INBOX_ENTITY = 'attendance_mismatch';
const INBOX_TYPE = 'attendance_validation';
const OPEN_STATUSES = ['pending', 'recommended'] as const;

export class EscalationError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

function isMissingTable(err: unknown): boolean {
  const e = err as { code?: string; errno?: number };
  return e?.code === 'ER_NO_SUCH_TABLE' || e?.errno === 1146;
}

function unavailable(): EscalationError {
  return new EscalationError(503, 'Manager escalation is not enabled yet (database migration 1832 is pending).');
}

async function notify(
  userId: string,
  title: string,
  description: string,
  adrId: string,
  employeeId: string,
  recordDate: string,
) {
  try {
    const { inboxService } = await import('../inbox/inbox.service.js');
    await inboxService.createItem({
      user_id: userId,
      type: INBOX_TYPE,
      title,
      description,
      entity_type: INBOX_ENTITY,
      entity_id: adrId,
      action_url: `/wfm/attendance-integrity?tab=mismatches&employeeId=${employeeId}&fromDate=${recordDate}&toDate=${recordDate}`,
      priority: 'high',
    });
  } catch (err) {
    logger.warn({ err: (err as Error).message }, '[mismatch-escalation] inbox notification failed');
  }
}

/** Adds `escalation` (latest non-superseded, or null) to each queue row. Never throws. */
export async function attachEscalations<T extends RowDataPacket>(rows: T[], viewerUserId?: string) {
  if (rows.length === 0) return rows.map((r) => ({ ...r, escalation: null }));
  const ids = rows.map((r) => String(r.id));
  const latest = new Map<string, Record<string, unknown>>();
  try {
    const [esc] = await db.execute<RowDataPacket[]>(
      `SELECT x.id, x.adr_id, x.level, x.status, x.due_at, x.escalation_note,
              x.recommended_status, x.recommendation_note, x.responded_at, x.created_at,
              x.escalated_to_user_id, x.escalated_by_user_id,
              (x.status = 'pending' AND x.due_at < NOW()) AS is_overdue,
              CONCAT(m.first_name, ' ', COALESCE(m.last_name, '')) AS escalated_to_name,
              m.employee_code AS escalated_to_code
         FROM attendance_mismatch_escalation x
         LEFT JOIN employees m ON m.id = x.escalated_to_employee_id
        WHERE x.adr_id IN (${ids.map(() => '?').join(',')})
          AND x.status <> 'superseded'
        ORDER BY x.created_at DESC`,
      ids,
    );
    for (const row of esc as RowDataPacket[]) {
      if (latest.has(String(row.adr_id))) continue;
      latest.set(String(row.adr_id), {
        ...row,
        is_overdue: Boolean(Number(row.is_overdue)),
        can_respond: row.status === 'pending' && row.escalated_to_user_id === viewerUserId,
      });
    }
  } catch (err) {
    if (!isMissingTable(err)) logger.warn({ err: (err as Error).message }, '[mismatch-escalation] attach failed');
  }
  return rows.map((r) => ({ ...r, escalation: latest.get(String(r.id)) ?? null }));
}

/** Full escalation history for one record, newest first (drill-down drawer). Never throws. */
export async function escalationHistory(adrId: string) {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT x.*,
              CONCAT(t.first_name, ' ', COALESCE(t.last_name, '')) AS escalated_to_name,
              t.employee_code AS escalated_to_code,
              CONCAT(b.first_name, ' ', COALESCE(b.last_name, '')) AS escalated_by_name,
              b.employee_code AS escalated_by_code,
              (x.status = 'pending' AND x.due_at < NOW()) AS is_overdue
         FROM attendance_mismatch_escalation x
         LEFT JOIN employees t ON t.id = x.escalated_to_employee_id
         LEFT JOIN employees b ON b.user_id = x.escalated_by_user_id
        WHERE x.adr_id = ?
        ORDER BY x.created_at DESC`,
      [adrId],
    );
    return rows as RowDataPacket[];
  } catch (err) {
    if (!isMissingTable(err)) logger.warn({ err: (err as Error).message }, '[mismatch-escalation] history failed');
    return [] as RowDataPacket[];
  }
}

type ManagerRef = { employeeId: string; userId: string; name: string };

async function managerOf(employeeId: string): Promise<ManagerRef | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT m.id, m.user_id, CONCAT(m.first_name, ' ', COALESCE(m.last_name, '')) AS name
       FROM employees e
       JOIN employees m ON m.id = COALESCE(e.reporting_manager_id, e.manager_id)
      WHERE e.id = ? LIMIT 1`,
    [employeeId],
  );
  const m = (rows as RowDataPacket[])[0];
  if (!m || !m.user_id) return null;
  return { employeeId: String(m.id), userId: String(m.user_id), name: String(m.name).trim() };
}

export type EscalateInput = {
  adrId: string;
  employeeId: string;
  employeeLabel: string;
  recordDate: string;
  actorUserId: string;
  actorRole: string;
  note?: string | null;
};

export async function escalateToManager(input: EscalateInput) {
  let prior: RowDataPacket | undefined;
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, level, status, escalated_to_employee_id, (due_at < NOW()) AS overdue
         FROM attendance_mismatch_escalation
        WHERE adr_id = ? AND status IN ('pending','recommended')
        ORDER BY created_at DESC LIMIT 1`,
      [input.adrId],
    );
    prior = (rows as RowDataPacket[])[0];
  } catch (err) {
    if (isMissingTable(err)) throw unavailable();
    throw err;
  }

  let level = 1;
  let subjectEmployeeId = input.employeeId;
  if (prior) {
    if (prior.status === 'recommended') {
      throw new EscalationError(409, 'The manager has already recommended a status — resolve the record instead.');
    }
    if (!Number(prior.overdue)) {
      throw new EscalationError(409, 'Already escalated and still within the response window.');
    }
    level = Number(prior.level) + 1;
    if (level > MAX_ESCALATION_LEVEL) {
      throw new EscalationError(409, 'Already escalated to the skip-level manager — resolve the record directly.');
    }
    subjectEmployeeId = String(prior.escalated_to_employee_id);
  }

  const manager = await managerOf(subjectEmployeeId);
  if (!manager) {
    throw new EscalationError(
      422,
      level === 1
        ? 'This employee has no reporting manager with a login on record — assign one first.'
        : 'The reporting manager has no manager with a login on record.',
    );
  }

  const id = randomUUID();
  await db.execute<ResultSetHeader>(
    `INSERT INTO attendance_mismatch_escalation
       (id, adr_id, employee_id, record_date, level, escalated_by_user_id, escalated_by_role,
        escalated_to_employee_id, escalated_to_user_id, escalation_note, status, due_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', DATE_ADD(NOW(), INTERVAL ${ESCALATION_DUE_DAYS} DAY))`,
    [
      id, input.adrId, input.employeeId, input.recordDate, level, input.actorUserId, input.actorRole,
      manager.employeeId, manager.userId, (input.note ?? '').trim().slice(0, 500) || null,
    ],
  );
  if (prior) {
    await db.execute(`UPDATE attendance_mismatch_escalation SET status = 'superseded' WHERE id = ?`, [prior.id]);
  }

  await notify(
    manager.userId,
    `Attendance review needed: ${input.employeeLabel}`,
    `WFM asked for your recommendation on the attendance of ${input.employeeLabel} for ${input.recordDate}. `
      + `Please respond within ${ESCALATION_DUE_DAYS} days.`,
    input.adrId, input.employeeId, input.recordDate,
  );

  return { id, level, escalated_to_employee_id: manager.employeeId, escalated_to_name: manager.name };
}

export type RespondInput = {
  adrId: string;
  employeeId: string;
  employeeLabel: string;
  recordDate: string;
  actorUserId: string;
  recommendedStatus: string;
  note: string;
};

export async function recordManagerResponse(input: RespondInput) {
  if (!(RECOMMENDABLE_STATUSES as readonly string[]).includes(input.recommendedStatus)) {
    throw new EscalationError(400, `Invalid recommended_status: ${input.recommendedStatus}`);
  }
  let row: RowDataPacket | undefined;
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, escalated_by_user_id FROM attendance_mismatch_escalation
        WHERE adr_id = ? AND status = 'pending' AND escalated_to_user_id = ?
        ORDER BY created_at DESC LIMIT 1`,
      [input.adrId, input.actorUserId],
    );
    row = (rows as RowDataPacket[])[0];
  } catch (err) {
    if (isMissingTable(err)) throw unavailable();
    throw err;
  }
  if (!row) throw new EscalationError(403, 'There is no pending escalation on this record assigned to you.');

  await db.execute(
    `UPDATE attendance_mismatch_escalation
        SET status = 'recommended', recommended_status = ?, recommendation_note = ?, responded_at = NOW()
      WHERE id = ?`,
    [input.recommendedStatus, input.note.trim().slice(0, 500), row.id],
  );
  try {
    const { inboxService } = await import('../inbox/inbox.service.js');
    await inboxService.resolveItems({ entity_type: INBOX_ENTITY, entity_id: input.adrId, user_id: input.actorUserId });
  } catch (err) {
    logger.warn({ err: (err as Error).message }, '[mismatch-escalation] inbox close failed');
  }
  await notify(
    String(row.escalated_by_user_id),
    `Manager responded: ${input.employeeLabel}`,
    `Recommended "${input.recommendedStatus}" for ${input.recordDate}. Review and resolve the record.`,
    input.adrId, input.employeeId, input.recordDate,
  );
  return { id: String(row.id) };
}

/** Called after a record is resolved: closes any open escalation and its inbox items. Never throws. */
export async function closeEscalations(adrId: string, _employeeId: string): Promise<void> {
  try {
    await db.execute(
      `UPDATE attendance_mismatch_escalation SET status = 'resolved'
        WHERE adr_id = ? AND status IN (${OPEN_STATUSES.map(() => '?').join(',')})`,
      [adrId, ...OPEN_STATUSES],
    );
  } catch (err) {
    if (!isMissingTable(err)) logger.warn({ err: (err as Error).message }, '[mismatch-escalation] close failed');
  }
  try {
    const { inboxService } = await import('../inbox/inbox.service.js');
    await inboxService.resolveItems({ entity_type: INBOX_ENTITY, entity_id: adrId });
  } catch {
    // best effort — resolution itself already succeeded
  }
}
