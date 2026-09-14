/**
 * Cross-employee bank-account duplicate lookup, via the blind index added in migration
 * 1136_employee_bank_detail_account_blind_index.sql.
 *
 * ⚠️ NOT YET WIRED INTO ANY LIVE ROUTE.
 *
 * This module is complete and unit tested, but deliberately not called from
 * employee.routes.ts's PUT /:employeeId/bank-details or
 * payroll-window.routes.ts's PATCH /bank-change-requests/:id yet. Doing so requires, in
 * this order:
 *
 *   1. Migration 1136 applied to the target database (adds the column; currently authored
 *      but NOT in MIGRATION_MANIFEST — see that migration file for why).
 *   2. scripts/bank-account-blind-index-backfill.ts run on the production host and its
 *      verify() step reconciled (see that script for why it must run there, not from a dev
 *      machine).
 *   3. Only then: call recordAccountBlindIndex() from every write path that sets
 *      account_number_enc, and findDuplicateAccountOwner() before accepting a new/changed
 *      bank detail — see the two TODO markers in employee.routes.ts and
 *      payroll-window.routes.ts.
 *
 * Calling findDuplicateAccountOwner() before step 1 throws (unknown column) and breaks
 * every bank-detail write outright. Calling it before step 2 has verified silently only
 * catches collisions among rows written after the backfill, which is worse than the current
 * "no check at all" because it looks like real coverage.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../db/mysql.js";
import { blindIndex } from "./fieldEncryption.js";

export interface DuplicateAccountOwner {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  bankDetailId: string;
}

/**
 * Find another employee (not `excludeEmployeeId`) whose active primary-or-secondary bank
 * detail resolves to the same account number. Returns null when there is no conflict.
 *
 * Scoped to active_status = 1: an archived row from a prior approved change (Fix 3 sets
 * is_primary = 0, active_status = 0 on the old row it replaces) must not itself be treated
 * as a live duplicate — that would make every bank-detail change conflict with the record it
 * is replacing.
 */
export async function findDuplicateAccountOwner(
  accountNumber: string,
  excludeEmployeeId: string,
): Promise<DuplicateAccountOwner | null> {
  const idx = blindIndex(accountNumber);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ebd.id AS bank_detail_id, e.id AS employee_id, e.employee_code,
            CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS employee_name
       FROM employee_bank_detail ebd
       JOIN employees e ON e.id = ebd.employee_id
      WHERE ebd.account_number_blind_index = ?
        AND ebd.active_status = 1
        AND ebd.employee_id <> ?
      LIMIT 1`,
    [idx, excludeEmployeeId],
  );
  const row = rows[0] as any;
  if (!row) return null;
  return {
    employeeId: row.employee_id,
    employeeCode: row.employee_code,
    employeeName: String(row.employee_name ?? "").trim(),
    bankDetailId: row.bank_detail_id,
  };
}

/** The blind index to store alongside account_number_enc on every write. */
export function computeAccountBlindIndex(accountNumber: string): string {
  return blindIndex(accountNumber);
}
