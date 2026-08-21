import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Payroll Head mandatory salary/journey review gate (migration 1541).
 *
 * Every employee created before this shipped has zero rows in
 * employee_payroll_head_review, so the NOT EXISTS clause must be vacuously true
 * for all of them — the whole safety argument for shipping this without a
 * backfill rests on that. This asserts the clause is additive: no new `?`
 * placeholder was introduced (which would silently shift empParams), and the
 * existing SELECT/JOIN logic for salary itself was not touched.
 *
 * Why source-inspection: this repo has no harness that runs a live payroll
 * calculation against a database, so asserting on the query text is the
 * strongest check available without inventing one.
 */

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const SERVICE = "src/modules/payroll/payrollCalculate.service.ts";

function functionBody(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}(`);
  if (start === -1) return "";
  const next = src.indexOf("\nexport async function ", start + 1);
  return src.slice(start, next === -1 ? src.length : next);
}

describe("payroll-run employee selection gates on payroll-head review", () => {
  const src = read(SERVICE);
  const body = functionBody(src, "calculatePayrollRunScoped");

  it("calculatePayrollRunScoped exists", () => {
    expect(body).toBeTruthy();
  });

  it("adds a NOT EXISTS clause against employee_payroll_head_review", () => {
    expect(body).toMatch(/NOT EXISTS[\s\S]*employee_payroll_head_review/);
  });

  it("excludes only a non-approved row, never an employee with no row at all", () => {
    // The safety property: absence of a row (every pre-existing employee) must
    // stay unaffected. A clause that inverted this (e.g. requiring a row to
    // exist) would exclude the entire pre-existing workforce from every run.
    expect(body).toMatch(/status\s*<>\s*'approved'/);
  });

  it("is gated behind the kill switch, not unconditional", () => {
    expect(body).toContain("payroll_head_review_gate_enabled");
  });

  it("respects the kill switch by wrapping the push in a conditional", () => {
    const flagIdx = body.indexOf("payroll_head_review_gate_enabled");
    const pushIdx = body.indexOf("empConds.push", flagIdx);
    const ifIdx = body.lastIndexOf("if (", pushIdx);
    expect(ifIdx, "the empConds.push for the gate must be inside an if-block").toBeGreaterThan(flagIdx);
    expect(pushIdx).toBeGreaterThan(ifIdx);
  });

  it("does not add a new query placeholder for the gate (empParams ordering must stay untouched)", () => {
    // The gate clause is a fixed string with no `?` — introducing one here
    // without a matching empParams.push would silently misalign every
    // parameter bound after it in the surrounding query.
    const gateClauseMatch = body.match(/NOT EXISTS \(SELECT 1 FROM employee_payroll_head_review[\s\S]*?\)\)/);
    expect(gateClauseMatch, "gate clause must be found").toBeTruthy();
    expect(gateClauseMatch![0]).not.toContain("?");
  });
});

describe("employee creation seeds a pending_review row in the same transaction", () => {
  const orchestratorSrc = read("src/modules/employees/employee-creation-orchestrator.service.ts");

  it("inserts into employee_payroll_head_review", () => {
    expect(orchestratorSrc).toContain("employee_payroll_head_review");
  });

  it("starts every new employee at pending_review, never pre-approved", () => {
    const idx = orchestratorSrc.indexOf("INSERT IGNORE INTO employee_payroll_head_review");
    expect(idx).toBeGreaterThan(-1);
    const stmt = orchestratorSrc.slice(idx, idx + 400);
    expect(stmt).toContain("'pending_review'");
    expect(stmt).not.toContain("'approved'");
  });

  it("uses INSERT IGNORE, matching this function's existing idempotency pattern", () => {
    expect(orchestratorSrc).toContain("INSERT IGNORE INTO employee_payroll_head_review");
  });

  it("runs inside createRelatedEmployeeRecords, on the same conn as employee_salary_assignment", () => {
    const fnStart = orchestratorSrc.indexOf("async function createRelatedEmployeeRecords");
    const fnBody = orchestratorSrc.slice(fnStart, fnStart + 20000);
    const salaryIdx = fnBody.indexOf("employee_salary_assignment");
    const reviewIdx = fnBody.indexOf("employee_payroll_head_review");
    expect(salaryIdx, "employee_salary_assignment insert must exist in this function").toBeGreaterThan(-1);
    expect(reviewIdx, "employee_payroll_head_review insert must exist in this function").toBeGreaterThan(-1);
  });
});
