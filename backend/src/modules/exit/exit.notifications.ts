/**
 * Exit notifications — and the retirement path for one of the four private mailers.
 *
 * exit.service.ts:12 builds its own nodemailer transporter and its resignation mail has
 * three defects: it sends to employees.email (the PERSONAL address) for a workflow
 * notification, it copies nobody so HR never learns of a resignation by mail, and
 * `if (!emp?.mgr_email) return;` drops it silently when an employee has no manager — 165
 * of 1,152 active employees are in that state.
 *
 * Rather than delete that path (CLAUDE.md rule 3) or duplicate it, the two are chained:
 * notifyResignationSubmitted reports whether the gateway ACTUALLY delivered, and the
 * legacy mailer only runs when it did not. So there is never a double email, nothing is
 * removed, and the old path retires itself the moment resignation_submitted is switched
 * live. A strangler, not a rewrite.
 */
import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import { notificationGateway } from '../communication/notification.gateway.js';

interface ExitContextRow extends RowDataPacket {
  employee_id: string;
  employee_code: string | null;
  employee_name: string | null;
  branch_id: string | null;
  process_id: string | null;
  designation: string | null;
  date_of_joining: string | null;
  status: string;
  exit_reason_category: string | null;
  resignation_reason: string | null;
  notice_period_days: number | null;
  last_working_day_proposed: string | null;
  last_working_day_confirmed: string | null;
}

async function loadExitContext(exitRequestId: string): Promise<ExitContextRow | null> {
  const [rows] = await db.execute<ExitContextRow[]>(
    `SELECT er.employee_id,
            e.employee_code,
            COALESCE(NULLIF(TRIM(e.full_name), ''), e.employee_code) AS employee_name,
            e.branch_id, e.process_id, e.date_of_joining,
            d.designation_name AS designation,
            er.status, er.exit_reason_category, er.resignation_reason,
            er.notice_period_days, er.last_working_day_proposed, er.last_working_day_confirmed
       FROM exit_request er
       JOIN employees e ON e.id = er.employee_id
       LEFT JOIN designation_master d ON d.id = e.designation_id
      WHERE er.id = ?
      LIMIT 1`,
    [exitRequestId],
  );
  return rows[0] ?? null;
}

/** Whole years of service, or null when the joining date is unknown. */
function tenureYears(dateOfJoining: string | null): number | null {
  if (!dateOfJoining) return null;
  const doj = new Date(dateOfJoining);
  if (Number.isNaN(doj.getTime())) return null;
  return Math.round(((Date.now() - doj.getTime()) / (365.25 * 24 * 3600 * 1000)) * 10) / 10;
}

function daysUntil(date: string | null): number | null {
  if (!date) return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86_400_000);
}

/**
 * Resignation submitted.
 *
 * Returns true only when the gateway genuinely DELIVERED. Shadow, disabled, capped and
 * undeliverable all return false, so the caller keeps its legacy fallback until this
 * event is switched live — and does not double-send once it is.
 */
export async function notifyResignationSubmitted(exitRequestId: string): Promise<boolean> {
  try {
    const ctx = await loadExitContext(exitRequestId);
    if (!ctx) return false;
    const outcome = await notificationGateway.notify({
      eventCode: 'resignation_submitted',
      dedupeKey: `exit_request:${exitRequestId}:submitted`,
      context: { employeeId: ctx.employee_id, branchId: ctx.branch_id, processId: ctx.process_id },
      entityType: 'exit_request',
      entityId: exitRequestId,
      correlationId: `exit:${exitRequestId}`,
      data: {
        employee_name: ctx.employee_name,
        employee_code: ctx.employee_code,
        designation: ctx.designation,
        reason_category: ctx.exit_reason_category,
        reason: ctx.resignation_reason,
        notice_period_days: ctx.notice_period_days,
        proposed_lwd: ctx.last_working_day_proposed,
        // analytics: tenure and notice runway — what a manager needs to plan backfill
        tenure_years: tenureYears(ctx.date_of_joining),
        days_to_proposed_lwd: daysUntil(ctx.last_working_day_proposed),
      },
    });
    return outcome.outcome === 'sent';
  } catch (err) {
    console.error(`[exit-notify] submitted ${exitRequestId}:`, (err as Error).message);
    return false;
  }
}

/** Accepted / rejected / revoked. Revocation routes to its own event. */
export async function notifyResignationDecision(
  exitRequestId: string,
  decision: 'accepted' | 'rejected' | 'revoked',
): Promise<void> {
  try {
    const ctx = await loadExitContext(exitRequestId);
    if (!ctx) return;
    await notificationGateway.notify({
      eventCode: decision === 'revoked' ? 'resignation_revoked' : 'resignation_decision',
      // Decision in the key: an accept followed by a revoke is two legitimate
      // notifications, each firing exactly once.
      dedupeKey: `exit_request:${exitRequestId}:${decision}`,
      context: { employeeId: ctx.employee_id, branchId: ctx.branch_id, processId: ctx.process_id },
      entityType: 'exit_request',
      entityId: exitRequestId,
      correlationId: `exit:${exitRequestId}`,
      data: {
        employee_name: ctx.employee_name,
        employee_code: ctx.employee_code,
        decision,
        confirmed_lwd: ctx.last_working_day_confirmed,
        notice_period_days: ctx.notice_period_days,
        days_to_lwd: daysUntil(ctx.last_working_day_confirmed ?? ctx.last_working_day_proposed),
      },
    });
  } catch (err) {
    console.error(`[exit-notify] decision ${exitRequestId}:`, (err as Error).message);
  }
}

/**
 * Last working day approaching, with the open clearance count.
 *
 * The count is what makes this actionable — "3 items still open" is a task, "someone is
 * leaving" is a fact they already knew. Null when the checklist cannot be read, rather
 * than 0, which would read as "all clear".
 */
export async function notifyLastWorkingDayApproaching(exitRequestId: string): Promise<void> {
  try {
    const ctx = await loadExitContext(exitRequestId);
    if (!ctx) return;

    let pending: number | null = null;
    let departments: string | null = null;
    try {
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS pending,
                GROUP_CONCAT(DISTINCT department ORDER BY department SEPARATOR ', ') AS departments
           FROM exit_clearance_checklist
          WHERE exit_request_id = ? AND status = 'pending'`,
        [exitRequestId],
      );
      pending = rows[0]?.pending == null ? null : Number(rows[0].pending);
      departments = (rows[0]?.departments as string) ?? null;
    } catch { /* checklist unreadable — report null, not zero */ }

    await notificationGateway.notify({
      eventCode: 'exit_lwd_approaching',
      dedupeKey: `exit_request:${exitRequestId}:lwd`,
      context: { employeeId: ctx.employee_id, branchId: ctx.branch_id, processId: ctx.process_id },
      entityType: 'exit_request',
      entityId: exitRequestId,
      correlationId: `exit:${exitRequestId}`,
      data: {
        employee_name: ctx.employee_name,
        employee_code: ctx.employee_code,
        confirmed_lwd: ctx.last_working_day_confirmed,
        days_to_lwd: daysUntil(ctx.last_working_day_confirmed),
        clearance_pending: pending,
        clearance_departments: departments,
      },
    });
  } catch (err) {
    console.error(`[exit-notify] lwd ${exitRequestId}:`, (err as Error).message);
  }
}
