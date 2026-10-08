/**
 * Deactivate MAS63386's mis-entered employee_salary_assignment row.
 *
 * Row b192ce90-... carries ctc_annual 15,006 — db_bill's MONTHLY CTC (CurrentCTC 15006) entered as
 * annual. The employee's other active row holds the correct annual 180,072 (= 15,006 x 12).
 * Both are active, so any reader that takes one row without ordering can underpay by 12x.
 *
 * Guards (refuses unless ALL hold): row is active, ctc_annual = 15006, and the same employee has
 * another active row with ctc_annual = 15006 x 12. Soft change only: active_status 1 -> 0, plus a
 * logSensitiveAction row. Dry-run by default; --apply writes, in one transaction.
 *
 *   npx tsx scripts/salary-assignment-deactivate-mas63386.ts [--apply]
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { logSensitiveAction } from "../src/shared/auditLog.js";
import type { RowDataPacket } from "mysql2";

const APPLY = process.argv.includes("--apply");
const ROW_ID = "b192ce90-9e42-11f1-8f5c-00155d0ab410";
const CODE = "MAS63386";

async function main() {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT esa.id, esa.employee_id, esa.ctc_annual, esa.structure_id, esa.active_status, esa.effective_from
       FROM employee_salary_assignment esa JOIN employees e ON e.id = esa.employee_id
      WHERE e.employee_code = ?`, [CODE]);
  console.table(rows);
  const bad = (rows as any[]).find((r) => r.id === ROW_ID);
  const good = (rows as any[]).find((r) => r.id !== ROW_ID && Number(r.active_status) === 1
    && Number(r.ctc_annual) === 15006 * 12);
  if (!bad || Number(bad.active_status) !== 1 || Number(bad.ctc_annual) !== 15006 || !good) {
    console.log("Guards not satisfied (row missing / not active / CTC differs / no correct active row). Nothing to do.");
    return;
  }
  console.log(`Will deactivate ${ROW_ID} (ctc_annual 15006); correct active row ${good.id} (ctc_annual ${good.ctc_annual}) stays.`);
  if (!APPLY) { console.log("\nDry run only — pass --apply to deactivate."); return; }

  const conn = await (db as any).getConnection();
  try {
    await conn.beginTransaction();
    await logSensitiveAction({
      actor_user_id: "ops_salary_assignment_fix",
      actor_role: "system:ops",
      action_type: "salary_assignment_deactivate_bad_ctc",
      module_key: "payroll_salary",
      entity_type: "employee_salary_assignment",
      entity_id: ROW_ID,
      old_value_json: { active_status: 1, ctc_annual: 15006 },
      new_value_json: { active_status: 0, kept_row: good.id },
      reason: "Monthly CTC (db_bill CurrentCTC 15006) was entered as annual; correct annual row 180072 kept",
    });
    const [res] = await conn.execute(
      `UPDATE employee_salary_assignment SET active_status = 0 WHERE id = ? AND active_status = 1 AND ctc_annual = 15006`, [ROW_ID]);
    if ((res as any).affectedRows !== 1) throw new Error(`expected 1 row, got ${(res as any).affectedRows}`);
    await conn.commit();
    console.log("Deactivated 1 row.");
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}

main().then(() => process.exit()).catch((e) => { console.error(e); process.exit(1); });
