/**
 * Calculate one employee's payroll into a throwaway run, print the reconciliation,
 * then delete it. Nothing existing is modified.
 *
 * WHY THIS EXISTS
 * No payroll has ever been calculated from this system — every salary_prep_run row
 * is imported history. That is verifiable: 0 of 66 runs have disbursed_at set, and
 * every line in the June 2026 run has final_payable_days = 0, paid_working_days = 0
 * and attendance_data_source = NULL, three columns the engine always writes. The
 * stored figures therefore say nothing about whether the engine is correct.
 *
 * Reading rows cannot answer that. The engine has to run. This runs it against one
 * employee, in isolation, so the calculation logic can be checked against real
 * attendance before a real payroll depends on it.
 *
 * WHAT IT TOUCHES
 * Creates one salary_prep_run row with a distinct kind and a marked created_by,
 * calculates it scoped to a single employee, prints the result beside the imported
 * figures, and deletes both the run and its lines. The month's real run is never
 * opened. Pass --keep to leave the throwaway run in place for inspection.
 *
 * The employee's own records are read, never written — except salary_advance_log,
 * which calculatePayrollRunScoped updates when it recovers an advance instalment.
 * The preflight below refuses to run if the employee has an active advance, rather
 * than quietly consuming one against a throwaway payroll.
 *
 *   npx tsx scripts/payroll-dry-run.ts MAS47814 2026-06
 *   npx tsx scripts/payroll-dry-run.ts MAS47814 2026-06 --keep
 */
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { calculatePayrollRunScoped } from "../src/modules/payroll/payrollCalculate.service.js";

const [, , employeeCode, runMonth] = process.argv;
const KEEP = process.argv.includes("--keep");

if (!employeeCode || !runMonth || !/^\d{4}-\d{2}$/.test(runMonth)) {
  console.error("usage: npx tsx scripts/payroll-dry-run.ts <EMPLOYEE_CODE> <YYYY-MM> [--keep]");
  process.exit(1);
}

const money = (n: unknown) =>
  Number(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function main() {
  const [[emp]] = await db.execute<RowDataPacket[]>(
    `SELECT id, employee_code,
            COALESCE(NULLIF(full_name,''), CONCAT(first_name,' ',COALESCE(last_name,''))) AS name
       FROM employees WHERE employee_code = ? LIMIT 1`,
    [employeeCode],
  ) as unknown as [Array<{ id: string; employee_code: string; name: string }>];
  if (!emp) throw new Error(`No employee with code ${employeeCode}`);

  // Preflight: calculatePayrollRunScoped writes back to salary_advance_log when it
  // recovers an instalment. A throwaway run must not consume a real recovery.
  const [advRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM salary_advance_log WHERE employee_id = ? AND status = 'active'`,
    [emp.id],
  );
  if (Number((advRows as Array<{ n: number }>)[0].n) > 0) {
    throw new Error(
      `${employeeCode} has an active salary advance. This script would advance its recovery ` +
      `against a throwaway run, so it refuses. Choose another employee, or run it knowing the ` +
      `advance ledger will need correcting.`,
    );
  }

  // The imported figures, for comparison.
  const [[before]] = await db.execute<RowDataPacket[]>(
    `SELECT spl.gross_salary, spl.total_deductions, spl.net_salary, spl.pf_employee,
            spl.esic_employee, spl.professional_tax, spl.tds, spl.final_payable_days,
            spl.present_days, spl.lwp_days
       FROM salary_prep_line spl
       JOIN salary_prep_run spr ON spr.id = spl.run_id
      WHERE spl.employee_id = ? AND spr.run_month = ?
      LIMIT 1`,
    [emp.id, runMonth],
  ) as unknown as [RowDataPacket[]];

  const runId = randomUUID();
  await db.execute(
    `INSERT INTO salary_prep_run (id, run_month, status, run_kind, created_by)
     VALUES (?, ?, 'draft', 'offcycle', ?)`,
    [runId, runMonth, `dry-run:${employeeCode}`],
  );
  console.log(`\nthrowaway run ${runId.slice(0, 8)} created for ${runMonth} (status draft, kind offcycle)`);

  try {
    await calculatePayrollRunScoped(runId, "dry-run", { employeeIds: [emp.id] });

    const [[after]] = await db.execute<RowDataPacket[]>(
      `SELECT gross_salary, total_deductions, net_salary, pf_employee, esic_employee,
              professional_tax, tds, final_payable_days, paid_working_days,
              eligible_weekoff_days, eligible_holiday_days, active_calendar_days,
              present_days, lwp_days, attendance_data_source, status
         FROM salary_prep_line WHERE run_id = ? LIMIT 1`,
      [runId],
    ) as unknown as [RowDataPacket[]];

    console.log(`\n${emp.employee_code} — ${emp.name} — ${runMonth}\n`);
    if (!after) {
      // Worth surfacing loudly: the engine INNER JOINs the salary assignment, so an
      // employee with none produces no line at all rather than an error.
      console.log("ENGINE PRODUCED NO LINE for this employee. Usually a missing or");
      console.log("non-effective salary assignment, which drops them from the run silently.");
    } else {
      const rows = [
        ["gross", before?.gross_salary, after.gross_salary],
        ["total_deductions", before?.total_deductions, after.total_deductions],
        ["net", before?.net_salary, after.net_salary],
        ["pf_employee", before?.pf_employee, after.pf_employee],
        ["esic_employee", before?.esic_employee, after.esic_employee],
        ["professional_tax", before?.professional_tax, after.professional_tax],
        ["tds", before?.tds, after.tds],
        ["final_payable_days", before?.final_payable_days, after.final_payable_days],
      ];
      console.table(
        rows.map(([field, imported, calculated]) => ({
          field,
          imported: imported === undefined ? "(no line)" : money(imported),
          calculated: money(calculated),
          differs:
            imported !== undefined &&
            Math.abs(Number(imported ?? 0) - Number(calculated ?? 0)) > 0.01
              ? "YES"
              : "",
        })),
      );

      console.log("\nhow the engine got its payable days:");
      console.table([{
        paid_working_days: after.paid_working_days,
        eligible_weekoffs: after.eligible_weekoff_days,
        eligible_holidays: after.eligible_holiday_days,
        final_payable_days: after.final_payable_days,
        active_calendar_days: after.active_calendar_days,
        attendance_source: after.attendance_data_source,
      }]);

      // The invariant PR-06 exists to guarantee. If this fails, that fix is wrong.
      const identity =
        Number(after.gross_salary) - Number(after.total_deductions) - Number(after.net_salary);
      console.log(
        `\ngross - deductions - net = ${identity.toFixed(2)} ` +
        (Math.abs(identity) < 0.01 ? "(reconciles)" : "(DOES NOT RECONCILE)"),
      );
    }
  } finally {
    if (KEEP) {
      console.log(`\n--keep set: run ${runId.slice(0, 8)} left in place. Remove it with:`);
      console.log(`  DELETE FROM salary_prep_line WHERE run_id='${runId}';`);
      console.log(`  DELETE FROM salary_prep_run  WHERE id='${runId}';`);
    } else {
      // Ordered child-first; salary_prep_line has an FK to the run.
      await db.execute(`DELETE FROM salary_prep_line_component WHERE run_id = ?`, [runId]);
      await db.execute(`DELETE FROM salary_prep_line WHERE run_id = ?`, [runId]);
      await db.execute(`DELETE FROM salary_prep_run WHERE id = ?`, [runId]);
      console.log(`\nthrowaway run ${runId.slice(0, 8)} deleted.`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\ndry run failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
