import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../../../..");

function read(relativePath: string) {
  return fs.readFileSync(path.join(backendRoot, relativePath), "utf8");
}

describe("budget top-up request workflow", () => {
  it("registers migration 1061 in the manifest", () => {
    const sql = read("sql/1061_finance_budget_topup_request.sql");
    const runner = read("src/db/runPendingMigrations.ts");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS finance_budget_topup_request");
    expect(sql).toContain("fk_budget_topup_line");
    expect(sql).toContain("fk_budget_topup_header");
    expect(sql).toContain("utf8mb4_unicode_ci");
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(runner).toContain('"1061_finance_budget_topup_request.sql"');
  });

  it("gates the two review stages with the shared GRN-shaped role resolver, not a new one", () => {
    const routes = read("src/modules/process-pnl/process-pnl.routes.ts");
    expect(routes).toContain("/pnl/budget-topups");
    expect(routes).toContain("/pnl/budget-topups/:id/review");
    expect(routes).toContain('workflow: "grn", // same two-stage shape');
    expect(routes).toContain("TOPUP_CREATE_ROLES");
    expect(routes).toContain("TOPUP_REVIEW_ROLES");
    // Branch scope must be checked before create and before review, same pattern as the rest
    // of this file's budget endpoints — not left to the service layer.
    const createIdx = routes.indexOf("budgetTopupService.create(");
    const reviewIdx = routes.indexOf("budgetTopupService.review(");
    expect(createIdx).toBeGreaterThan(-1);
    expect(reviewIdx).toBeGreaterThan(-1);
    expect(routes.slice(createIdx - 900, createIdx)).toContain("assertFinanceRecordBranch");
    expect(routes.slice(reviewIdx - 900, reviewIdx)).toContain("assertFinanceRecordBranch");
  });

  it("applies the increase under the same row lock GRN consumption uses, only at finance_head", () => {
    const service = read("src/modules/process-pnl/budget-topup.service.ts");
    expect(service).toContain("lockActiveBudgetLine");
    expect(service).toContain("gross_amount = gross_amount + ?");
    expect(service).toContain("quantity = quantity + ?");
    expect(service).toContain("status = 'applied'");
    // The apply block must be reachable only from the finance_head branch.
    const financeHeadIdx = service.indexOf('effectiveRole === "finance_head"');
    const applyIdx = service.indexOf("status = 'applied'");
    expect(applyIdx).toBeGreaterThan(financeHeadIdx);
  });

  it("exports lockActiveBudgetLine from budget-consumption.service.ts for reuse", () => {
    const service = read("src/modules/process-pnl/budget-consumption.service.ts");
    expect(service).toContain("export async function lockActiveBudgetLine");
  });
});
