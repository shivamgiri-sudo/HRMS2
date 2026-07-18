import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../../../..");

function read(relativePath: string) {
  return fs.readFileSync(path.join(backendRoot, relativePath), "utf8");
}

describe("mandatory branch-budget Head/Sub-head coverage", () => {
  it("registers an additive monthly coverage ledger", () => {
    const sql = read("sql/417_budget_subhead_coverage_control.sql");
    const runner = read("src/db/runFinanceSupplementalMigrations.ts");
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

  it("requires every active Sub-head to have a valid decision before submit", () => {
    const service = read("src/modules/process-pnl/budget-coverage.service.ts");
    expect(service).toContain("finance_expense_sub_head_master");
    expect(service).toContain("Complete all Head/Sub-head decisions before submission");
    expect(service).toContain("planning_status === \"planned\"");
    expect(service).toContain("budget_line_count");
    expect(service).toContain("reason is mandatory");
    expect(service).toContain("FOR UPDATE");
    expect(service).toContain("completeness 100%");
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
