import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * salary_prep_line_component enum discipline.
 *
 * The live column definitions (mas_hrms, verified 2026-08-29) are:
 *   component_type enum('earning','deduction','employer_cost') NOT NULL
 *   source         enum('snapshot','structure','statutory','manual','system') NOT NULL DEFAULT 'system'
 *   run_id         char(36) NOT NULL   (no default)
 *   employee_id    char(36) NOT NULL   (no default)
 *
 * The server runs with STRICT_TRANS_TABLES, so a non-member enum value is a hard
 * error (WARN_DATA_TRUNCATED / 1265), not a silent coercion. Proven against the
 * live server on a temporary table with the same definitions: 'reimbursement',
 * 'incentive_upload', 'reimbursement_claim' and 'custom_deduction' all raise;
 * 'manual' inserts.
 *
 * Because payrollCalculate.service.ts flushes components as ONE multi-row INSERT
 * inside the run transaction, a single bad row aborted the whole month. That is
 * consistent with the live table holding zero rows with source='structure' or
 * 'statutory' — the engine's batch has never landed in production.
 *
 * salary-dispute.service.ts separately omitted run_id and employee_id, so no
 * approved dispute has ever posted its arrear while the approver saw success.
 *
 * Source-inspection: this repo has no harness that runs a live payroll
 * calculation against a database.
 */

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/** Strip // and block comments so prose about a retired value is not a match. */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const COMPONENT_TYPES = ["earning", "deduction", "employer_cost"];
const SOURCES = ["snapshot", "structure", "statutory", "manual", "system"];

const WRITERS = [
  "src/modules/payroll/payrollCalculate.service.ts",
  "src/modules/incentives/incentives.service.ts",
  "src/modules/salary-dispute/salary-dispute.service.ts",
];

/** Values that were live in the tree and each abort a run under strict mode. */
const KNOWN_BAD = ["reimbursement_claim", "incentive_upload", "custom_deduction"];

describe("salary_prep_line_component writers respect the live enums", () => {
  it.each(WRITERS)("%s uses no retired non-member value", (file) => {
    const src = code(read(file));
    for (const bad of KNOWN_BAD) {
      expect(src, `${file} still writes source='${bad}'`).not.toContain(`'${bad}'`);
    }
  });

  it("the engine's batchComponents rows all carry a member component_type and source", () => {
    const src = code(read(WRITERS[0]));
    const pushes = src
      .split("\n")
      .filter((l) => l.includes("batchComponents.push("));
    expect(pushes.length).toBeGreaterThanOrEqual(5);
    for (const line of pushes) {
      const literals = [...line.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
      const type = literals.find((v) => COMPONENT_TYPES.includes(v));
      const source = literals.find((v) => SOURCES.includes(v));
      expect(type, `no member component_type in: ${line.trim()}`).toBeDefined();
      expect(source, `no member source in: ${line.trim()}`).toBeDefined();
    }
  });

  it("the dispute arrear INSERT supplies every NOT NULL column", () => {
    const src = read(WRITERS[2]);
    const idx = src.indexOf("INSERT INTO salary_prep_line_component");
    expect(idx, "dispute arrear INSERT not found").toBeGreaterThan(-1);
    const stmt = src.slice(idx, src.indexOf("`", idx + 40));
    for (const col of ["run_id", "line_id", "employee_id", "component_code", "component_name", "amount", "component_type", "source"]) {
      expect(stmt, `dispute arrear INSERT omits ${col}`).toContain(col);
    }
  });
});
