/**
 * Creates HRMS employee records for a JCLR intake that was approved in db_bill but never
 * reached mas_hrms, then gives each one a salary assignment.
 *
 * WHY
 *
 * A walk-in batch was approved in db_bill.masjclrentry on 2026-08-06/07 (Approve and
 * Approve1 both 'Yes', Status=1, EmpType=ONROLL, Type_Of_Employee=AGENT, real Interview_Ids)
 * and badged immediately. They have been punching at NOIDA-2 since 2026-08-08. But no
 * employees row was ever created, so COSEC classifies every punch as `unmapped` and discards
 * it: no employee, therefore no attendance, therefore nothing to be paid against. The device
 * is issuing codes past HRMS's own maximum (MAS63284), which is the quickest tell.
 *
 * THE DEFECT THIS SCRIPT EXISTS TO AVOID
 *
 * The 2026-08-11 migration inserted 187 employees and gave 187 of them NO salary assignment.
 * An employee with no active employee_salary_assignment lands in payroll at ZERO, so that run
 * would have paid 187 real people nothing. A raw INSERT INTO employees does not create the
 * salary row. This script therefore does both in one transaction and refuses to commit unless
 * every inserted employee has exactly one active assignment.
 *
 * RULES ENCODED HERE (each one cost someone a broken run)
 *
 *  - db_bill CTC is MONTHLY; employee_salary_assignment.ctc_annual is ANNUAL. Convert x12.
 *    Copying it straight across understates every salary by twelve.
 *  - `full_name` and `auth_user_id` on `employees` are STORED GENERATED. Naming either in an
 *    INSERT fails with ERROR 3105 and aborts the whole statement batch.
 *  - department_master has TWO 'Operations' rows. The live one is
 *    7782964a (uppercase OPERATIONS, 1,017 active employees, and the id the active
 *    apr_eligibility_config rules pin). 775359c8 has 212 and is the duplicate.
 *  - employment_status is written lowercase 'active'. The column holds both casings
 *    ('Active' 273 / 'active' 1,039) and JS `===` comparisons in the sync are case-sensitive.
 *
 * These 13 are left with process_id NULL, exactly as JCLR has them (Process and ClientName are
 * null there too). Under migration 1127 every active APR rule is process-scoped, so a NULL
 * process matches none of them and they are judged on biometric — which is correct, because
 * biometric is precisely what they are punching.
 *
 *   npx tsx scripts/onboard-jclr-leaked-intake.ts            # dry run, writes nothing
 *   npx tsx scripts/onboard-jclr-leaked-intake.ts --apply    # commit
 *
 * Rollback: DELETE FROM employee_salary_assignment WHERE assignment_reason = 'jclr leaked intake 2026-08-12';
 *           DELETE FROM employees WHERE employee_code IN (...the codes below...);
 */
import mysql from "mysql2/promise";
import { db } from "../src/db/mysql.js";

const APPLY = process.argv.includes("--apply");

const CODES = [
  "MAS63287", "MAS63290", "MAS63291", "MAS63294", "MAS63295", "MAS63296", "MAS63297",
  "MAS63298", "MAS63299", "MAS63300", "MAS63301", "MAS63305", "MAS63307",
];

const BRANCH_NOIDA2 = "febd8777";           // resolved by name below; prefix kept for readability
const DEPT_OPERATIONS = "7782964a-5e88-11f1-adb1-00155d0ab410";
const DESIG_EXECUTIVE = "79271db7-5e88-11f1-adb1-00155d0ab410";
const STRUCTURE_ID = "ss-std-001";
const REASON = "jclr leaked intake 2026-08-12";

function splitName(full: string): { first: string; last: string } {
  const parts = String(full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "UNKNOWN", last: "" };
  if (parts.length === 1) return { first: parts[0]!, last: "" };
  return { first: parts[0]!, last: parts.slice(1).join(" ") };
}

(async () => {
  const src = await mysql.createConnection({
    host: process.env.BILL_DB_HOST, port: Number(process.env.BILL_DB_PORT ?? 3306),
    user: process.env.BILL_DB_USER, password: process.env.BILL_DB_PASSWORD,
    database: process.env.BILL_DB_NAME, dateStrings: true,
  });
  const [rows] = await src.execute<any[]>(
    `SELECT EmpCode, EmpName, DOJ, CTC, Mobile, EmailId, PanNo, AdharId, Gendar, DOB, BranchName
       FROM masjclrentry WHERE EmpCode IN (${CODES.map(() => "?").join(",")}) ORDER BY EmpCode`,
    CODES,
  );
  await src.end();
  console.log(`mode: ${APPLY ? "APPLY" : "DRY RUN (rolls back)"}   source rows: ${rows.length}`);
  if (rows.length !== CODES.length) {
    console.error(`expected ${CODES.length} source rows, got ${rows.length} — aborting`);
    await db.end();
    process.exit(1);
  }

  const conn = await db.getConnection();
  try {
    const [branch]: any = await conn.query(
      "SELECT id FROM branch_master WHERE branch_name = 'NOIDA-2' LIMIT 1");
    if (!branch.length) throw new Error("branch NOIDA-2 not found");
    const branchId = branch[0].id;
    if (!String(branchId).startsWith(BRANCH_NOIDA2)) {
      throw new Error(`branch id ${branchId} does not match expected prefix ${BRANCH_NOIDA2}`);
    }

    const [existing]: any = await conn.query(
      `SELECT employee_code FROM employees WHERE employee_code IN (${CODES.map(() => "?").join(",")})`,
      CODES);
    if (existing.length) {
      console.log(`already in HRMS (skipping): ${existing.map((e: any) => e.employee_code).join(", ")}`);
    }
    const todo = rows.filter((r) => !existing.some((e: any) => e.employee_code === r.EmpCode));
    // Return only — the finally block below releases the connection and ends the pool.
    // Doing it here as well threw "Can't add new command when connection is in closed state"
    // after the work had already finished, which reads as a failure when nothing failed.
    if (!todo.length) { console.log("nothing to do"); return; }

    await conn.beginTransaction();

    for (const r of todo) {
      const { first, last } = splitName(r.EmpName);
      // full_name and auth_user_id are STORED GENERATED — never name them here.
      await conn.execute(
        `INSERT INTO employees
           (id, employee_code, first_name, last_name, date_of_joining, branch_id,
            department_id, designation_id, employment_status, mobile, official_email)
         VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
        [r.EmpCode, first, last, r.DOJ, branchId, DEPT_OPERATIONS, DESIG_EXECUTIVE,
         r.Mobile || null, r.EmailId || null],
      );
      const ctcAnnual = Math.round(Number(String(r.CTC).replace(/[^0-9.]/g, "")) * 12);
      if (!Number.isFinite(ctcAnnual) || ctcAnnual <= 0) {
        throw new Error(`${r.EmpCode}: bad CTC ${JSON.stringify(r.CTC)}`);
      }
      await conn.execute(
        `INSERT INTO employee_salary_assignment
           (id, employee_id, structure_id, ctc_annual, effective_from, active_status, assignment_reason)
         SELECT UUID(), e.id, ?, ?, ?, 1, ?
           FROM employees e WHERE e.employee_code = ?`,
        [STRUCTURE_ID, ctcAnnual, r.DOJ, REASON, r.EmpCode],
      );
      console.log(`  ${r.EmpCode}  ${first} ${last}  DOJ ${r.DOJ}  CTC ${r.CTC}/mo -> ${ctcAnnual}/yr`);
    }

    const ph = CODES.map(() => "?").join(",");
    const [emp]: any = await conn.query(
      `SELECT COUNT(*) n FROM employees WHERE employee_code IN (${ph})`, CODES);
    const [asg]: any = await conn.query(
      `SELECT COUNT(*) n FROM employee_salary_assignment a
         JOIN employees e ON e.id = a.employee_id
        WHERE e.employee_code IN (${ph}) AND a.active_status = 1`, CODES);
    const [dup]: any = await conn.query(
      `SELECT COUNT(*) n FROM (
         SELECT a.employee_id FROM employee_salary_assignment a
           JOIN employees e ON e.id = a.employee_id
          WHERE e.employee_code IN (${ph}) AND a.active_status = 1
          GROUP BY a.employee_id HAVING COUNT(*) > 1) d`, CODES);

    const okEmp = Number(emp[0].n) === CODES.length;
    const okAsg = Number(asg[0].n) === CODES.length;
    const okDup = Number(dup[0].n) === 0;
    console.log("\n--- verification (inside transaction) ---");
    console.log(`  employees present      : ${emp[0].n}  ${okEmp ? "OK" : "FAIL"} (expect ${CODES.length})`);
    console.log(`  active salary rows     : ${asg[0].n}  ${okAsg ? "OK" : "FAIL"} (expect ${CODES.length})`);
    console.log(`  anyone with 2 active   : ${dup[0].n}  ${okDup ? "OK" : "FAIL"} (expect 0)`);

    if (okEmp && okAsg && okDup && APPLY) {
      await conn.commit();
      console.log("\n*** COMMITTED ***");
      console.log("Next: enrol them, then reprocess so their attendance materialises:");
      console.log("  npx tsx scripts/enrol-unenrolled-punchers.ts --apply");
    } else {
      await conn.rollback();
      console.log(okEmp && okAsg && okDup
        ? "\nDRY RUN — rolled back. Re-run with --apply to commit."
        : "\n*** ROLLED BACK — a check failed, nothing changed ***");
    }
  } catch (e: any) {
    await conn.rollback();
    console.error("ERROR -> ROLLED BACK:", e?.message ?? e);
    process.exitCode = 1;
  } finally {
    conn.release();
    await db.end();
  }
})();
