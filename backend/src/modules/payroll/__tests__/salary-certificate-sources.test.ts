/**
 * Salary certificates must state figures that come from somewhere authoritative — or not be
 * issued at all.
 *
 * getLatestSalaryAssignment selected basic_salary, gross_salary and net_salary from
 * employee_salary_assignment. None of those three columns exists on that table; it carries
 * ctc_annual, structure_id, effective_from and active_status and nothing else monetary. Every
 * call threw ER_BAD_FIELD_ERROR into the route's .catch(next), so /generate has returned 500 for
 * every salary and CTC certificate since it shipped. The data agrees:
 * salary_certificate_request holds 0 rows — not one certificate has ever been issued — while the
 * page is live, in the nav, and reachable by the 'employee' role.
 *
 * Found by a PREPARE-based sweep of every SQL literal in backend/src against the live schema,
 * which is the only thing that catches a column existing on SOME table but not the one queried.
 *
 * These assertions are about WHERE each number comes from, because that is the property that was
 * wrong. A certificate is a statement of someone's income to a bank or a landlord; the failure
 * mode worth guarding is not a crash but a plausible wrong number.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE = readFileSync(
  resolve(process.cwd(), "src/modules/payroll/payroll-certificates.routes.ts"),
  "utf8",
);
/** Assert on code, not on the prose that necessarily quotes the broken form. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("no column is read that the table does not have", () => {
  it("never selects basic_salary, gross_salary or net_salary from employee_salary_assignment", () => {
    const stmts = CODE.match(/FROM\s+employee_salary_assignment[\s\S]{0,400}?`/gi) ?? [];
    for (const s of stmts) {
      expect(s).not.toMatch(/\bbasic_salary\b/);
      expect(s).not.toMatch(/\bnet_salary\b/);
    }
    // The whole broken SELECT list, as it stood.
    expect(CODE).not.toMatch(/SELECT basic_salary, gross_salary, net_salary/);
  });

  it("reads only columns employee_salary_assignment actually has", () => {
    const block = CODE.slice(CODE.indexOf("FROM employee_salary_assignment") - 300, CODE.indexOf("FROM employee_salary_assignment") + 300);
    expect(block).toMatch(/esa\.ctc_annual/);
    expect(block).toMatch(/esa\.active_status = 1/);
  });
});

describe("each figure comes from a source that can actually produce it", () => {
  it("takes net take-home from a calculated payroll line, not from an assignment", () => {
    // Net is gross less PF, ESI, PT and TDS. None of that is derivable from an assignment row,
    // so deriving it here would mean inventing a number and printing it on a certificate.
    expect(CODE).toMatch(/FROM salary_prep_line spl/);
    expect(CODE).toMatch(/spl\.net_salary/);
  });

  it("excludes draft and cancelled runs, and excluded or blocked lines", () => {
    // Nothing was paid from those, so they cannot evidence take-home pay.
    const block = CODE.slice(CODE.indexOf("FROM salary_prep_line spl"));
    expect(block.slice(0, 700)).toMatch(/NOT IN \('draft', 'cancelled'\)/);
    expect(block.slice(0, 700)).toMatch(/NOT IN \('excluded', 'blocked'\)/);
  });

  it("uses contracted ctc_annual directly instead of rebuilding CTC from one month's payroll", () => {
    // gross*12 + basic*0.12*12 understated CTC by whatever LWP that month happened to carry.
    expect(CODE).not.toMatch(/gross \* 12 \+ pfEmployerAnnual/);
    expect(CODE).not.toMatch(/basic \* 0\.12 \* 12/);
    expect(CODE).toMatch(/annualCtc = sal\?\.annual_ctc/);
  });

  it("names the payroll month on the salary certificate", () => {
    // These are one payroll's figures, not a standing contractual amount; saying so is the
    // difference between a true statement and a misleading one.
    expect(CODE).toMatch(/figures_from_month/);
    expect(CODE).toMatch(/for the payroll month of/);
  });
});

describe("it refuses rather than printing a figure it cannot stand behind", () => {
  it("refuses a salary certificate when there is no calculated payroll line", () => {
    expect(CODE).toMatch(/template === "salary" && \(sal\?\.gross_salary == null \|\| sal\?\.net_salary == null\)/);
    expect(CODE).toMatch(/Cannot issue a salary certificate/);
  });

  it("refuses a CTC certificate when there is no active annual CTC", () => {
    expect(CODE).toMatch(/template === "ctc" && sal\?\.annual_ctc == null/);
    expect(CODE).toMatch(/Cannot issue a CTC certificate/);
  });

  it("refuses with a 409 the caller can act on, not a 500", () => {
    const block = CODE.slice(CODE.indexOf("Cannot issue a salary certificate") - 400, CODE.indexOf("Cannot issue a CTC certificate") + 400);
    expect(block).toMatch(/status\(409\)/);
  });

  it("still issues an employment certificate, which needs no salary figure", () => {
    // 116 of 1,327 active employees have no calculated line; they must still be able to get the
    // certificate that does not depend on one.
    expect(CODE).toMatch(/template !== "employment" \? await getCertificateSalaryFigures/);
  });
});
