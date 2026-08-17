/**
 * Budget governance controls — contract tests.
 *
 * Covers the maker-checker, period-lock and idempotency controls introduced
 * in the combined Budget + GRN audit (e5ed1a11, 737a0a42) and follow-up fixes.
 *
 * Source-pattern tests: they fail if the control is removed from the code,
 * even if the logic accidentally remains otherwise correct.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, it, expect } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../../../..");

function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

// ─────────────────────────────────────────────────────────────────────────────
// Budget tax amendment — migration and maker-checker
// ─────────────────────────────────────────────────────────────────────────────
describe("Budget tax amendment (737a0a42)", () => {
  it("migration 460 creates finance_budget_line_tax_amendment with COLLATE", () => {
    const sql = read("sql/460_budget_line_tax_amendment.sql");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS finance_budget_line_tax_amendment");
    expect(sql).toContain("status");
    expect(sql).toContain("requested_by");
    expect(sql).toContain("gross_delta");
    expect(sql).toContain("pnl_delta");
    // Must not DROP or DELETE
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql).not.toMatch(/^DELETE\s+FROM/im);
  });

  it("requestTaxAmendment creates a pending record — never applies immediately", () => {
    const svc = read("src/modules/process-pnl/branch-budget.service.ts");
    const fnStart = svc.indexOf("async requestTaxAmendment(");
    expect(fnStart).toBeGreaterThan(-1);
    const fn = svc.slice(fnStart, fnStart + 3000);
    // Must insert with 'pending' status
    expect(fn).toContain("'pending'");
    // Must NOT update the budget line (that only happens in reviewTaxAmendment)
    expect(fn).not.toContain("UPDATE finance_budget_line");
  });

  it("reviewTaxAmendment enforces maker-checker — requestor cannot self-approve", () => {
    const svc = read("src/modules/process-pnl/branch-budget.service.ts");
    const fnStart = svc.indexOf("async reviewTaxAmendment(");
    expect(fnStart).toBeGreaterThan(-1);
    const fn = svc.slice(fnStart, fnStart + 3000);
    // Must reference requested_by for the check
    expect(fn).toContain("requested_by");
    // Must throw an error when the same person tries to approve their own amendment
    expect(fn).toContain("requestor cannot approve");
  });

  it("reviewTaxAmendment re-checks period lock inside the transaction (P0-3)", () => {
    const svc = read("src/modules/process-pnl/branch-budget.service.ts");
    const fnStart = svc.indexOf("async reviewTaxAmendment(");
    // Slice to the next top-level method rather than a fixed character budget. The old
    // `fnStart + 4000` window silently dropped the tail of the function as soon as the body
    // grew -- attaching a status and code to each throw was enough to push pnl_cost_amount out
    // of range, failing the test while the behaviour it guards was untouched.
    const offset = svc.slice(fnStart + 1).search(/\n {2}async /);
    const fn = offset > -1 ? svc.slice(fnStart, fnStart + 1 + offset) : svc.slice(fnStart);
    expect(fn).toContain("isPeriodLocked(");
    const txIdx = fn.indexOf("beginTransaction");
    const lockIdx = fn.indexOf("isPeriodLocked(");
    expect(txIdx).toBeGreaterThan(-1);
    expect(lockIdx).toBeGreaterThan(txIdx);
  });

  it("reviewTaxAmendment recalculates the line via calculateBudgetLine, not direct column patch", () => {
    const svc = read("src/modules/process-pnl/branch-budget.service.ts");
    const fnStart = svc.indexOf("async reviewTaxAmendment(");
    // Slice to the next top-level method rather than a fixed character budget. The old
    // `fnStart + 4000` window silently dropped the tail of the function as soon as the body
    // grew -- attaching a status and code to each throw was enough to push pnl_cost_amount out
    // of range, failing the test while the behaviour it guards was untouched.
    const offset = svc.slice(fnStart + 1).search(/\n {2}async /);
    const fn = offset > -1 ? svc.slice(fnStart, fnStart + 1 + offset) : svc.slice(fnStart);
    expect(fn).toContain("calculateBudgetLine(");
    // All dependent columns must be updated
    for (const col of ["pnl_cost_amount", "cgst_amount", "recoverable_tax_amount"]) {
      expect(fn, `${col} must be rewritten on amendment approval`).toContain(col);
    }
  });

  it("GET/PATCH/review routes are wired in process-pnl.routes.ts", () => {
    const routes = read("src/modules/process-pnl/process-pnl.routes.ts");
    expect(routes).toContain("/pnl/budgets/:budgetId/lines/:lineId/tax-amendment-preflight");
    expect(routes).toContain("/pnl/budgets/:budgetId/lines/:lineId/tax-treatment");
    expect(routes).toContain("/pnl/budget-tax-amendments");
    expect(routes).toContain("/pnl/budget-tax-amendments/:id/review");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Budget transfer — pending workflow and idempotency
// ─────────────────────────────────────────────────────────────────────────────
describe("Budget transfer maker-checker workflow (e5ed1a11)", () => {
  it("submitTransfer inserts with status='pending', never 'approved'", () => {
    const svc = read("src/modules/process-pnl/branch-budget.service.ts");
    const fnStart = svc.indexOf("async submitTransfer(");
    const fnEnd = svc.indexOf("\n  async", fnStart + 10);
    const fn = svc.slice(fnStart, fnEnd);
    expect(fn).toContain("'pending'");
    expect(fn).not.toContain("'approved'");
  });

  it("submitTransfer has 60-second idempotency guard", () => {
    const svc = read("src/modules/process-pnl/branch-budget.service.ts");
    const fn = svc.slice(svc.indexOf("async submitTransfer("));
    expect(fn).toContain("INTERVAL 60 SECOND");
    expect(fn).toContain("duplicate transfer");
  });

  it("reviewTransfer enforces maker-checker before applying", () => {
    const svc = read("src/modules/process-pnl/branch-budget.service.ts");
    const fn = svc.slice(svc.indexOf("async reviewTransfer("));
    expect(fn).toContain("transfer.created_by");
    expect(fn).toContain("Maker-checker violation");
    // Check must come before the period-lock and line mutation
    const mcIdx = fn.indexOf("Maker-checker violation");
    const applyIdx = fn.indexOf("UPDATE finance_budget_line");
    expect(mcIdx).toBeLessThan(applyIdx);
  });

  it("reviewTransfer recalculates all fields via calculateBudgetLine (P1-6)", () => {
    const svc = read("src/modules/process-pnl/branch-budget.service.ts");
    const fn = svc.slice(svc.indexOf("async reviewTransfer("));
    const count = (fn.match(/calculateBudgetLine\(/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(2); // source + target
    expect(fn).toContain("pnl_cost_amount");
    expect(fn).toContain("cgst_amount");
  });

  it("GET /pnl/budgets/:budgetId/transfers list route exists", () => {
    const routes = read("src/modules/process-pnl/process-pnl.routes.ts");
    expect(routes).toContain("/pnl/budgets/:budgetId/transfers");
    expect(routes).toContain("listTransfers(");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Salary verification — readiness wiring
// ─────────────────────────────────────────────────────────────────────────────
describe("Salary verification readiness integration", () => {
  it("BranchReadinessRecord includes salary_verification_done fields", () => {
    const svc = read("src/modules/payroll/payroll-branch-readiness.service.ts");
    expect(svc).toContain("salary_verification_done: number");
    expect(svc).toContain("salary_verification_at: string | null");
    expect(svc).toContain("salary_verification_by: string | null");
  });

  it("markReadinessDoneIfComplete is called after verify-bulk and verify-employee", () => {
    const routes = read("src/modules/payroll/salary-verification.routes.ts");
    expect(routes).toContain("async function markReadinessDoneIfComplete");
    // Must be called in verify-bulk and verify-employee handlers
    const bulkIdx = routes.indexOf("POST /verify-bulk");
    const empIdx  = routes.indexOf("POST /verify-employee");
    const calls = (routes.match(/markReadinessDoneIfComplete\(/g) ?? []).length;
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(bulkIdx).toBeGreaterThan(-1);
    expect(empIdx).toBeGreaterThan(-1);
  });

  it("markReadinessDoneIfComplete is also called when a flag is resolved", () => {
    const routes = read("src/modules/payroll/salary-verification.routes.ts");
    const patchIdx = routes.indexOf("PATCH /flags/:flagId");
    const callAfterPatch = routes.indexOf("markReadinessDoneIfComplete(", patchIdx);
    expect(callAfterPatch).toBeGreaterThan(patchIdx);
  });

  it("UPDATE sets salary_verification_done=1 when total>0, open_flags=0, verified>=total", () => {
    const routes = read("src/modules/payroll/salary-verification.routes.ts");
    const fn = routes.slice(routes.indexOf("async function markReadinessDoneIfComplete"));
    expect(fn).toContain("salary_verification_done = 1");
    expect(fn).toContain("salary_verification_at = NOW()");
    expect(fn).toContain("openFlags === 0");
    expect(fn).toContain("verified >= total");
  });
});
