import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { hasGlobalFinanceScope } from "../finance-access-scope.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../../../..");

function read(relativePath: string) {
  return fs.readFileSync(path.join(backendRoot, relativePath), "utf8");
}

describe("finance database and API contract", () => {
  it("preserves legacy GRN and vendor payment status values", () => {
    const sql310 = read("sql/310_vendor_payment_tracking.sql");
    expect(sql310).toContain("CREATE TABLE IF NOT EXISTS grn_request");
    expect(sql310).toContain("CREATE TABLE IF NOT EXISTS vendor_payment_tracking");
    for (const status of [
      "Payment Pending",
      "Partially Paid",
      "Paid",
      "On Hold",
      "Rejected",
      "Closed",
    ]) {
      expect(sql310).toContain(`'${status}'`);
    }
  });

  it("keeps process and cost-centre attribution from migration 405", () => {
    const sql405 = read("sql/405_finance_grn_vendor_cost_attribution.sql");
    expect(sql405).toContain("ADD COLUMN process_id");
    expect(sql405).toContain("ADD COLUMN cost_centre_id");
    expect(sql405).toContain("ADD COLUMN cost_class");
    expect(sql405).toContain("process_id IS NOT NULL OR cost_centre_id IS NOT NULL");
  });

  it("adds quantity-aware budget controls without replacing legacy tables", () => {
    const sql411 = read("sql/411_branch_budget_grn_approval_flow.sql");
    expect(sql411).toContain("CREATE TABLE IF NOT EXISTS finance_budget_header");
    expect(sql411).toContain("CREATE TABLE IF NOT EXISTS finance_budget_line");
    expect(sql411).toContain("reserved_quantity");
    expect(sql411).toContain("consumed_quantity");
    expect(sql411).toContain("budget_line_id");
    expect(sql411).toContain("branch_head_approved");
    expect(sql411).toContain("pending_accounts_payment");
    expect(sql411).toContain("amount_without_tax");
    expect(sql411).toContain("amount_with_tax");
  });

  it("defines the configurable expense head master", () => {
    const sql412 = read("sql/412_finance_expense_head_master.sql");
    expect(sql412).toContain("finance_expense_head_master");
    expect(sql412).toContain("finance_expense_sub_head_master");
    expect(sql412).toContain("default_tax_treatment");
    expect(sql412).toContain("default_allocation_driver");
    expect(sql412).toContain("Office Rent");
    expect(sql412).toContain("Computer Hire");
  });

  it("requires current authentication and branch scoping on finance routes", () => {
    const grnRoutes = read("src/modules/finance/grn.routes.ts");
    const paymentRoutes = read("src/modules/finance/vendor-payment.routes.ts");
    expect(grnRoutes).toContain("router.use(requireAuth)");
    expect(grnRoutes).toContain("resolveFinanceBranchScope");
    expect(grnRoutes).toContain("assertFinanceRecordBranch");
    expect(paymentRoutes).toContain("router.use(requireAuth)");
    expect(paymentRoutes).toContain("resolveFinanceBranchScope");
    expect(paymentRoutes).toContain("assertFinanceRecordBranch");
    expect(paymentRoutes).not.toContain('"/vendor-payments/from-grn"');
  });

  it("locks payment attribution to the Finance-approved GRN", () => {
    const service = read("src/modules/finance/vendor-payment.service.ts");
    expect(service).toContain("Process mapping is locked from the approved GRN");
    expect(service).toContain("Cost centre mapping is locked from the approved GRN");
    expect(service).toContain("Payment Pending");
    expect(service).toContain("transaction ID / UTR");
  });

  it("treats branch roles as scoped and finance leadership as global", () => {
    expect(hasGlobalFinanceScope("finance_head", [])).toBe(true);
    expect(hasGlobalFinanceScope("branch_head", [])).toBe(false);
    expect(hasGlobalFinanceScope("employee", ["accounts_head"])).toBe(true);
    expect(hasGlobalFinanceScope("branch_admin", ["branch_head"])).toBe(false);
  });
});
