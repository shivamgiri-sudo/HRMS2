/**
 * Who a payroll run pays.
 *
 * TWO PLACES DECIDE, AND THEY MUST AGREE. runEmployeeScopeSql() in payroll-governance.service.ts
 * builds the population the readiness gate checks for blockers; a separate query in
 * payrollCalculate.service.ts builds the population that actually gets paid. If those drift, a
 * blocker is cleared against one set of people while a different set is paid, and nothing anywhere
 * reports the discrepancy — the run simply looks clean.
 *
 * SELECTION IS BY ID, NEVER BY NAME. The legacy filters resolve a branch through
 * `WHERE branch_name = ?`, and branch_name is not unique: HYDERABAD, JAIPUR, JAIPUR IDC, KARNAL,
 * MEERUT and MOHALI each name two rows in branch_master, and several process_name values collide
 * too. A scoped run resolved by name would silently pay a second branch's staff. Those filters stay
 * only for the 104 historical company runs, which must keep selecting exactly what they always did.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runEmployeeScopeSql } from "../payroll-governance.service.js";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const calculator = fs.readFileSync(path.resolve(DIR, "../payrollCalculate.service.ts"), "utf8");

/** The clause both modules must carry, character for character. */
const SCOPE_CLAUSE =
  "e.cost_centre_id IN (SELECT cost_centre_id FROM salary_prep_run_scope WHERE run_id = ?)";

const scopedRun = { id: "run-1", run_month: "2026-08", scope_kind: "scoped" };
const companyRun = {
  id: "run-2",
  run_month: "2026-08",
  scope_kind: "company",
  branch_filter: "NOIDA",
  process_filter: null,
};
const legacyRun = { id: "run-3", run_month: "2021-04", branch_filter: "NOIDA" }; // no scope_kind at all

describe("a scoped run selects its own cost centres", () => {
  it("restricts the readiness population to the run's scope rows", () => {
    const { where, params } = runEmployeeScopeSql(scopedRun);
    expect(where).toContain(SCOPE_CLAUSE);
    expect(params).toContain("run-1");
  });

  it("never resolves a scoped run through a branch or process name", () => {
    const { where } = runEmployeeScopeSql(scopedRun);
    expect(where).not.toContain("branch_master WHERE branch_name");
    expect(where).not.toContain("process_master WHERE process_name");
  });

  it("still bounds the run to the month and to active employment", () => {
    // The cost-centre filter narrows the population; it must not replace the employment window,
    // or a leaver from two years ago in that cost centre would be paid.
    const { where } = runEmployeeScopeSql(scopedRun);
    expect(where).toContain("e.active_status = 1");
    expect(where).toContain("employment_status");
  });
});

describe("the calculator pays exactly the population readiness checked", () => {
  it("carries the identical cost-centre clause", () => {
    /*
     * Source-text rather than behavioural, because the defect this guards against is the two
     * modules drifting apart. A behavioural test on either one alone passes happily while the other
     * selects somebody else.
     */
    expect(calculator).toContain(SCOPE_CLAUSE);
  });

  it("branches on scope_kind rather than applying both filter styles at once", () => {
    expect(calculator).toContain('scope_kind ?? "company") === "scoped"');
  });

  it("keeps the name-based filters reachable only for company runs", () => {
    // They must survive for the legacy runs, but sit inside the else arm.
    const idx = calculator.indexOf(SCOPE_CLAUSE);
    const after = calculator.slice(idx, idx + 1200);
    expect(after).toContain("} else {");
    expect(after).toContain("branch_master WHERE branch_name");
  });
});

describe("legacy company runs are untouched", () => {
  it("still filters by branch name", () => {
    const { where, params } = runEmployeeScopeSql(companyRun);
    expect(where).toContain("e.branch_id IN (SELECT id FROM branch_master WHERE branch_name = ?)");
    expect(where).not.toContain("salary_prep_run_scope");
    expect(params).toContain("NOIDA");
  });

  it("treats a run with no scope_kind at all as a company run", () => {
    /*
     * The 104 existing rows predate the column. They read as undefined until the migration's
     * DEFAULT 'company' applies, and even after it a stale cached row could lack the field — so the
     * fallback must be 'company'. Defaulting the other way would hand every historical run an empty
     * scope and pay nobody.
     */
    const { where } = runEmployeeScopeSql(legacyRun);
    expect(where).toContain("branch_master WHERE branch_name");
    expect(where).not.toContain("salary_prep_run_scope");
  });

  it("applies no scope filter at all to a run with neither filter set", () => {
    // All 104 production runs are in this state: company-wide, every filter NULL.
    const { where } = runEmployeeScopeSql({ id: "r", run_month: "2026-08", scope_kind: "company" });
    expect(where).not.toContain("salary_prep_run_scope");
    expect(where).not.toContain("branch_master WHERE branch_name");
  });
});
