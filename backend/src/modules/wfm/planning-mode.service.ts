import { db } from '../../db/mysql.js';

export type PlanningMode = 'ROSTER_LED' | 'VOLUME_BASED';

const error404 = new Error('Process not found');
(error404 as any).statusCode = 404;

/**
 * Get the planning mode for a process.
 * Returns 'ROSTER_LED' if NULL (pre-migration row) or not found returns 404 error.
 */
export async function getPlanningMode(processId: string): Promise<PlanningMode> {
  const [row] = await db.query(
    'SELECT planning_mode FROM process_master WHERE id = ?',
    [processId]
  );

  if (!row || row.length === 0) {
    throw error404;
  }

  const mode = row[0].planning_mode;
  return mode || 'ROSTER_LED';
}

/**
 * Set the planning mode for a process.
 */
export async function setPlanningMode(processId: string, mode: PlanningMode): Promise<void> {
  // First check if the process exists
  const [checkRow] = await db.query(
    'SELECT id FROM process_master WHERE id = ?',
    [processId]
  );

  if (!checkRow || checkRow.length === 0) {
    throw error404;
  }

  // Update the planning mode
  await db.query(
    'UPDATE process_master SET planning_mode = ? WHERE id = ?',
    [mode, processId]
  );
}
