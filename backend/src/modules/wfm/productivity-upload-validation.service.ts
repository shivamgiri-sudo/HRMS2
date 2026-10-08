// DB-backed validation helpers for the WFM manual upload pipeline (requirements.md
// Requirement 17). Employee-code resolution (criterion 17.5) and duplicate-submission detection
// (criterion 17.6) -- the two checks that need a database round trip; parseUploadRow() (Task 2)
// and the branch-scope check (Phase 4, via the already-live resolveUserBusinessScope) are the
// other two steps in the validation order design.md specifies.

import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';

interface EmployeeIdRow extends RowDataPacket {
  id: string;
}

/**
 * Resolves an employee code to an employee id. Returns null when the code resolves to no
 * employee (criterion 17.5) -- 56 of 727 distinct apr.UserID values do today; the caller is
 * responsible for rejecting the row and naming the unresolved code, not this function.
 */
export async function resolveEmployeeIdByCode(employeeCode: string): Promise<string | null> {
  const [rows] = await db.execute<EmployeeIdRow[]>(
    `SELECT id FROM employees WHERE employee_code = ? LIMIT 1`,
    [employeeCode],
  );
  return rows.length > 0 ? rows[0].id : null;
}

interface DuplicateRow extends RowDataPacket {
  upload_batch_id: string;
}

/**
 * Checks whether an accepted, non-superseded row already exists for this
 * (Dialler_Source, employee, date) combination (criterion 17.6). Names the prior batch so the
 * caller can report it, rather than just returning a boolean.
 */
export async function isDuplicateContribution(
  diallerSourceId: string,
  employeeId: string,
  reportDate: string,
): Promise<{ isDuplicate: boolean; priorBatchId: string | null }> {
  const [rows] = await db.execute<DuplicateRow[]>(
    `SELECT apc.upload_batch_id
       FROM attendance_productive_contribution apc
      WHERE apc.dialler_source_id = ?
        AND apc.employee_id = ?
        AND apc.work_date = ?
        AND apc.superseded_at IS NULL
        AND apc.upload_batch_id IS NOT NULL
      LIMIT 1`,
    [diallerSourceId, employeeId, reportDate],
  );

  return rows.length > 0
    ? { isDuplicate: true, priorBatchId: rows[0].upload_batch_id }
    : { isDuplicate: false, priorBatchId: null };
}
