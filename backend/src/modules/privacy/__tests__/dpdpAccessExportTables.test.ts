/**
 * A data-subject access export must actually be producible.
 *
 * Three of this service's four queries named tables that do not exist:
 *
 *   employee_salary_component  -> payroll_employee_component_snapshot
 *   attendance                 -> attendance_daily_record
 *   employee_leave             -> leave_request (+ leave_type_master)
 *
 * None is wrapped in a catch, so a request under the DPDP Act failed outright.
 * That is the one obligation where returning nothing is least acceptable: the
 * person is entitled to the record, and a 500 is indistinguishable from the
 * system having no data about them.
 *
 * Only the consents query worked. Verified against production: the corrected
 * export returns 5 salary components, 112 attendance sessions and 50 leave rows
 * for a real employee.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE = readFileSync(
  resolve(process.cwd(), "src/modules/privacy/dpdpAccessExport.service.ts"),
  "utf8",
);

/** Strip comments — the fix explains the old names in prose. */
const CODE = SOURCE
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((l) => !l.trim().startsWith("//"))
  .join("\n");

const REPLACEMENTS: Array<[string, string]> = [
  ["employee_salary_component", "payroll_employee_component_snapshot"],
  ["employee_leave", "leave_request"],
];

describe("the access export queries tables that exist", () => {
  for (const [missing, real] of REPLACEMENTS) {
    it(`${missing} -> ${real}`, () => {
      // \b(?!_) so employee_leave does not match employee_leave_balance and
      // employee_salary_component does not match a longer real name.
      expect(CODE, `${missing} does not exist in mas_hrms`)
        .not.toMatch(new RegExp(`FROM\\s+${missing}\\b(?!_)`));
      expect(CODE).toContain(real);
    });
  }

  it("reads attendance from attendance_daily_record, not `attendance`", () => {
    expect(CODE).not.toMatch(/FROM\s+attendance\b(?!_)/);
    expect(CODE).toContain("attendance_daily_record");
  });

  it("uses the real attendance columns", () => {
    // The table has attendance_status and record_date; there is no `status`
    // or `date` column, and 'late' is not an attendance_status value —
    // lateness is the separate late_mark flag.
    expect(CODE).toMatch(/attendance_status\s*=\s*'present'/);
    expect(CODE).toMatch(/late_mark\s*=\s*1/);
    expect(CODE).toMatch(/MIN\(record_date\)/);
  });

  it("reads the salary amount from the column that holds it", () => {
    // payroll_employee_component_snapshot stores amount_monthly, not amount.
    expect(CODE).toMatch(/amount_monthly\s+AS\s+amount/);
  });

  it("exports a readable leave type, not an id", () => {
    // leave_request stores leave_type_id; the person receiving their own
    // record should see "Casual Leave", not a UUID.
    expect(CODE).toContain("leave_type_master");
    expect(CODE).toMatch(/leave_name\s+AS\s+leave_type/);
  });
});

describe("the export is still all-or-nothing", () => {
  it("has no catch that would hide a broken query", () => {
    // Stated rather than fixed: these queries are deliberately unwrapped, so a
    // future bad column fails loudly instead of silently returning a partial
    // record to a data subject. If a catch is ever added here, the reasoning
    // in this file needs revisiting.
    const at = CODE.indexOf("payroll_employee_component_snapshot");
    expect(at).toBeGreaterThan(-1);
    expect(CODE.slice(at, at + 300)).not.toMatch(/\.catch\(/);
  });
});
