/**
 * Give employees who already hold a salary line in a run, and an active salary_component_assignments
 * package, the employee_salary_assignment row the payroll engine needs to SELECT them.
 *
 *   npx tsx scripts/create-missing-esa-for-run-lines.ts [YYYY-MM]          # dry run (default), writes nothing
 *   npx tsx scripts/create-missing-esa-for-run-lines.ts [YYYY-MM] --apply  # write
 *
 * WHY: payrollCalculate selects employees with an INNER JOIN on employee_salary_assignment (esa). An
 * employee with a package (sca) but no esa row is invisible to every recalculation and next month's run,
 * even though a line for them exists (written outside the engine). Aug 2026: MAS63403-MAS63409.
 *
 * WHAT: for each active employee with a line in the month's run, exactly one active sca row with gross > 0,
 * and NO esa row at all: insert esa (structure_id NULL, ctc_annual = gross * 12, effective_from = the earlier
 * of date_of_joining and the sca effective date, active_status 1). The sca package stays the source of the
 * pay components (the engine prefers it). Existing lines are NOT recalculated or modified.
 * Re-running is a no-op. Never touches an employee that already has any esa row.
 */
import "dotenv/config";
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db, closePool } from "../src/db/mysql.js";

const APPLY = process.argv.includes("--apply");
const MONTH = process.argv.find((a) => /^\d{4}-\d{2}$/.test(a)) ?? "2026-08";
const d10 = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? "").slice(0, 10));

async function main() {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id AS employee_id, e.employee_code, e.date_of_joining,
            sca.gross, sca.effective_date AS sca_effective,
            (SELECT COUNT(*) FROM salary_component_assignments x WHERE x.employee_id = e.id AND x.status = 'active') AS active_sca
       FROM employees e
       JOIN salary_prep_line spl ON spl.employee_id = e.id
       JOIN salary_prep_run r ON r.id = spl.run_id AND r.run_month = ?
       JOIN salary_component_assignments sca ON sca.employee_id = e.id AND sca.status = 'active'
      WHERE e.active_status = 1
        AND sca.gross > 0
        AND NOT EXISTS (SELECT 1 FROM employee_salary_assignment a WHERE a.employee_id = e.id)`,
    [MONTH],
  );
  const one = (rows as any[]).filter((r) => Number(r.active_sca) === 1);
  const many = (rows as any[]).filter((r) => Number(r.active_sca) !== 1);
  const plan = one.map((r) => {
    const doj = r.date_of_joining ? d10(r.date_of_joining) : null;
    const sc = d10(r.sca_effective);
    return { employee_id: r.employee_id, code: r.employee_code, gross: Number(r.gross), ctc_annual: Number(r.gross) * 12, effective_from: doj && doj < sc ? doj : sc };
  });
  console.log(`${APPLY ? "APPLY" : "DRY RUN"} ${MONTH}: ${plan.length} esa rows to create; ${many.length} skipped (not exactly one active package)`);
  console.table(plan.map(({ employee_id, ...p }) => p));
  if (many.length) console.log("skipped:", many.map((r) => r.employee_code).join(", "));
  if (!APPLY) { console.log("Dry run complete. Re-run with --apply to write."); return; }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    for (const p of plan) {
      const [ex] = await conn.execute<RowDataPacket[]>(`SELECT 1 FROM employee_salary_assignment WHERE employee_id = ? LIMIT 1`, [p.employee_id]);
      if ((ex as any[]).length) continue;
      await conn.execute(
        `INSERT INTO employee_salary_assignment (id, employee_id, structure_id, ctc_annual, effective_from, active_status)
         VALUES (?, ?, NULL, ?, ?, 1)`,
        [randomUUID(), p.employee_id, p.ctc_annual, p.effective_from],
      );
    }
    await conn.commit();
    console.log(`COMMITTED ${plan.length} esa rows`);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

main().then(() => closePool()).catch(async (e) => { console.error("ERR", e?.message ?? e); try { await closePool(); } catch { } process.exit(1); });
