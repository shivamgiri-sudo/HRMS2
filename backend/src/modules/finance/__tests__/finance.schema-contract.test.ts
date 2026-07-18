import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { hasGlobalFinanceScope } from "../finance-access-scope.js";
import { resolveFinanceStageRole } from "../finance-workflow-role.js";

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
    expect(sql405).toContain("WHEN process_id IS NOT NULL THEN 'direct'");
    expect(sql405).toContain("WHEN cost_centre_id IS NOT NULL THEN 'direct'");
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

  it("preserves every payment installment in an additive transaction ledger", () => {
    const sql413 = read("sql/413_vendor_payment_transaction_ledger.sql");
    const runner = read("src/db/runFinanceSupplementalMigrations.ts");
    expect(sql413).toContain("CREATE TABLE IF NOT EXISTS vendor_payment_transaction");
    expect(sql413).toContain("vendor_payment_id");
    expect(sql413).toContain("sequence_no");
    expect(sql413).toContain("transaction_id");
    expect(sql413).toContain("proof_file_path");
    expect(sql413).toContain("Historical aggregate backfill");
    expect(runner).toContain('"413_vendor_payment_transaction_ledger.sql"');
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

  it("uses installment dispatch APIs instead of overwriting aggregate UTR fields", () => {
    const routes = read("src/modules/finance/vendor-payment.routes.ts");
    const ledgerService = read("src/modules/finance/vendor-payment-ledger.service.ts");
    const page = read("../src/pages/finance/VendorPaymentDispatchPage.tsx");
    expect(routes).toContain('"/vendor-payments/:id/dispatch"');
    expect(routes).toContain('"/vendor-payments/:id/transactions"');
    expect(routes).toContain("Aggregate payment updates are retired");
    expect(ledgerService).toContain("VENDOR_PAYMENT_INSTALLMENT_DISPATCHED");
    expect(ledgerService).toContain("paymentAmount");
    expect(page).toContain("/dispatch");
    expect(page).toContain("/transactions");
    expect(page).not.toContain("/update-payment");
    expect(page).not.toContain("/bulk-update");
  });

  it("treats branch roles as scoped and finance leadership as global", () => {
    expect(hasGlobalFinanceScope("finance_head", [])).toBe(true);
    expect(hasGlobalFinanceScope("branch_head", [])).toBe(false);
    expect(hasGlobalFinanceScope("employee", ["accounts_head"])).toBe(true);
    expect(hasGlobalFinanceScope("branch_admin", ["branch_head"])).toBe(false);
  });

  it("resolves approval ownership from every assigned role", () => {
    expect(resolveFinanceStageRole({
      primaryRole: "employee",
      userRoles: ["branch_head"],
      currentStatus: "submitted",
      workflow: "grn",
    })).toBe("branch_head");
    expect(resolveFinanceStageRole({
      primaryRole: "admin",
      userRoles: ["finance_head"],
      currentStatus: "branch_head_approved",
      workflow: "budget",
    })).toBe("finance_head");
    expect(resolveFinanceStageRole({
      primaryRole: "super_admin",
      userRoles: [],
      currentStatus: "finance_head_approved",
      workflow: "budget",
    })).toBe("accounts_head");
  });
});
