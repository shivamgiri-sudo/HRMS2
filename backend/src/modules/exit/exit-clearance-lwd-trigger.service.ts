/**
 * Exit Clearance Last-Working-Day auto-trigger.
 *
 * Runs daily via employee-lifecycle.worker.ts.
 *
 * Owner ruling 2026-09-15: the 9 exit_clearance_task rows (manager handover, HR exit
 * interview, asset recovery, IT access closure, roster/client-ID deactivation, payroll F&F
 * readiness, LMS closure, compliance/NDA) used to be created the moment a manager accepted
 * the resignation — weeks before anyone (IT, WFM, payroll...) actually needed to act, and
 * long before the employee had actually stopped working. They now key off the confirmed
 * Last Working Day instead, mirroring noc-lwd-trigger.service.ts exactly:
 *
 *   - This daily sweep catches the ordinary case: LWD arrives, tasks get created.
 *   - The OTHER half — an LWD that is already today-or-earlier at the moment it is
 *     confirmed (a backdated entry) — is handled immediately inside
 *     exitService.updateExitStatus() itself, so it does not sit unactioned until this
 *     sweep's next run. See the comment there.
 *
 * createDefaultClearanceTasks() is idempotent (skips if any row already exists for the
 * exit), so this sweep, the immediate in-request check, and a manual
 * POST /:id/clearance/generate can never double-create tasks for the same exit.
 *
 * TERMINAL_STATUSES / LOOKBACK_DAYS mirror noc-lwd-trigger.service.ts's own reasoning:
 * a revoked/rejected/cancelled/withdrawn resignation must never produce a clearance chain,
 * and a short server outage must not silently drop a real exit's tasks.
 */

import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import { createDefaultClearanceTasks } from './exit-intelligence.service.js';

const TERMINAL_STATUSES = [
  'draft', 'exited', 'revoked', 'rejected', 'cancelled', 'withdrawn',
] as const;

/** Days back to scan for unprocessed LWDs (covers short outages) — same window as NOC. */
const LOOKBACK_DAYS = 7;

interface TriggerRow extends RowDataPacket {
  exit_request_id: string;
  employee_id: string;
}

export interface ExitClearanceLwdTriggerResult {
  scanned: number;
  created: number;
  alreadyExisted: number;
  failed: number;
}

export async function runExitClearanceLwdTrigger(): Promise<ExitClearanceLwdTriggerResult> {
  const placeholders = TERMINAL_STATUSES.map(() => '?').join(',');
  const [rows] = await db.execute<TriggerRow[]>(
    `SELECT er.id AS exit_request_id, er.employee_id
       FROM exit_request er
      WHERE er.last_working_day_confirmed IS NOT NULL
        AND er.last_working_day_confirmed >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
        AND er.last_working_day_confirmed <= CURDATE()
        AND er.status NOT IN (${placeholders})
        AND NOT EXISTS (
          SELECT 1 FROM exit_clearance_task t WHERE t.exit_request_id = er.id
        )
      ORDER BY er.last_working_day_confirmed ASC`,
    [LOOKBACK_DAYS, ...TERMINAL_STATUSES],
  );

  const result: ExitClearanceLwdTriggerResult = {
    scanned: rows.length,
    created: 0,
    alreadyExisted: 0,
    failed: 0,
  };

  // Sequential, not Promise.all: 45 workers share one pool on this deployment (see
  // noc-lwd-trigger.service.ts's own comment on this exact point).
  for (const row of rows) {
    try {
      const outcome = await createDefaultClearanceTasks(row.exit_request_id, row.employee_id);
      if (outcome.skipped) {
        result.alreadyExisted++;
      } else {
        result.created++;
      }
    } catch (err) {
      result.failed++;
      console.error(
        `[exit-clearance-lwd-trigger] exit ${row.exit_request_id}:`,
        (err as Error).message,
      );
    }
  }

  return result;
}
