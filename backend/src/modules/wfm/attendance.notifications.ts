/**
 * Attendance notifications — third business area on the notification gateway.
 *
 * Same contract as roster and leave: fire-and-forget, swallows its own errors, sits
 * alongside the existing audit and inbox paths rather than replacing them. Approving a
 * regularization must never fail because a mail server is down.
 *
 * Nothing sends today — every attendance event ships enabled=0, dispatch_mode='shadow'
 * (migration 1022).
 */
import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import { notificationGateway } from '../communication/notification.gateway.js';

interface RegContextRow extends RowDataPacket {
  employee_id: string;
  employee_code: string | null;
  employee_name: string | null;
  branch_id: string | null;
  process_id: string | null;
  session_date: string;
  requested_status: string | null;
  current_attendance_status: string | null;
  reason: string | null;
  reviewer_name: string | null;
}

async function loadRegContext(regularizationId: string): Promise<RegContextRow | null> {
  const [rows] = await db.execute<RegContextRow[]>(
    `SELECT ar.employee_id,
            e.employee_code,
            COALESCE(NULLIF(TRIM(e.full_name), ''), e.employee_code) AS employee_name,
            e.branch_id, e.process_id,
            ar.session_date, ar.requested_status, ar.reason,
            adr.attendance_status AS current_attendance_status,
            COALESCE(NULLIF(TRIM(rev.full_name), ''), rev.employee_code) AS reviewer_name
       FROM attendance_regularization ar
       JOIN employees e ON e.id = ar.employee_id
       LEFT JOIN attendance_daily_record adr
              ON adr.employee_id = ar.employee_id AND adr.record_date = ar.session_date
       LEFT JOIN users u ON u.id = ar.reviewed_by
       LEFT JOIN employees rev ON rev.id = u.employee_id
      WHERE ar.id = ?
      LIMIT 1`,
    [regularizationId],
  );
  return rows[0] ?? null;
}

/**
 * Attendance percentage for the month containing `onDate`.
 *
 * Deliberately excludes holidays and week-offs from the denominator — counting a Sunday
 * against someone's attendance is the kind of wrong figure that destroys trust in the
 * whole notification. half_day counts as 0.5, leave_approved counts as present because
 * approved leave is not an attendance failure.
 *
 * Returns null when there are no qualifying days, rather than 0 or NaN: an employee who
 * joined mid-month has no percentage yet, and reporting 0% would be a lie.
 */
async function attendancePercentForMonth(
  employeeId: string,
  onDate: string,
): Promise<{ pct: number | null; presentDays: number | null; workingDays: number | null }> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         SUM(CASE WHEN attendance_status IN ('present','leave_approved') THEN 1
                  WHEN attendance_status = 'half_day' THEN 0.5 ELSE 0 END) AS present_days,
         SUM(CASE WHEN attendance_status NOT IN ('holiday','week_off') THEN 1 ELSE 0 END) AS working_days
       FROM attendance_daily_record
      WHERE employee_id = ?
        AND YEAR(record_date) = YEAR(?) AND MONTH(record_date) = MONTH(?)`,
      [employeeId, onDate, onDate],
    );
    const present = Number(rows[0]?.present_days ?? 0);
    const working = Number(rows[0]?.working_days ?? 0);
    if (!working) return { pct: null, presentDays: null, workingDays: null };
    return { pct: Math.round((present / working) * 1000) / 10, presentDays: present, workingDays: working };
  } catch {
    return { pct: null, presentDays: null, workingDays: null };
  }
}

/**
 * Final regularization decision — To the employee, CC manager and the WFM chain.
 *
 * `status` is passed in because the caller has just computed it through
 * nextRegularizationStatus() and re-reading could race the attendance rebuild.
 */
export async function notifyRegularizationDecision(
  regularizationId: string,
  status: 'approved' | 'rejected',
  reviewerNote?: string | null,
): Promise<void> {
  try {
    const ctx = await loadRegContext(regularizationId);
    if (!ctx) return;
    const att = await attendancePercentForMonth(ctx.employee_id, ctx.session_date);
    await notificationGateway.notify({
      eventCode: 'regularization_decision',
      dedupeKey: `attendance_regularization:${regularizationId}:${status}`,
      context: { employeeId: ctx.employee_id, branchId: ctx.branch_id, processId: ctx.process_id },
      entityType: 'attendance_regularization',
      entityId: regularizationId,
      correlationId: `regularization:${regularizationId}`,
      data: {
        employee_name: ctx.employee_name,
        employee_code: ctx.employee_code,
        decision: status,
        date: String(ctx.session_date).slice(0, 10),
        session_date: String(ctx.session_date).slice(0, 10),
        requested_status: ctx.requested_status,
        reviewer_note: reviewerNote ?? null,
        remarks: reviewerNote ?? '',
        reviewer_name: ctx.reviewer_name ?? '',
        // analytics strip (catalogue 6.3): days corrected · attendance % after
        days_corrected: status === 'approved' ? 1 : 0,
        attendance_pct_mtd: att.pct,
        present_days_mtd: att.presentDays,
        working_days_mtd: att.workingDays,
      },
    });
  } catch (err) {
    console.error(`[attendance-notify] decision ${regularizationId}:`, (err as Error).message);
  }
}

/**
 * Stage-1 done, awaiting the Branch WFM SPOC.
 *
 * Routed to the wfm_chain selector, which falls back through role+scope to branch HR —
 * branch_wfm_spoc_config is empty in production, so a bare wfm_spoc recipient would
 * address nobody and this queue would sit unworked with no one told.
 */
export async function notifyRegularizationStage2Pending(regularizationId: string): Promise<void> {
  try {
    const ctx = await loadRegContext(regularizationId);
    if (!ctx) return;
    const [queue] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS pending,
              MIN(created_at) AS oldest
         FROM attendance_regularization
        WHERE status = 'manager_approved'`,
    ).catch(() => [[{ pending: null, oldest: null }]] as unknown as [RowDataPacket[]]);

    await notificationGateway.notify({
      eventCode: 'regularization_stage2_pending',
      dedupeKey: `attendance_regularization:${regularizationId}:stage2`,
      context: { employeeId: ctx.employee_id, branchId: ctx.branch_id, processId: ctx.process_id },
      entityType: 'attendance_regularization',
      entityId: regularizationId,
      correlationId: `regularization:${regularizationId}`,
      data: {
        employee_name: ctx.employee_name,
        employee_code: ctx.employee_code,
        session_date: String(ctx.session_date).slice(0, 10),
        requested_status: ctx.requested_status,
        // analytics: how deep the queue is, so the SPOC knows whether this is one item
        // or a backlog
        queue_depth: queue[0]?.pending == null ? null : Number(queue[0].pending),
        oldest_pending: queue[0]?.oldest ?? null,
      },
    });
  } catch (err) {
    console.error(`[attendance-notify] stage2 ${regularizationId}:`, (err as Error).message);
  }
}

/** Submission alert to the approver. */
export async function notifyRegularizationSubmitted(regularizationId: string): Promise<void> {
  try {
    const ctx = await loadRegContext(regularizationId);
    if (!ctx) return;
    const att = await attendancePercentForMonth(ctx.employee_id, ctx.session_date);
    await notificationGateway.notify({
      eventCode: 'regularization_submitted',
      dedupeKey: `attendance_regularization:${regularizationId}:submitted`,
      context: { employeeId: ctx.employee_id, branchId: ctx.branch_id, processId: ctx.process_id },
      entityType: 'attendance_regularization',
      entityId: regularizationId,
      correlationId: `regularization:${regularizationId}`,
      data: {
        employee_name: ctx.employee_name,
        employee_code: ctx.employee_code,
        session_date: String(ctx.session_date).slice(0, 10),
        current_status: ctx.current_attendance_status,
        requested_status: ctx.requested_status,
        reason: ctx.reason,
        attendance_pct_mtd: att.pct,
      },
    });
  } catch (err) {
    console.error(`[attendance-notify] submitted ${regularizationId}:`, (err as Error).message);
  }
}
