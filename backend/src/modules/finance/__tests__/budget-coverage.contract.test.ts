import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { isInvalidCoverage } from "../../process-pnl/budget-coverage.service.js";

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
   * Until 2026-08-06 submission required an explicit decision on every one of the 59
   * active Sub-heads, plus a typed reason for each one the branch was not budgeting.
   * A branch that budgets 15 Sub-heads had to justify the other 44, every month. On the
   * live drafts that was 26 of 59 and 21 of 59 rows blocking purely for having no
   * decision recorded — the budgets were complete, the paperwork was not.
   *
   * A branch is not required to budget against every Head/Sub-head, so it is no longer
   * required to declare anything about the ones it skips. Asserted against the real
   * predicate rather than by grepping the source, so the rule cannot drift while the
   * strings still match.
   */
  describe("submission does not require a decision on every Sub-head", () => {
    it("lets an untouched Sub-head through — no decision, no reason", () => {
      expect(isInvalidCoverage({ planning_status: null, reason: null, budget_line_count: 0 })).toBe(false);
    });

    it("lets 'not planned' and 'not applicable' through without a reason", () => {
      // saveCoverage still asks for a reason when someone deliberately records one of
      // these; what changed is that submission no longer depends on it.
      for (const status of ["not_planned", "not_applicable"]) {
        expect(isInvalidCoverage({ planning_status: status, reason: null, budget_line_count: 0 })).toBe(false);
        expect(isInvalidCoverage({ planning_status: status, reason: "  ", budget_line_count: 0 })).toBe(false);
      }
    });

    it("still blocks a Sub-head marked 'planned' with no budget line", () => {
      // The one real contradiction: the marker promises an amount the budget does not
      // contain, and a branch head reading "planned" would expect one.
      expect(isInvalidCoverage({ planning_status: "planned", reason: null, budget_line_count: 0 })).toBe(true);
    });

    it("passes a Sub-head that is planned and has its line", () => {
      expect(isInvalidCoverage({ planning_status: "planned", reason: null, budget_line_count: 1 })).toBe(false);
    });

    it("keeps the transaction and row lock around the submit transition", () => {
      const service = read("src/modules/process-pnl/budget-coverage.service.ts");
      expect(service).toContain("FOR UPDATE");
      expect(service).toContain("Add at least one budget line before submitting");
      // The old rule's message must be gone, not merely unreachable.
      expect(service).not.toContain("Complete all Head/Sub-head decisions before submission");
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
