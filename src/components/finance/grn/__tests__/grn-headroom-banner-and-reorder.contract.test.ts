import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const formPath = path.resolve(__dirname, "../BudgetLinkedGrnForm.tsx");

function read() {
  return fs.readFileSync(formPath, "utf8");
}

describe("BudgetLinkedGrnForm — Vendor field reorder (Group A1)", () => {
  it("places the Branch/Company block before the Vendor/GSTIN block in source order", () => {
    const form = read();
    const branchCompanyIdx = form.indexOf("Branch / Company — Vendor only");
    const vendorGstinIdx = form.indexOf("Row: Vendor, GSTIN, GST toggle");
    expect(branchCompanyIdx).toBeGreaterThan(-1);
    expect(vendorGstinIdx).toBeGreaterThan(-1);
    expect(branchCompanyIdx).toBeLessThan(vendorGstinIdx);
  });

  it("places the Invoice date/Invoice#/Due date block before the Head/Sub-head Budget Allocation block", () => {
    const form = read();
    const invoiceDateIdx = form.indexOf("Row: Date / Invoice # / Due Date");
    const budgetAllocationIdx = form.indexOf('Moved to sit right after Invoice date/Invoice #/Due date');
    expect(invoiceDateIdx).toBeGreaterThan(-1);
    expect(budgetAllocationIdx).toBeGreaterThan(-1);
    expect(invoiceDateIdx).toBeLessThan(budgetAllocationIdx);
  });

  it("gates the vendor Head/Sub-head selects on form.billDate, with a placeholder state when unset", () => {
    const form = read();
    expect(form).toContain("!form.billDate ? (");
    expect(form).toContain("Enter Invoice Date to select Head/Sub-head.");
  });

  it("leaves the old Branch/Company slot at the end of the details card empty (no lingering duplicate block)", () => {
    const form = read();
    const occurrences = form.split('label="Branch" required error={err("branchId")}').length - 1;
    // Imprest's own Company/Branch/Receipt-date row + the relocated Vendor Branch/Company row = 2.
    expect(occurrences).toBe(2);
  });

  it("does not touch the Imprest ({!isVendor}) block", () => {
    const form = read();
    expect(form).toContain("Imprest gets its own explicit sequence per the raiser's request");
  });
});

describe("BudgetLinkedGrnForm — authoritative headroom banner (Group C step 4)", () => {
  it("removes the old stale 'will be flagged as unbudgeted' banner text", () => {
    const form = read();
    expect(form).not.toContain("This GRN will be flagged as unbudgeted and require Finance Head approval.");
  });

  it("still keeps isUnbudgetedExpense and vendorCostCentreGroups driving the cost-centre split editor", () => {
    const form = read();
    expect(form).toContain("const isUnbudgetedExpense = useMemo(");
    expect(form).toContain("const vendorCostCentreGroups = useMemo(");
    expect(form).toContain("isUnbudgeted={isUnbudgetedExpense}");
  });

  it("fires GET /pnl/budget-headroom once branch/period/head/subHead are all set", () => {
    const form = read();
    expect(form).toContain('queryKey: ["budget-headroom"');
    expect(form).toContain("/api/finance/pnl/budget-headroom?branchId=");
    expect(form).toContain("enabled: Boolean(isVendor && form.branchId && effectivePeriod && form.head && form.subHead)");
  });

  it("renders the NO_BRANCH_BUDGET, NO_BUDGET_FOR_HEAD and HEADROOM_EXCEEDED states with matching wording", () => {
    const form = read();
    expect(form).toContain("A GRN cannot be raised until one is approved.");
    expect(form).toContain("has no budget anywhere in this branch. Raise a Budget Addition Request before submitting this GRN.");
    expect(form).toContain("Raise a Budget Addition Request");
    expect(form).toContain("is exhausted.");
  });

  it("deep-links the Budget Addition Request button with newLineHead/newLineSubHead and existing tab=topups convention", () => {
    const form = read();
    expect(form).toContain("/finance/branch-budget?tab=topups`");
    expect(form).toContain("&newLineHead=${encodeURIComponent(form.head)}");
    expect(form).toContain("&newLineSubHead=${encodeURIComponent(form.subHead)}");
  });
});
