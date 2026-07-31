/**
 * Leave notifications — the second business area wired to the notification gateway.
 *
 * Same shape as roster.notifications.ts: fire-and-forget, swallows its own errors, and
 * sits alongside the existing SMS and work-inbox paths rather than replacing them
 * (CLAUDE.md rule 3). Approving leave must never fail because a mail server is down.
 *
 * Nothing sends today — every leave event ships enabled=0, dispatch_mode='shadow'
 * (migration 1022).
 */
import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import { notificationGateway } from '../communication/notification.gateway.js';

interface LeaveContextRow extends RowDataPacket {
  employee_id: string;
  employee_code: string | null;
  employee_name: string | null;
  branch_id: string | null;
  process_id: string | null;
  leave_type_id: string | null;
  leave_name: string | null;
  leave_code: string | null;
  from_date: string;
  to_date: string;
  total_days: number | null;
  reason: string | null;
  status: string;
}

/** Everything a leave notification needs, in one query. */
async function loadLeaveContext(requestId: string): Promise<LeaveContextRow | null> {
  const [rows] = await db.execute<LeaveContextRow[]>(
    `SELECT lr.employee_id,
            e.employee_code,
            COALESCE(NULLIF(TRIM(e.full_name), ''), e.employee_code) AS employee_name,
            e.branch_id, e.process_id,
            lr.leave_type_id, lt.leave_name, lt.leave_code,
            lr.from_date, lr.to_date, lr.total_days, lr.reason, lr.status
       FROM leave_request lr
       JOIN employees e            ON e.id = lr.employee_id
       LEFT JOIN leave_type_master lt ON lt.id = lr.leave_type_id
      WHERE lr.id = ?
      LIMIT 1`,
    [requestId],
  );
  return rows[0] ?? null;
}

/**
 * Remaining balance for the leave type this request used, plus days taken this year.
 *
 * Reuses leaveService.getBalance rather than writing fresh SQL: that function already
 * collapses the legacy leave-type twins seeded by 052_legacy_migration_tables.sql
 * ('PTRL' alongside 'PL', 'MTRL' alongside 'ML'). A naive balance query would report one
 * of the pair and understate the employee's entitlement.
 *
 * Returns nulls rather than zeros when the balance cannot be read — the catalogue rule is
 * that a figure the backend cannot stand behind is omitted, not defaulted.
 */
async function loadBalanceFigures(
  employeeId: string,
  leaveTypeId: string | null,
): Promise<{ balanceAfter: number | null; takenYtd: number | null; leaveTypeLabel: string | null }> {
  if (!leaveTypeId) return { balanceAfter: null, takenYtd: null, leaveTypeLabel: null };
  try {
    const { leaveService } = await import('./leave.service.js');
    const balances = await leaveService.getBalance(employeeId, new Date().getFullYear());
    const row = (balances as Array<Record<string, unknown>>).find(
      (b) => String(b.leave_type_id) === String(leaveTypeId),
    );
    if (!row) return { balanceAfter: null, takenYtd: null, leaveTypeLabel: null };
    return {
      balanceAfter: Number(row.available_days ?? 0),
      takenYtd: Number(row.used_days ?? 0),
      leaveTypeLabel: (row.leave_name as string) ?? null,
    };
  } catch {
    return { balanceAfter: null, takenYtd: null, leaveTypeLabel: null };
  }
}

function dateRange(from: string, to: string): string {
  const f = String(from).slice(0, 10);
  const t = String(to).slice(0, 10);
  return f === t ? f : `${f} to ${t}`;
}

/** Manager alert when a request is submitted. To = reporting manager (catalogue 6.2). */
export async function notifyLeaveSubmitted(requestId: string): Promise<void> {
  try {
    const ctx = await loadLeaveContext(requestId);
    if (!ctx) return;
    const bal = await loadBalanceFigures(ctx.employee_id, ctx.leave_type_id);
    await notificationGateway.notify({
      eventCode: 'leave_submitted',
      dedupeKey: `leave_request:${requestId}:submitted`,
      context: { employeeId: ctx.employee_id, branchId: ctx.branch_id, processId: ctx.process_id },
      entityType: 'leave',
      entityId: requestId,
      correlationId: `leave:${requestId}`,
      data: {
        employee_name: ctx.employee_name,
        employee_code: ctx.employee_code,
        leave_type: ctx.leave_name,
        dates: dateRange(ctx.from_date, ctx.to_date),
        days: Number(ctx.total_days ?? 0),
        reason: ctx.reason,
        // analytics: what the approver needs to decide, not decoration
        balance_after: bal.balanceAfter,
        taken_ytd: bal.takenYtd,
      },
    });
  } catch (err) {
    console.error(`[leave-notify] submitted ${requestId}:`, (err as Error).message);
  }
}

/**
 * Decision notification. To = applicant, CC = reporting manager.
 *
 * `status` is passed in rather than re-read, because reviewRequest calls this after the
 * transaction commits and the caller already knows the outcome.
 */
export async function notifyLeaveDecision(
  requestId: string,
  status: 'approved' | 'rejected' | 'cancelled',
  remarks?: string | null,
): Promise<void> {
  try {
    const ctx = await loadLeaveContext(requestId);
    if (!ctx) return;
    const bal = await loadBalanceFigures(ctx.employee_id, ctx.leave_type_id);
    const eventCode = status === 'cancelled' ? 'leave_cancelled' : 'leave_decision';
    await notificationGateway.notify({
      eventCode,
      // Status in the key: an approve-then-cancel is two legitimate notifications, but
      // each must fire exactly once however often the route is retried.
      dedupeKey: `leave_request:${requestId}:${status}`,
      context: { employeeId: ctx.employee_id, branchId: ctx.branch_id, processId: ctx.process_id },
      entityType: 'leave',
      entityId: requestId,
      correlationId: `leave:${requestId}`,
      data: {
        employee_name: ctx.employee_name,
        decision: status,
        leave_type: ctx.leave_name,
        dates: dateRange(ctx.from_date, ctx.to_date),
        days: Number(ctx.total_days ?? 0),
        remarks: remarks ?? null,
        // analytics strip (catalogue 6.2): balance after this leave, by type · taken YTD
        balance_after: bal.balanceAfter,
        taken_ytd: bal.takenYtd,
        balance_type: bal.leaveTypeLabel ?? ctx.leave_name,
      },
    });
  } catch (err) {
    console.error(`[leave-notify] decision ${requestId}:`, (err as Error).message);
  }
}

/**
 * Third-EL escalation. leave.service.ts:117 sets status 'pending_branch_head' when the
 * policy's exception approver kicks in; the branch head needs to know why it reached them.
 */
export async function notifyLeavePendingBranchHead(requestId: string, elOccurrences?: number): Promise<void> {
  try {
    const ctx = await loadLeaveContext(requestId);
    if (!ctx) return;
    await notificationGateway.notify({
      eventCode: 'leave_pending_branch_head',
      dedupeKey: `leave_request:${requestId}:branch_head`,
      context: { employeeId: ctx.employee_id, branchId: ctx.branch_id, processId: ctx.process_id },
      entityType: 'leave',
      entityId: requestId,
      correlationId: `leave:${requestId}`,
      data: {
        employee_name: ctx.employee_name,
        employee_code: ctx.employee_code,
        leave_type: ctx.leave_name,
        dates: dateRange(ctx.from_date, ctx.to_date),
        days: Number(ctx.total_days ?? 0),
        // The rule that routed it here, so the approver is not guessing.
        el_occurrences_ytd: elOccurrences ?? null,
        policy_rule: 'Third earned-leave occurrence this year requires branch head approval',
      },
    });
  } catch (err) {
    console.error(`[leave-notify] branch-head escalation ${requestId}:`, (err as Error).message);
  }
}
