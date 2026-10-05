/**
 * OWNER-DIRECTED: make the voucher-relevant payroll figures of every employee on a month's run
 * equal db_bill's salary_data, so the salary voucher agrees with db_bill.
 *
 * Sets net_salary, gross_salary (earned Gross1), pf_employee, pf_employer, esic_employee,
 * esic_employer and tds_amount for each employee whose line differs from db_bill by more than
 * Re 1 on any of them. Other columns (components, days, attendance) are NOT touched, so the
 * line's detail will no longer add up to these headline figures for those employees -- same
 * trade-off as the earlier force-match-dbbill-net override. A recalculation of an employee
 * will undo it.
 *
 * Safety: dry-run by default. --apply first copies the current values of every line it changes
 * into salary_prep_line_bill_match_bak (created if missing), then updates inside ONE transaction
 * and writes a sensitive_action_log row. Rollback = restore from that table.
 *
 *   npx tsx scripts/match-month-to-dbbill.ts [YYYY-MM] [--apply]
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { billQuery, closeBillPool } from "../src/db/billDb.js";
import { SYNTHETIC_RUN_CREATORS } from "../src/modules/payroll/payroll.service.js";

const MONTH = process.argv.find((a) => /^\d{4}-\d{2}$/.test(a)) ?? "2026-08";
const APPLY = process.argv.includes("--apply");
const n = (v: unknown) => { const x = parseFloat(String(v ?? "").replace(/,/g, "")); return Number.isNaN(x) ? 0 : x; };
const r2 = (v: number) => Math.round(v * 100) / 100;

const FIELDS = [
  // [line column, db_bill column]
  ["net_salary", "NetSalary"], ["gross_salary", "Gross1"],
  ["pf_employee", "EPF"], ["pf_employer", "EPFCompany"],
  ["esic_employee", "ESIC"], ["esic_employer", "ESICCompany"],
  ["tds_amount", "IncomeTax"],
] as const;

async function main() {
  const [y, m] = MONTH.split("-").map(Number);
  const start = `${MONTH}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;

  const [runs] = await db.execute<RowDataPacket[]>(
    `SELECT id, status FROM salary_prep_run
      WHERE run_month = ? AND (created_by IS NULL OR created_by NOT IN (${SYNTHETIC_RUN_CREATORS.map(() => "?").join(",")}))`,
    [MONTH, ...SYNTHETIC_RUN_CREATORS]);
  if ((runs as any[]).length !== 1) throw new Error(`expected exactly one run for ${MONTH}, found ${(runs as any[]).length}`);
  const runId = String((runs as any[])[0].id);
  console.log(`run ${runId} status ${(runs as any[])[0].status}`);
  if (!["processing", "reviewed", "approved", "draft", "calculated"].includes(String((runs as any[])[0].status).toLowerCase()))
    throw new Error("refusing: run is locked/disbursed/finalised");

  const [lines] = await db.execute<RowDataPacket[]>(
    `SELECT l.id, l.employee_code, l.net_salary, l.gross_salary, l.pf_employee, l.pf_employer,
            l.esic_employee, l.esic_employer, COALESCE(l.tds_amount, l.tds, 0) AS tds_amount
       FROM salary_prep_line l WHERE l.run_id = ?`, [runId]);
  const bill = new Map<string, any>();
  for (const r of await billQuery<any>(
    `SELECT EmpCode, NetSalary, Gross1, EPF, EPFCompany, ESIC, ESICCompany, IncomeTax FROM salary_data
      WHERE SalDate >= ? AND SalDate < ? AND EmpCode IS NOT NULL AND TRIM(EmpCode) <> '' AND EmpCode NOT LIKE 'IDC%'`,
    [start, next])) bill.set(String(r.EmpCode).trim(), r);

  const todo: { id: string; code: string; old: Record<string, number>; neu: Record<string, number> }[] = [];
  for (const l of lines as any[]) {
    const b = bill.get(String(l.employee_code).trim());
    if (!b) continue;
    const old: Record<string, number> = {}, neu: Record<string, number> = {};
    let differs = false;
    for (const [col, bcol] of FIELDS) {
      old[col] = n(l[col]); neu[col] = r2(n(b[bcol]));
      if (Math.abs(old[col] - neu[col]) > 1) differs = true;
    }
    if (differs) todo.push({ id: String(l.id), code: String(l.employee_code), old, neu });
  }
  const sum = (k: "old" | "neu", f: string) => r2(todo.reduce((s, t) => s + t[k][f], 0));
  console.log(`${APPLY ? "APPLY" : "DRY RUN"}: ${todo.length} employees to set to db_bill (of ${(lines as any[]).length} lines, ${bill.size} db_bill rows)`);
  console.table(Object.fromEntries(FIELDS.map(([c]) => [c, { hrms_now: sum("old", c), db_bill: sum("neu", c), delta: r2(sum("neu", c) - sum("old", c)) }])));
  console.table(todo.sort((a, b) => Math.abs(b.neu.net_salary - b.old.net_salary) - Math.abs(a.neu.net_salary - a.old.net_salary)).slice(0, 15)
    .map((t) => ({ code: t.code, net_now: t.old.net_salary, net_bill: t.neu.net_salary })));
  if (!APPLY || !todo.length) { if (!APPLY) console.log("No changes written. Re-run with --apply."); return; }

  const conn = await (db as any).getConnection();
  try {
    await conn.query(`CREATE TABLE IF NOT EXISTS salary_prep_line_bill_match_bak (
      id CHAR(36) NOT NULL, line_id CHAR(36) NOT NULL, run_month CHAR(7) NOT NULL, employee_code VARCHAR(32) NOT NULL,
      net_salary DECIMAL(14,2), gross_salary DECIMAL(14,2), pf_employee DECIMAL(14,2), pf_employer DECIMAL(14,2),
      esic_employee DECIMAL(14,2), esic_employer DECIMAL(14,2), tds_amount DECIMAL(14,2),
      backed_up_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (id), KEY (line_id), KEY (run_month)
    ) ENGINE=InnoDB`);
    await conn.beginTransaction();
    for (const t of todo) {
      await conn.query(
        `INSERT INTO salary_prep_line_bill_match_bak (id, line_id, run_month, employee_code, net_salary, gross_salary, pf_employee, pf_employer, esic_employee, esic_employer, tds_amount)
         VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [t.id, MONTH, t.code, t.old.net_salary, t.old.gross_salary, t.old.pf_employee, t.old.pf_employer, t.old.esic_employee, t.old.esic_employer, t.old.tds_amount]);
      await conn.query(
        `UPDATE salary_prep_line SET net_salary=?, gross_salary=?, pf_employee=?, pf_employer=?, esic_employee=?, esic_employer=?, tds_amount=? WHERE id=?`,
        [t.neu.net_salary, t.neu.gross_salary, t.neu.pf_employee, t.neu.pf_employer, t.neu.esic_employee, t.neu.esic_employer, t.neu.tds_amount, t.id]);
    }
    await conn.query(
      `INSERT INTO sensitive_action_log (id, actor_user_id, action_type, module_key, entity_type, change_summary, acted_at, reason)
       VALUES (UUID(), ?, 'MONTH_MATCHED_TO_DBBILL', 'payroll', 'salary_prep_line', ?, NOW(), ?)`,
      ["a4a4902e-6222-11f1-adb1-00155d0ab410", JSON.stringify({ run: runId, month: MONTH, employees: todo.length }),
       "Owner-directed: payroll figures set to db_bill salary_data so the salary voucher matches; old values in salary_prep_line_bill_match_bak"]);
    await conn.commit();
    console.log(`applied ${todo.length} lines; backup in salary_prep_line_bill_match_bak`);
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}

main().then(async () => { await closeBillPool(); await db.end?.(); }).catch(async (e) => { console.error("ERR", e?.message ?? e); try { await closeBillPool(); await db.end?.(); } catch { } process.exit(1); });
