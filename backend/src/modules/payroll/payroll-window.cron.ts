import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import { logSensitiveAction } from '../../shared/auditLog.js';
import { getIstDateString } from '../../utils/dateUtils.js';
import { leaveService } from '../leave/leave.service.js';
import { CLOSED_RUN_STATUSES_SQL } from './run-status.js';
import { notifyPayrollWindowClosing } from './payroll.notifications.js';

let _timer: ReturnType<typeof setInterval> | null = null;

// How many days ahead of window_close_date to send the "closing soon" warning.
// Default of 3 is not yet confirmed with business stakeholders — revisit before relying
// on it operationally.
const WINDOW_CLOSING_LEAD_DAYS = 3;

/**
 * Daily cron: auto-lock payroll runs whose window_close_date has passed.
 * Runs at startup and every 24 hours thereafter.
 */
export async function runPayrollWindowClosure(): Promise<void> {
  // Find runs past their closure date that haven't been auto-locked yet
  const today = getIstDateString();
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, run_month FROM salary_prep_run
     WHERE window_close_date IS NOT NULL
       AND window_close_date <= ?
       AND status NOT IN (${CLOSED_RUN_STATUSES_SQL},'cancelled')
       AND auto_closed_at IS NULL`,
    [today]
  );

  for (const row of rows as Array<{ id: string; run_month: string }>) {
    await db.execute(
      `UPDATE salary_prep_run
          SET status = 'locked', auto_closed_at = NOW(), closed_by = 'system'
        WHERE id = ?`,
      [row.id]
    );

    await logSensitiveAction({
      actor_user_id: 'system',
      action_type: 'payroll_window_auto_closed',
      module_key: 'payroll',
      entity_type: 'salary_prep_run',
      entity_id: row.id,
      change_summary: { run_month: row.run_month, reason: 'window_close_date reached' },
    }).catch((e: unknown) => console.error('[payroll-window-cron] audit log error:', e));

    // Lapse pending leave requests for all employees in this run
    const [lineRows] = await db.execute<RowDataPacket[]>(
      `SELECT DISTINCT employee_id FROM salary_prep_line WHERE run_id = ?`,
      [row.id],
    );
    const employeeIds = (lineRows as any[]).map((r: any) => String(r.employee_id));
    if (employeeIds.length > 0) {
      await leaveService.lapseUnresolvedLeaves(row.id, row.run_month, employeeIds)
        .catch((e: unknown) => console.error('[payroll-window-cron] lapseUnresolvedLeaves error:', e));
    }

    console.log(`[payroll-window-cron] Auto-locked run ${row.id} (${row.run_month})`);
  }

  if (rows.length === 0) {
    console.log('[payroll-window-cron] No runs to auto-close today.');
  }
}

/**
 * Daily cron: warn payroll_hr/branch_hr that a run's payroll window is closing soon
 * (within WINDOW_CLOSING_LEAD_DAYS), so it doesn't get auto-locked as a surprise.
 * Disjoint by construction from runPayrollWindowClosure's own range (window_close_date
 * <= today there, > today here), so no run can match both in one tick. Firing exactly
 * once per run is handled by the gateway's dedupe claim on (event_code, dedupeKey), not
 * by a new "already warned" column — auto_closed_at here still just means "not yet
 * locked", not "not yet warned".
 */
export async function runPayrollWindowClosingWarning(): Promise<void> {
  const today = getIstDateString();
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, run_month, window_close_date FROM salary_prep_run
     WHERE window_close_date IS NOT NULL
       AND window_close_date > ?
       AND window_close_date <= DATE_ADD(?, INTERVAL ${WINDOW_CLOSING_LEAD_DAYS} DAY)
       AND status NOT IN (${CLOSED_RUN_STATUSES_SQL},'cancelled')
       AND auto_closed_at IS NULL`,
    [today, today]
  );

  for (const row of rows as Array<{ id: string; run_month: string; window_close_date: string }>) {
    await notifyPayrollWindowClosing(row.id, String(row.window_close_date)).catch((e: unknown) =>
      console.error('[payroll-window-cron] closing-warning notify error:', e)
    );
  }
}

export function startPayrollWindowClosureScheduler(): void {
  if (_timer) return;

  // Run once at startup, then every 24 hours
  runPayrollWindowClosure()
    .then(() => runPayrollWindowClosingWarning())
    .catch((e: unknown) =>
      console.error('[payroll-window-cron] startup run failed:', e)
    );

  _timer = setInterval(
    () => runPayrollWindowClosure()
      .then(() => runPayrollWindowClosingWarning())
      .catch((e: unknown) =>
        console.error('[payroll-window-cron] scheduled run failed:', e)
      ),
    24 * 60 * 60 * 1000
  );

  console.log('[payroll-window-cron] scheduler started (daily)');
}

export function stopPayrollWindowClosureScheduler(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
  console.log('[payroll-window-cron] Stopped');
}
