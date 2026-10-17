// backend/src/modules/wfm/apr-cosec-manager-decision.service.ts
//
// Owner ruling 2026-10-17: "if Attendance source is APR then it should be notified to reporting
// manager to decide the attendance; if attendance source is Cosec then there is no issue, mark it
// present if cosec condition meets."
//
// So for an employee judged on APR (dialler net login), a day where COSEC (biometric) qualifies for
// a BETTER status than APR is neither auto-upgraded from COSEC (what 'apr_validated_by_cosec' used
// to do) nor left silently at the APR verdict. The APR status stands, the row carries
// mismatch_flag = 1, and the employee's reporting manager gets one pending decision per
// employee-date. The manager's choice (present / half day / absent) is written onto the day as an
// override and locks it.
//
// Storage reuses the WFM mismatch escalation (attendance_mismatch_escalation, migration 1832):
// a system-raised row is told apart from a WFM-raised one by escalated_by_role = APR_COSEC_ROLE.
// The manager is notified through the Work Inbox (work_inbox_item), which every role including
// plain 'employee' can open — most reporting managers of APR staff hold no WFM role at all.
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { randomUUID } from 'crypto';
import { db } from '../../db/mysql.js';
import { logger } from '../../logger.js';
import { logSensitiveAction } from '../../shared/auditLog.js';
import { ESCALATION_DUE_DAYS, managerOf } from './mismatch-escalation.service.js';

export const APR_COSEC_ROLE = 'system:apr_cosec';
export const APR_COSEC_INBOX_ENTITY = 'attendance_apr_cosec_decision';
const INBOX_TYPE = 'attendance_validation';
const SYSTEM_ACTOR = 'system';

export const DECISION_STATUSES = ['present', 'half_day', 'absent'] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

/** Same lwp values the classifiers (classifyOperationsNetLogin / classifyCosecMinutes) produce. */
const LWP_FOR: Record<DecisionStatus, number> = { present: 0.0, half_day: 0.5, absent: 1.0 };

const RANK: Record<string, number> = { absent: 0, half_day: 1, present: 2 };
const CLOSED_RUN_STATUSES = ['FINALIZED', 'LOCKED', 'DISBURSED'];

export class DecisionError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

function rank(status: string | null | undefined): number {
  return status && status in RANK ? RANK[status]! : -1;
}

/**
 * True when COSEC would credit the day with more than the status it carries under APR.
 * Pure — the engine, the APR bulk upload and tests all ask the same question through this.
 */
export function cosecBeatsApr(currentStatus: string | null | undefined, biometricStatus: string | null | undefined, biometricMinutes: number | null | undefined): boolean {
  if (!(Number(biometricMinutes ?? 0) > 0)) return false;
  if (rank(currentStatus) < 0) return false; // leave / holiday / week-off / missing_punch: not this question
  return rank(biometricStatus) > rank(currentStatus);
}

function isMissingTable(err: unknown): boolean {
  const e = err as { code?: string; errno?: number };
  return e?.code === 'ER_NO_SUCH_TABLE' || e?.errno === 1146;
}

const fmtMin = (m: number | null | undefined) => {
  const v = Math.max(0, Math.round(Number(m ?? 0)));
  return `${Math.floor(v / 60)}h ${String(v % 60).padStart(2, '0')}m (${v} min)`;
};
const label = (s: string | null | undefined) => String(s ?? '-').replace('_', ' ');

async function punchWindow(employeeId: string, date: string): Promise<string | null> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(MIN(first_punch_in), '%Y-%m-%d %H:%i') AS first_in,
              DATE_FORMAT(MAX(last_punch_out), '%Y-%m-%d %H:%i') AS last_out
         FROM biometric_attendance_log
        WHERE employee_id = ? AND punch_date = ?`,
      [employeeId, date],
    );
    const r = (rows as RowDataPacket[])[0];
    if (!r || (!r.first_in && !r.last_out)) return null;
    return `first punch ${r.first_in ?? '-'}, last punch ${r.last_out ?? '-'}`;
  } catch {
    return null;
  }
}

export type RaiseInput = {
  adrId: string;
  employeeId: string;
  recordDate: string;
  currentStatus: string;
  aprMinutes: number | null;
  biometricMinutes: number;
  biometricStatus: string;
};

export type RaiseOutcome = 'raised' | 'exists' | 'already_escalated' | 'no_manager' | 'not_needed' | 'unavailable';

/**
 * One pending manager decision per attendance_daily_record row, ever. Never throws: the caller is an
 * attendance write that has already succeeded and must not fail because a notification could not be
 * raised — the row's mismatch_flag keeps it on the WFM queue either way.
 */
export async function raiseAprCosecDecision(input: RaiseInput): Promise<RaiseOutcome> {
  try {
    if (!cosecBeatsApr(input.currentStatus, input.biometricStatus, input.biometricMinutes)) return 'not_needed';

    const [existing] = await db.execute<RowDataPacket[]>(
      `SELECT escalated_by_role, status FROM attendance_mismatch_escalation
        WHERE adr_id = ? AND (escalated_by_role = ? OR status IN ('pending','recommended'))
        LIMIT 1`,
      [input.adrId, APR_COSEC_ROLE],
    );
    const prior = (existing as RowDataPacket[])[0];
    if (prior) return prior.escalated_by_role === APR_COSEC_ROLE ? 'exists' : 'already_escalated';

    const manager = await managerOf(input.employeeId);
    if (!manager) return 'no_manager';

    const [empRows] = await db.execute<RowDataPacket[]>(
      `SELECT employee_code, CONCAT(first_name, ' ', COALESCE(last_name, '')) AS name FROM employees WHERE id = ? LIMIT 1`,
      [input.employeeId],
    );
    const emp = (empRows as RowDataPacket[])[0];
    const who = emp ? `${String(emp.name).trim()} (${emp.employee_code})` : input.employeeId;

    const punches = await punchWindow(input.employeeId, input.recordDate);
    const readings = `APR net login ${fmtMin(input.aprMinutes)} = ${label(input.currentStatus)}; `
      + `COSEC ${fmtMin(input.biometricMinutes)} = ${label(input.biometricStatus)}`
      + (punches ? ` (${punches})` : '');

    // INSERT ... SELECT ... WHERE NOT EXISTS: one statement, so two engine runs racing on the same
    // day cannot both raise an item.
    const id = randomUUID();
    const [ins] = await db.execute<ResultSetHeader>(
      `INSERT INTO attendance_mismatch_escalation
         (id, adr_id, employee_id, record_date, level, escalated_by_user_id, escalated_by_role,
          escalated_to_employee_id, escalated_to_user_id, escalation_note, status, due_at)
       SELECT ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 'pending', DATE_ADD(NOW(), INTERVAL ${ESCALATION_DUE_DAYS} DAY)
         FROM DUAL
        WHERE NOT EXISTS (
          SELECT 1 FROM attendance_mismatch_escalation x
           WHERE x.adr_id = ? AND (x.escalated_by_role = ? OR x.status IN ('pending','recommended'))
        )`,
      [
        id, input.adrId, input.employeeId, input.recordDate, SYSTEM_ACTOR, APR_COSEC_ROLE,
        manager.employeeId, manager.userId, readings.slice(0, 500),
        input.adrId, APR_COSEC_ROLE,
      ],
    );
    if (!ins.affectedRows) return 'exists';

    try {
      const { inboxService } = await import('../inbox/inbox.service.js');
      await inboxService.createItem({
        user_id: manager.userId,
        type: INBOX_TYPE,
        title: `Decide attendance: ${who} on ${input.recordDate}`,
        description: `${readings}. The day is marked ${label(input.currentStatus)} from APR. `
          + `Your team member is judged on APR, so COSEC is not applied automatically - choose Present, Half day or Absent.`,
        entity_type: APR_COSEC_INBOX_ENTITY,
        entity_id: input.adrId,
        priority: 'high',
      });
    } catch (err) {
      logger.warn({ err: (err as Error).message, adrId: input.adrId }, '[apr-cosec-decision] inbox notification failed');
    }
    return 'raised';
  } catch (err) {
    if (isMissingTable(err)) return 'unavailable';
    logger.warn({ err: (err as Error).message, adrId: input.adrId }, '[apr-cosec-decision] raise failed');
    return 'unavailable';
  }
}

/** The open system-raised decision on this record assigned to this user, or null. */
export async function pendingDecisionFor(adrId: string, userId: string): Promise<RowDataPacket | null> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, employee_id, DATE_FORMAT(record_date, '%Y-%m-%d') AS record_date
         FROM attendance_mismatch_escalation
        WHERE adr_id = ? AND escalated_by_role = ? AND status = 'pending' AND escalated_to_user_id = ?
        ORDER BY created_at DESC LIMIT 1`,
      [adrId, APR_COSEC_ROLE, userId],
    );
    return (rows as RowDataPacket[])[0] ?? null;
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

async function monthClosedByPayroll(recordDate: string): Promise<boolean> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT 1 FROM salary_prep_run
      WHERE run_month = ?
        AND UPPER(status) IN (${CLOSED_RUN_STATUSES.map(() => '?').join(',')})
        AND COALESCE(scope_kind, 'company') <> 'scoped'
        AND COALESCE(branch_filter, '') = ''
        AND COALESCE(process_filter, '') = ''
      LIMIT 1`,
    [recordDate.slice(0, 7), ...CLOSED_RUN_STATUSES],
  );
  return (rows as RowDataPacket[]).length > 0;
}

export type DecideInput = {
  adrId: string;
  actorUserId: string;
  actorRole: string;
  status: string;
  note?: string | null;
};

/**
 * The reporting manager's decision. Writes the day the way a manual WFM correction does
 * (attendanceEngineService.correctDailyRecord: override_by / override_reason / is_locked = 1, so the
 * nightly engine cannot recompute it) and closes the mismatch the way the WFM resolve does.
 */
export async function applyManagerDecision(input: DecideInput) {
  if (!(DECISION_STATUSES as readonly string[]).includes(input.status)) {
    throw new DecisionError(400, `status must be one of ${DECISION_STATUSES.join(', ')}`);
  }
  const status = input.status as DecisionStatus;
  const pending = await pendingDecisionFor(input.adrId, input.actorUserId);
  if (!pending) throw new DecisionError(403, 'There is no pending attendance decision on this day assigned to you.');

  const [recRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, employee_id, DATE_FORMAT(record_date, '%Y-%m-%d') AS record_date, attendance_status, lwp_value,
            is_locked, override_by, regularization_id, source_system
       FROM attendance_daily_record WHERE id = ? LIMIT 1`,
    [input.adrId],
  );
  const rec = (recRows as RowDataPacket[])[0];
  if (!rec) throw new DecisionError(404, 'Attendance record not found');
  if (Number(rec.is_locked) === 1 && (rec.override_by || rec.regularization_id || rec.source_system !== 'apr_bulk')) {
    throw new DecisionError(409, 'This day has already been corrected or frozen for payroll - ask WFM to review it.');
  }
  if (await monthClosedByPayroll(String(rec.record_date))) {
    throw new DecisionError(409, 'Payroll for this month is already finalized - ask WFM / payroll to review it.');
  }

  const note = String(input.note ?? '').trim().slice(0, 400);
  const reason = `Reporting manager decision (APR vs COSEC): ${label(status)}${note ? ` - ${note}` : ''}`;
  const [upd] = await db.execute<ResultSetHeader>(
    `UPDATE attendance_daily_record
        SET attendance_status          = ?,
            lwp_value                  = ?,
            override_by                = ?,
            override_reason            = ?,
            is_locked                  = 1,
            mismatch_flag              = 0,
            mismatch_resolved_at       = NOW(),
            mismatch_resolved_by       = ?,
            mismatch_resolution_reason = ?,
            processed_at               = NOW()
      WHERE id = ?
        AND (is_locked = 0 OR (source_system = 'apr_bulk' AND override_by IS NULL AND regularization_id IS NULL))`,
    [status, LWP_FOR[status], input.actorUserId, reason, input.actorUserId, reason, input.adrId],
  );
  if (!upd.affectedRows) {
    throw new DecisionError(409, 'This day changed while you were deciding - reopen it and try again.');
  }

  await db.execute(
    `UPDATE attendance_mismatch_escalation
        SET status = 'resolved', recommended_status = ?, recommendation_note = ?, responded_at = NOW()
      WHERE id = ?`,
    [status, note || null, pending.id],
  );
  try {
    const { inboxService } = await import('../inbox/inbox.service.js');
    await inboxService.resolveItems({ entity_type: APR_COSEC_INBOX_ENTITY, entity_id: input.adrId });
  } catch (err) {
    logger.warn({ err: (err as Error).message }, '[apr-cosec-decision] inbox close failed');
  }

  await logSensitiveAction({
    actor_user_id: input.actorUserId,
    actor_role: input.actorRole,
    action_type: 'ATTENDANCE_APR_COSEC_MANAGER_DECISION',
    module_key: 'attendance',
    entity_type: 'attendance_daily_record',
    entity_id: input.adrId,
    employee_id: String(rec.employee_id),
    old_value_json: { attendance_status: rec.attendance_status, lwp_value: rec.lwp_value },
    new_value_json: { attendance_status: status, lwp_value: LWP_FOR[status], note: note || null },
  });

  return { adrId: input.adrId, recordDate: String(rec.record_date), status, lwpValue: LWP_FOR[status] };
}

export type BulkRow = { employeeId: string; date: string; status: string; aprMinutes: number };

/**
 * After an APR bulk upload: for every saved row the file marked absent / half day, read COSEC the
 * way the engine does and raise a manager decision where COSEC qualifies for more. The bulk write
 * itself never consults COSEC, so without this those days would sit at the APR verdict silently.
 * Sequential on purpose — this runs after the response, and a large file must not flood the pool.
 */
export async function raiseDecisionsForBulkRows(rows: BulkRow[]): Promise<Record<RaiseOutcome, number>> {
  const counts: Record<RaiseOutcome, number> = {
    raised: 0, exists: 0, already_escalated: 0, no_manager: 0, not_needed: 0, unavailable: 0,
  };
  const candidates = rows.filter((r) => r.status === 'absent' || r.status === 'half_day');
  if (candidates.length === 0) return counts;

  const engine = await import('./attendance-engine.service.js');
  const svc = engine.attendanceEngineService;
  const halfDayFloor = await engine.resolveHalfDayFloorMinutes('biometric_half_day_floor_minutes');
  const buckets = await svc.getExceptionBucketMap();

  for (const r of candidates) {
    try {
      const evidence = await svc.getBiometricEvidence(r.employeeId, r.date);
      if (!(evidence.minutes > 0)) { counts.not_needed++; continue; }
      const fullDay = buckets.get(r.employeeId)?.fullDayThresholdMinutes ?? engine.COSEC_DEFAULT_FULL_DAY_MINUTES;
      const bio = engine.classifyCosecMinutes(evidence.minutes, halfDayFloor, fullDay).status;
      if (!cosecBeatsApr(r.status, bio, evidence.minutes)) { counts.not_needed++; continue; }

      // Record both readings on the row (the bulk write leaves them as whatever the engine last
      // wrote) so the WFM queue shows the disagreement. Attendance status is NOT touched.
      const [upd] = await db.execute<ResultSetHeader>(
        `UPDATE attendance_daily_record
            SET biometric_minutes = ?, biometric_status = ?, apr_status = ?, mismatch_flag = 1
          WHERE employee_id = ? AND record_date = ?
            AND source_system = 'apr_bulk' AND override_by IS NULL AND regularization_id IS NULL
            AND attendance_status = ?`,
        [evidence.minutes, bio, r.status, r.employeeId, r.date, r.status],
      );
      if (!upd.affectedRows) { counts.not_needed++; continue; }
      const [idRows] = await db.execute<RowDataPacket[]>(
        `SELECT id FROM attendance_daily_record WHERE employee_id = ? AND record_date = ? LIMIT 1`,
        [r.employeeId, r.date],
      );
      const adrId = (idRows as RowDataPacket[])[0]?.id;
      if (!adrId) { counts.not_needed++; continue; }
      const outcome = await raiseAprCosecDecision({
        adrId: String(adrId), employeeId: r.employeeId, recordDate: r.date, currentStatus: r.status,
        aprMinutes: r.aprMinutes, biometricMinutes: evidence.minutes, biometricStatus: bio,
      });
      counts[outcome]++;
    } catch (err) {
      counts.unavailable++;
      logger.warn({ err: (err as Error).message, employeeId: r.employeeId, date: r.date }, '[apr-cosec-decision] bulk row failed');
    }
  }
  return counts;
}
