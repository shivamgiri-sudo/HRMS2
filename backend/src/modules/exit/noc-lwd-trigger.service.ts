/**
 * NOC Last-Working-Day auto-trigger.
 *
 * Runs daily at 8:00 AM via employee-lifecycle.worker.ts.
 *
 * When an employee's confirmed last working day arrives (today), the system
 * automatically opens a NOC clearance case and sends the employee their form
 * invite link — removing the dependency on HR manually noticing and acting.
 *
 * SCENARIOS HANDLED
 *
 * Regular resignation:
 *   LWD confirmed, status active → case auto-created, invite sent to employee.
 *
 * Absconding / abandonment:
 *   LWD confirmed (abscondingSince date), status active → case auto-created,
 *   invite sent to registered email if available. HR will use "Record on behalf"
 *   since the employee is unlikely to fill the form themselves.
 *
 * Resignation revoked (or rejected / cancelled / withdrawn):
 *   exit_request.status in TERMINAL_STATUSES → row skipped, no NOC created.
 *   This is the key safety guard: a revoked resignation must not produce a
 *   clearance chain that blocks the employee's next salary.
 *
 * NOC already open:
 *   nocCaseService.openCase() returns the existing case with created=false.
 *   We skip it cleanly — no duplicate, no re-invite.
 *
 * NOC already completed:
 *   openCase() finds the existing completed case and returns created=false.
 *   The daily sweep skips it; if somehow the exit_request is re-activated
 *   after a prior completion a human should handle that, not automation.
 *
 * Lookback window (LOOKBACK_DAYS):
 *   We process LWDs up to 7 days in the past so a server downtime or failed
 *   sweep does not silently drop cases. Beyond 7 days the assumption is that
 *   HR has already acted (or deliberately chose not to), so we stop.
 *
 * INITIATOR IDENTITY
 *
 * We resolve the branch HR user and use their ID as initiatedByUserId. The
 * NOC case log therefore shows "initiated by HR" — accurate because HR owns
 * the exit process and the system acts on their behalf at the agreed trigger
 * point. If no HR user exists for the branch we fall back to the string
 * "system" (stored as-is; the column has no FK constraint to users).
 */

import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import * as nocCaseService from '../payroll/noc-case.service.js';
import { notifyInviteSent } from '../payroll/noc.notifications.js';
import { inboxService } from '../inbox/inbox.service.js';
import { resolveRoleHolderUserIds } from '../../shared/recipient-resolver.js';

const TERMINAL_STATUSES = [
  'draft', 'exited', 'revoked', 'rejected', 'cancelled', 'withdrawn',
] as const;

/** Days back to scan for unprocessed LWDs (covers short outages). */
const LOOKBACK_DAYS = 7;

interface TriggerRow extends RowDataPacket {
  exit_request_id: string;
  employee_id: string;
  employee_name: string | null;
  branch_id: string | null;
  exit_type: string | null;
  last_working_day_confirmed: string;
}

export interface NocLwdTriggerResult {
  scanned: number;
  created: number;
  alreadyExisted: number;
  failed: number;
}

/** Branch HR or branch_hr role holder — used as the system initiator. */
async function resolveBranchHrUserId(branchId: string | null): Promise<string | null> {
  if (!branchId) return null;
  for (const role of ['hr', 'branch_hr']) {
    const ids = await resolveRoleHolderUserIds(role, branchId);
    if (ids.length > 0) return ids[0];
  }
  return null;
}

export async function runNocLwdTrigger(): Promise<NocLwdTriggerResult> {
  const placeholders = TERMINAL_STATUSES.map(() => '?').join(',');
  const [rows] = await db.execute<TriggerRow[]>(
    `SELECT er.id       AS exit_request_id,
            er.employee_id,
            e.full_name AS employee_name,
            e.branch_id,
            er.exit_type,
            er.last_working_day_confirmed
       FROM exit_request er
       JOIN employees e ON e.id = er.employee_id
      WHERE er.last_working_day_confirmed IS NOT NULL
        AND er.last_working_day_confirmed >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
        AND er.last_working_day_confirmed <= CURDATE()
        AND er.status NOT IN (${placeholders})
      ORDER BY er.last_working_day_confirmed ASC`,
    [LOOKBACK_DAYS, ...TERMINAL_STATUSES],
  );

  const result: NocLwdTriggerResult = {
    scanned: rows.length,
    created: 0,
    alreadyExisted: 0,
    failed: 0,
  };

  for (const row of rows) {
    try {
      const hrUserId = await resolveBranchHrUserId(row.branch_id);
      const isAbsconding = ['absconding', 'abandonment'].includes(row.exit_type ?? '');

      const { caseId, created } = await nocCaseService.openCase({
        employeeId: row.employee_id,
        exitRequestId: row.exit_request_id,
        initiatorRole: 'hr',
        initiatedByUserId: hrUserId ?? 'system',
        actorName: hrUserId ? null : 'System (LWD auto-trigger)',
        actorRole: 'hr',
      });

      if (!created) {
        result.alreadyExisted++;
        continue;
      }

      result.created++;

      // Send the form invite. For absconding employees the email may not reach
      // them — HR will use "Record on behalf" from the clearance workspace.
      try {
        const invite = await nocCaseService.mintInvite(caseId, hrUserId);
        await notifyInviteSent(caseId, invite);
      } catch (inviteErr) {
        // Non-fatal: HR can resend from the UI.
        console.warn(
          `[noc-lwd-trigger] invite failed for case ${caseId}:`,
          (inviteErr as Error).message,
        );
      }

      // Work-inbox item for the branch HR so they see it immediately.
      if (hrUserId) {
        await inboxService.createItem({
          user_id: hrUserId,
          type: 'noc_auto_created',
          title: `NOC auto-started — ${row.employee_name ?? row.employee_id}`,
          description: isAbsconding
            ? `Clearance chain opened on LWD. Employee is absconding — use "Record on behalf" to fill their form and unblock the chain.`
            : `Clearance chain opened on LWD. Form invite sent to the employee.`,
          entity_type: 'noc_case',
          entity_id: caseId,
          action_url: `/payroll/noc?case=${caseId}`,
          priority: 'high',
        }).catch(() => undefined);
      }
    } catch (err) {
      result.failed++;
      console.error(
        `[noc-lwd-trigger] employee ${row.employee_id}:`,
        (err as Error).message,
      );
    }
  }

  return result;
}
