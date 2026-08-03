/**
 * Payroll, attendance, WFM and roster must query tables that exist.
 *
 * A sweep of every table name referenced across these modules against the live
 * production schema (875 tables) found eight that do not exist. Each had been
 * failing since it was written; the only difference between them was whether
 * the failure was loud or silent.
 *
 * Silent — wrapped in .catch(), so a broken query became an empty/zero result
 * that is indistinguishable from genuine good news:
 *   shift_master                      the shift breakdown tile, always empty
 *   attendance_regularization_request  the regularization tile, always blank
 *   salary_grade_master                grade-based salary path, never matched
 *   company_events                     roster generation, no holiday ever honoured
 *
 * Loud — unwrapped, so the endpoint 500s:
 *   payroll_employee / payroll_run     /payslip/list, for every role
 *   user_process_scope                 WFM roster reads, for non-privileged users only
 *   employee_bank_details              the bank advice file
 *
 * Every replacement below was confirmed against the live schema and its data,
 * not inferred from a migration file.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/** Strip comments — several of these files explain the old name in prose. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("--"))
    .join("\n");
}

/** table that does not exist -> the real one, with live row counts. */
const REPLACEMENTS: Array<{
  file: string; missing: string; real: string; note: string;
}> = [
  {
    file: "src/modules/wfm/wfm.routes.ts",
    missing: "user_process_scope",
    real: "user_assignment_scope",
    note: "99 rows; scope clause for non-privileged users, so managers 500'd",
  },
  {
    file: "src/modules/payroll/salary-governance.guard.ts",
    missing: "salary_grade_master",
    real: "grade_band_master",
    note: "6 active rows",
  },
  {
    file: "src/modules/payroll/payroll.routes.ts",
    missing: "payroll_employee",
    real: "salary_prep_line",
    note: "80,338 rows",
  },
  {
    file: "src/modules/payroll/payroll.routes.ts",
    missing: "payroll_run",
    real: "salary_prep_run",
    note: "66 rows",
  },
  {
    file: "src/modules/payroll-compliance/payrollCompliance.routes.ts",
    missing: "employee_bank_details",
    real: "employee_bank_detail",
    note: "13,315 rows; plural does not exist",
  },
  {
    file: "src/modules/payroll-compliance/payrollCompliance.service.ts",
    missing: "employee_bank_details",
    real: "employee_bank_detail",
    note: "13,315 rows; plural does not exist",
  },
  {
    file: "src/modules/wfm/biometric-summary.routes.ts",
    missing: "attendance_regularization_request",
    real: "attendance_regularization",
    note: "31 rows",
  },
  {
    file: "src/modules/wfm/biometric-summary.routes.ts",
    missing: "shift_master",
    real: "wfm_shift_master",
    note: "shift comes from the roster, not the attendance row",
  },
  {
    file: "src/modules/roster/roster-generation.service.ts",
    missing: "company_events",
    real: "leave_holiday_master",
    note: "holds Independence Day 2026-08-15",
  },
];

describe("no query targets a table that does not exist", () => {
  for (const { file, missing, real, note } of REPLACEMENTS) {
    it(`${file.split("/").pop()}: ${missing} -> ${real} (${note})`, () => {
      const source = code(read(file));
      // \b(?!_) so employee_bank_detail does not match employee_bank_details,
      // and shift_master does not match wfm_shift_master.
      const stale = new RegExp(`(?<![a-z_])${missing}\\b`);
      expect(source, `${missing} does not exist in mas_hrms`).not.toMatch(stale);
      expect(source, `expected ${real} to be used instead`).toContain(real);
    });
  }
});

describe("the manager scope clause", () => {
  const SOURCE = code(read("src/modules/wfm/wfm.routes.ts"));

  it("requires the scope mapping to be active", () => {
    // Without this a deactivated mapping would still grant a manager sight of
    // a process. user_assignment_scope carries active_status; 34 of 35 branch
    // scopes are active, so the column is genuinely used.
    //
    // Checked on every process-scope clause, not just the first: this file has
    // five of them, plus an unrelated earlier query on the same table that had
    // always used the correct name — which is how the wrong name survived so
    // long in the other five.
    const clauses = [...SOURCE.matchAll(/SELECT 1 FROM user_assignment_scope[\s\S]{0,200}/g)];
    expect(clauses.length, "expected the process-scope subqueries").toBeGreaterThanOrEqual(5);
    for (const [clause] of clauses) {
      expect(clause).toMatch(/active_status\s*=\s*1/);
    }
  });
});

describe("the bank advice file", () => {
  const SOURCE = read("src/modules/payroll-compliance/payrollCompliance.routes.ts");

  it("casts the account number out of varbinary", () => {
    // account_number is varbinary(500). Selected raw it reaches JSON as
    // {"type":"Buffer","data":[...]} — unusable even when the value is good.
    expect(SOURCE).toMatch(/CAST\(ebd\.account_number AS CHAR\)\s+AS account_number/);
  });

  it("classifies unusable account numbers instead of exporting them silently", () => {
    // 6,070 of 12,768 active accounts are Excel scientific notation
    // ("3.03801E+13"). Those digits are gone, not hidden, so the value cannot
    // be repaired — only flagged.
    expect(SOURCE).toContain("account_number_status");
    expect(SOURCE).toMatch(/corrupt_scientific_notation/);
    expect(SOURCE).toMatch(/REGEXP '\[Ee\]\[\+-\]'/);
  });

  it("reports the unpayable rows to the caller", () => {
    // Whoever generates the file should learn this here, not at the bank.
    expect(SOURCE).toContain("unpayableCount");
  });

  it("pins one bank row per employee", () => {
    // Every active row is primary today (12,768 of 12,768), but a second
    // account added later would otherwise duplicate a payment line.
    expect(SOURCE).toMatch(/ebd\.is_primary\s*=\s*1/);
  });
});

describe("roster generation and holidays", () => {
  // Comments stripped: the explanation above the query names both the old and
  // new table, so raw text would match in the wrong place.
  const SOURCE = code(read("src/modules/roster/roster-generation.service.ts"));

  it("no longer swallows a holiday-calendar failure in silence", () => {
    // The old catch was empty, with a comment saying to treat it as no
    // holidays — which is how every roster came to schedule staff straight
    // through every public holiday.
    const at = SOURCE.indexOf("leave_holiday_master");
    expect(at, "the holiday query has moved").toBeGreaterThan(-1);
    const after = SOURCE.slice(at, at + 700);
    expect(after).toMatch(/catch\s*\(/);
    expect(after, "a swallowed failure here rosters people on holidays")
      .toMatch(/console\.(error|warn)/);
  });

  it("only counts active holidays", () => {
    const at = SOURCE.indexOf("leave_holiday_master");
    expect(SOURCE.slice(at, at + 200)).toMatch(/active_status\s*=\s*1/);
  });
});
