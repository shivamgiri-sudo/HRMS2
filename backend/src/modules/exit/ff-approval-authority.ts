/**
 * Who may approve an F&F. Default ON: the Payroll Head holds final approval, finance/payroll prepare
 * and (a different person) record payment. Off only on an explicit 'false' so a config hiccup keeps
 * the stricter rule rather than silently widening who can approve money.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

export const FF_APPROVAL_FLAG_KEY = "ff_approval_payroll_head_only";

export async function isFfApprovalPayrollHeadOnly(): Promise<boolean> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT config_value FROM payroll_config_flags
        WHERE branch_id IS NULL AND process_id IS NULL AND config_key = ?
        ORDER BY updated_at DESC, id DESC LIMIT 1`,
      [FF_APPROVAL_FLAG_KEY],
    );
    if (!rows.length) return true;
    return String(rows[0].config_value).trim().toLowerCase() !== "false";
  } catch {
    return true;
  }
}
