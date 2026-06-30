import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import { logSensitiveAction } from '../../shared/auditLog.js';
import { runLeaveWeekoffReconciliation } from './leave-weekoff-reconciliation.service.js';

let _timer: ReturnType<typeof setInterval> | null = null;

/**
 * Daily cron: auto-lock payroll runs whose window_close_date has passed.
 * Runs at startup and every 24 hours thereafter.
 */
export async function runPayrollWindowClosure(): Promise<void> {
  // Find runs past their closure date that haven't been auto-locked yet
  const today = new Date().toISOString().slice(0, 10);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, run_month FROM salary_prep_run
     WHERE window_close_date IS NOT NULL
       AND window_close_date <= ?
       AND status NOT IN ('locked','disbursed','cancelled')
       AND auto_closed_at IS NULL`,
    [today]
  );

  for (const row of rows as Array<{ id: string; run_month: string }>) {
    // Run leave/week-off reconciliation before locking (idempotent safety net)
    try {
      const recon = await runLeaveWeekoffReconciliation(row.run_month);
      if (recon.restored > 0) {
        console.log(
          `[payroll-window-cron] Leave/week-off reconciliation: restored ${recon.restored} days` +
          ` across ${recon.employees} employees for ${row.run_month}`,
        );
      }
    } catch (err) {
      console.error(`[payroll-window-cron] Reconciliation failed for ${row.run_month}:`, err);
    }

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

    console.log(`[payroll-window-cron] Auto-locked run ${row.id} (${row.run_month})`);
  }

  if (rows.length === 0) {
    console.log('[payroll-window-cron] No runs to auto-close today.');
  }
}

export function startPayrollWindowClosureScheduler(): void {
  if (_timer) return;

  // Run once at startup, then every 24 hours
  runPayrollWindowClosure().catch((e: unknown) =>
    console.error('[payroll-window-cron] startup run failed:', e)
  );

  _timer = setInterval(
    () => runPayrollWindowClosure().catch((e: unknown) =>
      console.error('[payroll-window-cron] scheduled run failed:', e)
    ),
    24 * 60 * 60 * 1000
  );

  console.log('[payroll-window-cron] scheduler started (daily)');
}
