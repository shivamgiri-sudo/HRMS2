/**
 * Data validation for the Attendance Register (attendance-register-monthly) report.
 * READ-ONLY — this script never writes to the database.
 *
 * What it does:
 *   1. Picks 3-5 active employees (varying by department/branch where possible) who have
 *      at least one attendance_daily_record row in a chosen month.
 *   2. For each sampled employee, independently tallies attendance_daily_record rows for
 *      that month in plain JS, using the SAME status->letter map attendanceRegisterMonthly()
 *      uses internally (present->P, absent->A, half_day->HD, week_off->W, holiday->H,
 *      leave_approved->L, on_duty->OD, unreconciled->A), and computes the expected SalDays
 *      as present + half_day*0.5 + on_duty + holiday + week_off.
 *   3. Calls the real attendanceRegisterMonthly() executor directly (same code path the
 *      /api/reports/suite/attendance-register-monthly endpoint uses) for the same
 *      employee/month, and diffs its day_N codes and summary counts against the
 *      independent tally from step 2.
 *   4. Confirms that at least one sampled employee has a calendar day in the month with no
 *      attendance_daily_record row at all, and that the executor renders that day as an
 *      empty string in day_N rather than a fabricated code.
 *   5. Prints a pass/fail line per check, and a final summary of all mismatches found.
 *
 * This is a diagnostic script, not a test suite — it is meant to be run by a developer
 * against a real (typically staging) mas_hrms database, using the same DB credentials the
 * backend server itself uses (backend/.env, loaded automatically via ../src/config/env.ts
 * when ../src/db/mysql.js is imported below — no separate dotenv setup needed here).
 *
 * Run:
 *   npx tsx backend/scripts/validate-attendance-register-format.ts [YYYY-MM]
 *
 * If no month is given, defaults to the most recently completed calendar month.
 *
 * Exit code: 0 if no mismatches were found, 1 if any mismatch was found or the script
 * errored — so it can be wired into a CI/scheduled check later if desired.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { attendanceRegisterMonthly } from "../src/modules/reporting/executors/attendance.executor.js";
import type { ExecFilters, ExecOptions, ExecScope } from "../src/modules/reporting/executors/types.js";

// ---------------------------------------------------------------------------
// Status mapping — MUST stay identical to the map inside attendanceRegisterMonthly()
// in backend/src/modules/reporting/executors/attendance.executor.ts.
// ---------------------------------------------------------------------------
const STATUS_CODE: Record<string, string> = {
  present: "P",
  absent: "A",
  half_day: "HD",
  week_off: "W",
  holiday: "H",
  leave_approved: "L",
  on_duty: "OD",
  unreconciled: "A",
};

async function q(sql: string, params: unknown[] = []): Promise<RowDataPacket[]> {
  const [rows] = await db.execute<RowDataPacket[]>(sql, params);
  return rows;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

export interface SampleEmployee {
  id: string;
  employee_code: string;
}

/**
 * Picks up to `sampleSize` active employees who have at least one
 * attendance_daily_record row in the given month, ordered so a spread of
 * departments/branches is likely without any special-cased sampling logic.
 */
export async function pickSampleEmployees(
  month: string,
  sampleSize = 5
): Promise<SampleEmployee[]> {
  const [year, mon] = month.split("-").map(Number);
  const firstDay = `${month}-01`;
  const lastDay = `${month}-${String(daysInMonth(year, mon)).padStart(2, "0")}`;

  const rows = await q(
    `SELECT DISTINCT e.id, e.employee_code
       FROM employees e
       JOIN attendance_daily_record adr ON adr.employee_id = e.id
      WHERE e.active_status = 1
        AND adr.record_date BETWEEN ? AND ?
      ORDER BY e.department_id, e.branch_id, e.employee_code
      LIMIT ?`,
    [firstDay, lastDay, sampleSize]
  );

  return (rows as Array<{ id: string; employee_code: string }>).map((r) => ({
    id: String(r.id),
    employee_code: String(r.employee_code),
  }));
}

// ---------------------------------------------------------------------------
// Independent tally
// ---------------------------------------------------------------------------

export interface IndependentTally {
  dayCodes: Record<number, string>;
  counts: Record<string, number>;
  salDays: number;
  hasEmptyDay: boolean;
}

/**
 * Independently tallies attendance_daily_record for one employee/month, using a query
 * that does NOT go through attendanceRegisterMonthly() or any shared pivot logic — this
 * is the "second, independently-written" side of the comparison.
 */
export async function independentTally(
  employeeId: string,
  year: number,
  month: number
): Promise<IndependentTally> {
  const dim = daysInMonth(year, month);
  const monthStr = `${year}-${String(month).padStart(2, "0")}`;
  const firstDay = `${monthStr}-01`;
  const lastDay = `${monthStr}-${String(dim).padStart(2, "0")}`;

  const rows = await q(
    `SELECT record_date, attendance_status
       FROM attendance_daily_record
      WHERE employee_id = ?
        AND record_date BETWEEN ? AND ?
      ORDER BY record_date`,
    [employeeId, firstDay, lastDay]
  );

  const dayCodes: Record<number, string> = {};
  const counts: Record<string, number> = {};

  for (const row of rows as Array<{ record_date: string; attendance_status: string }>) {
    const dayNum = Number(String(row.record_date).slice(-2));
    const code = STATUS_CODE[row.attendance_status] ?? row.attendance_status ?? "";
    dayCodes[dayNum] = code;
    counts[code] = (counts[code] ?? 0) + 1;
  }

  const salDays =
    (counts.P ?? 0) + (counts.HD ?? 0) * 0.5 + (counts.OD ?? 0) + (counts.H ?? 0) + (counts.W ?? 0);

  const hasEmptyDay = Object.keys(dayCodes).length < dim;

  return { dayCodes, counts, salDays, hasEmptyDay };
}

// ---------------------------------------------------------------------------
// Scope — read-only diagnostic script run by a developer who already has DB
// credentials, so it constructs an unrestricted super-admin scope directly
// rather than going through HTTP/auth. Mirrors the scope() fixture used in
// backend/src/modules/reporting/__tests__/leave-balance-report.test.ts.
// ---------------------------------------------------------------------------
function fullScope(): ExecScope {
  return {
    companyId: "1", // single-tenant deployment; see reporting.scope.ts resolveFullScope()
    isSuperAdmin: true,
    branchScope: { mode: "all", ids: [] },
    processScope: { mode: "all", ids: [] },
    departmentScope: { mode: "all", ids: [] },
    costCentreScope: { mode: "all", ids: [] },
    canViewAllEmployees: true,
    canViewSensitiveFields: true,
    canExportSensitiveReports: true,
    roles: ["super_admin"],
  };
}

// ---------------------------------------------------------------------------
// Mismatch collection
// ---------------------------------------------------------------------------

interface Mismatch {
  employeeCode: string;
  month: string;
  field: string;
  expected: unknown;
  actual: unknown;
}

const SUMMARY_FIELDS: Array<{ field: string; tallyKey: keyof IndependentTally["counts"] | "salDays" }> = [
  { field: "absent_count", tallyKey: "A" },
  { field: "present_count", tallyKey: "P" },
  { field: "od_count", tallyKey: "OD" },
  { field: "hd_count", tallyKey: "HD" },
  { field: "leave_count", tallyKey: "L" },
  { field: "holiday_count", tallyKey: "H" },
  { field: "weekoff_count", tallyKey: "W" },
];

async function main() {
  const monthArg = process.argv[2];
  const month = monthArg && /^\d{4}-\d{2}$/.test(monthArg) ? monthArg : defaultMonth();
  const [year, mon] = month.split("-").map(Number);
  const dim = daysInMonth(year, mon);

  console.log(`=== Attendance Register Format Validation ===`);
  console.log(`Month: ${month} (${dim} days)`);
  console.log(`Read-only. No database writes will be performed.\n`);

  const employees = await pickSampleEmployees(month, 5);
  if (employees.length === 0) {
    console.log(`No active employees with attendance rows found for ${month}. Nothing to validate.`);
    process.exit(0);
  }
  console.log(`Sampled ${employees.length} employee(s): ${employees.map((e) => e.employee_code).join(", ")}\n`);

  const scope = fullScope();
  const options: ExecOptions = { limit: 10, offset: 0, cursor: null, includeTotal: false, mode: "preview" };

  const mismatches: Mismatch[] = [];
  let anyEmptyDayConfirmed = false;
  let anyEmptyDayRenderedFabricated = false;

  for (const emp of employees) {
    console.log(`--- Employee ${emp.employee_code} (id=${emp.id}) ---`);

    const tally = await independentTally(emp.id, year, mon);

    const filters: ExecFilters = { month, employeeCode: emp.employee_code };
    const result = await attendanceRegisterMonthly(filters, scope, options);
    const row = (result.rows as Array<Record<string, unknown>>).find(
      (r) => String(r.emp_code) === emp.employee_code
    );

    if (!row) {
      console.log(`  FAIL  executor returned no row for this employee/month.`);
      mismatches.push({
        employeeCode: emp.employee_code,
        month,
        field: "row_presence",
        expected: "row present",
        actual: "no row returned",
      });
      continue;
    }

    // --- day_N code diff -----------------------------------------------------
    let dayMismatchCount = 0;
    for (let d = 1; d <= dim; d++) {
      const expected = tally.dayCodes[d] ?? "";
      const actual = (row[`day_${d}`] as string | undefined) ?? "";
      if (expected !== actual) {
        dayMismatchCount++;
        mismatches.push({
          employeeCode: emp.employee_code,
          month,
          field: `day_${d}`,
          expected,
          actual,
        });
      }
      // Empty-day check (Requirement 2.3): a day with no attendance_daily_record row must
      // render as "" in day_N, never a fabricated code.
      if (!(d in tally.dayCodes)) {
        anyEmptyDayConfirmed = true;
        if (actual !== "") {
          anyEmptyDayRenderedFabricated = true;
          mismatches.push({
            employeeCode: emp.employee_code,
            month,
            field: `day_${d}_empty_render`,
            expected: "",
            actual,
          });
        }
      }
    }
    if (dayMismatchCount === 0) {
      console.log(`  PASS  day_1..day_${dim} codes match independent tally`);
    } else {
      console.log(`  FAIL  ${dayMismatchCount} day_N code mismatch(es) (see summary below)`);
    }

    // --- summary count diff ---------------------------------------------------
    for (const { field, tallyKey } of SUMMARY_FIELDS) {
      const expected = tally.counts[tallyKey as string] ?? 0;
      const actual = Number(row[field] ?? 0);
      if (expected !== actual) {
        mismatches.push({ employeeCode: emp.employee_code, month, field, expected, actual });
        console.log(`  FAIL  ${field}: expected ${expected}, got ${actual}`);
      } else {
        console.log(`  PASS  ${field}: ${actual}`);
      }
    }

    // --- sal_days diff ---------------------------------------------------------
    const actualSalDays = Number(row.sal_days ?? 0);
    if (tally.salDays !== actualSalDays) {
      mismatches.push({
        employeeCode: emp.employee_code,
        month,
        field: "sal_days",
        expected: tally.salDays,
        actual: actualSalDays,
      });
      console.log(`  FAIL  sal_days: expected ${tally.salDays}, got ${actualSalDays}`);
    } else {
      console.log(`  PASS  sal_days: ${actualSalDays}`);
    }

    if (tally.hasEmptyDay) {
      console.log(`  INFO  this employee has at least one day with no attendance_daily_record row`);
    }

    console.log("");
  }

  // --- Empty-day-renders-as-empty check (Requirement 2.3), across the whole sample ---
  if (!anyEmptyDayConfirmed) {
    console.log(
      `WARNING: none of the ${employees.length} sampled employee(s) had a day with no ` +
        `attendance_daily_record row this month — the empty-day-renders-as-empty check ` +
        `(Requirement 2.3) could not be exercised. Re-run against a different month or a ` +
        `larger sample if this check must be confirmed.`
    );
  } else if (anyEmptyDayRenderedFabricated) {
    console.log(`FAIL  at least one empty day rendered a fabricated code instead of "" — see mismatches above.`);
  } else {
    console.log(`PASS  every day with no attendance_daily_record row rendered as "" in day_N.`);
  }

  // --- Final summary -----------------------------------------------------------
  console.log(`\n=== Summary ===`);
  console.log(`Employees checked: ${employees.length}`);
  console.log(`Mismatches found: ${mismatches.length}`);

  if (mismatches.length > 0) {
    console.log(`\nMismatch detail:`);
    for (const m of mismatches) {
      console.log(
        `  employee=${m.employeeCode} month=${m.month} field=${m.field} expected=${JSON.stringify(
          m.expected
        )} actual=${JSON.stringify(m.actual)}`
      );
    }
  }

  process.exit(mismatches.length > 0 ? 1 : 0);
}

/** Most recently completed calendar month, as "YYYY-MM". */
function defaultMonth(): string {
  const now = new Date();
  const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastDayOfPrevMonth = new Date(firstOfThisMonth.getTime() - 24 * 60 * 60 * 1000);
  const y = lastDayOfPrevMonth.getFullYear();
  const m = lastDayOfPrevMonth.getMonth() + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
