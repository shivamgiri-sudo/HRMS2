import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { isStalePlannedMarker } from "../../process-pnl/budget-coverage.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../../../..");

function read(relativePath: string) {
  return fs.readFileSync(path.join(backendRoot, relativePath), "utf8");
}

describe("mandatory branch-budget Head/Sub-head coverage", () => {
  it("registers an additive monthly coverage ledger", () => {
    const sql = read("sql/417_budget_subhead_coverage_control.sql");
    const runner = read("src/db/runPendingMigrations.ts");
    const manual = read("sql/000_finance_supplemental.sql");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS finance_budget_subhead_status");
    expect(sql).toContain("planned");
    expect(sql).toContain("not_planned");
    expect(sql).toContain("not_applicable");
    expect(sql).toContain("uq_budget_subhead_status");
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(runner).toContain('"417_budget_subhead_coverage_control.sql"');
    expect(manual).toContain("SOURCE sql/417_budget_subhead_coverage_control.sql;");
  });

  /**
   * Head/Sub-head coverage does not gate submission, and must not start doing so again.
   *
   * It originally required an explicit decision on every one of the 59 active Sub-heads
   * plus a typed reason for each one the branch was not budgeting, so a branch budgeting
   * 15 Sub-heads had to justify the other 44 every month. On the live drafts that was
   * 26 of 59 and 21 of 59 rows blocking purely for having no decision recorded, and one
   * budget with a single line was blocked on 58. Relaxing it to "only a stale planned
   * marker blocks" still left 3 rows blocking across the same drafts, and those were not
   * mandatory either. A branch budgets what it spends on and submits.
   *
   * Asserted against the submit path itself rather than by grepping for an error string,
   * so a re-added gate fails here even if it is worded differently.
   */
  describe("Head/Sub-head coverage never blocks submission", () => {
    const service = read("src/modules/process-pnl/budget-coverage.service.ts");

    /** submitBudget's body, so assertions cannot be satisfied by getCoverage/saveCoverage. */
    const submitBody = (() => {
      const start = service.indexOf("async submitBudget(");
      expect(start, "submitBudget not found").toBeGreaterThan(-1);
      return service.slice(start);
    })();

    it("has no coverage completeness gate in the submit path", () => {
      // Nothing may be thrown on account of a Head/Sub-head. This is the assertion that
      // matters: it catches a re-added gate however it is worded or implemented.
      //
      // Both throw forms are recognised. Matching only `throw new Error(` used to make this test
      // pass vacuously the moment the refusals moved to `throw refuse(status, code, message)` —
      // `thrown` came back empty, which is indistinguishable here from "no coverage gate exists".
      // The guard below that insists on a non-empty list is what caught it.
      const thrown = [...submitBody.matchAll(/throw (?:new Error|refuse)\(([\s\S]*?)\);/g)].map((m) => m[1]);
      expect(thrown.length, "expected submitBudget to still throw for its real guards").toBeGreaterThan(0);
      const coverageThrows = thrown.filter((message) => /sub-?head|coverage|decision/i.test(message));
      expect(
        coverageThrows,
        `submitBudget must not reject a budget over Head/Sub-head coverage: ${coverageThrows.join(" | ")}`,
      ).toEqual([]);

      expect(submitBody).not.toContain("Complete all Head/Sub-head decisions before submission");
      expect(submitBody).not.toMatch(/const\s+failures\s*=/);
    });

    it("requires only a draft status and at least one budget line", () => {
      expect(submitBody).toContain("Only a draft budget can be submitted");
      expect(submitBody).toContain("Add at least one budget line before submitting");
      expect(submitBody).toContain("FOR UPDATE");
    });

    it("treats a stale 'planned' marker as advisory, not a failure", () => {
      // Still surfaced — a "planned" Sub-head with no amount is stale and a branch head
      // reading it would be misled — but it is reported, never enforced.
      expect(isStalePlannedMarker({ planning_status: "planned", budget_line_count: 0 })).toBe(true);
      expect(isStalePlannedMarker({ planning_status: "planned", budget_line_count: 2 })).toBe(false);
      expect(isStalePlannedMarker({ planning_status: null, budget_line_count: 0 })).toBe(false);
      for (const status of ["not_planned", "not_applicable"]) {
        expect(isStalePlannedMarker({ planning_status: status, budget_line_count: 0 })).toBe(false);
      }
    });

    it("reports readiness from whether the budget has lines, not from decisions", () => {
      expect(service).toContain("readyToSubmit: lineCount > 0");
    });
  });

  it("intercepts the existing save and submit endpoints without changing URLs", () => {
    const routes = read("src/modules/process-pnl/budget-coverage.routes.ts");
    const financeRoutes = read("src/modules/finance/grn.routes.ts");
    expect(routes).toContain('"/pnl/budgets"');
    expect(routes).toContain('"/pnl/budgets/:id/coverage"');
    expect(routes).toContain('"/pnl/budgets/:id/submit"');
    expect(routes).toContain("syncPlannedFromLines");
    expect(routes).toContain("submitBudget");
    expect(financeRoutes).toContain("router.use(budgetCoverageRouter)");
  });

  it("exposes server-derived branch and role capabilities", () => {
    const routes = read("src/modules/process-pnl/budget-coverage.routes.ts");
    expect(routes).toContain('"/pnl/budgets/capabilities"');
    expect(routes).toContain("resolveFinanceBranchScope");
    expect(routes).toContain("canManageExpenseMaster");
    expect(routes).toContain("canReviewBranchStage");
    expect(routes).toContain("canReviewFinanceStage");
    expect(routes).toContain("canReviewAccountsStage");
  });

  it("renders the complete catalogue and role-aware budget workspace", () => {
    const page = read("../src/pages/finance/BranchBudgetManagementWorkspace.tsx");
    expect(page).toContain("Head/Sub-head Coverage");
    expect(page).toContain("Complete Expense Catalogue");
    expect(page).toContain("not_planned");
    expect(page).toContain("not_applicable");
    expect(page).toContain("Add line");
    expect(page).toContain("canManageExpenseMaster");
    expect(page).toContain("canReviewBranchStage");
    expect(page).toContain("Assigned branch");
  });
});
