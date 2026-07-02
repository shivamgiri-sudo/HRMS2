import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';

/**
 * Assert that a payroll run is still editable.
 * Throws with a descriptive message if the run is locked, disbursed, or past its window close date.
 */
export async function assertRunEditable(runId: string): Promise<void> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT status, window_close_date FROM salary_prep_run WHERE id = ? LIMIT 1`,
    [runId]
  );
  const run = (rows[0] as any);
  if (!run) throw new Error('Payroll run not found');

  if (['locked', 'disbursed'].includes(run.status)) {
    throw new Error(`Payroll run is ${run.status}. No changes are permitted.`);
  }

  if (run.window_close_date) {
    const closeDate = new Date(run.window_close_date as string);
    closeDate.setHours(23, 59, 59, 999); // end of that day
    if (new Date() > closeDate) {
      const dateStr = (run.window_close_date as string).slice(0, 10);
      throw new Error(
        `Payroll window closed on ${dateStr}. No corrections or recalculations are accepted after the closure date.`
      );
    }
  }
}
