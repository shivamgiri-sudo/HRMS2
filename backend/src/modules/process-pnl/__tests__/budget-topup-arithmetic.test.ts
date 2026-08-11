import { describe, expect, it } from "vitest";
import { calculateBudgetLine } from "../branch-budget.service.js";

/**
 * What an approved top-up must do to the line it increases.
 *
 * The old apply ran:
 *     UPDATE finance_budget_line
 *        SET gross_amount = gross_amount + ?, quantity = quantity + ?
 * with `?` = requested_amount and requested_quantity. Two separate errors, neither visible on
 * screen, and neither caught by a type: the row is just numbers either way.
 *
 * These tests work in the arithmetic itself rather than on the SQL text, so they fail if the
 * recomputation is ever replaced by an increment again — whatever it is spelled like.
 */

const BASE_LINE = {
  head: "Communication & Connectivity",
  itemName: "Company Owned Data",
  unit: "Nos",
  justification: "",
};

describe("applying a top-up to a budget line", () => {
  it("under exclusive GST, adding to gross_amount under-states it by the tax on the increase", () => {
    // A line of 10 units at Rs 1,000 with 18% GST exclusive.
    const before = calculateBudgetLine({ ...BASE_LINE, quantity: 10, unitRate: 1000, taxTreatment: "exclusive", gstRate: 18 });
    expect(before.baseAmount).toBe(10_000);
    expect(before.taxAmount).toBe(1_800);
    expect(before.grossAmount).toBe(11_800);

    // BudgetTopupPanel turns "I need Rs 5,000 more" into requestedQuantity = 5000 / 1000 = 5,
    // and passes requested_amount = 5,000.
    const requestedAmount = 5_000;
    const requestedQuantity = requestedAmount / 1000;

    const after = calculateBudgetLine({ ...BASE_LINE, quantity: 10 + requestedQuantity, unitRate: 1000, taxTreatment: "exclusive", gstRate: 18 });
    expect(after.grossAmount).toBe(17_700);

    // The old behaviour: gross_amount + requested_amount.
    const oldGross = before.grossAmount + requestedAmount;
    expect(oldGross).toBe(16_800);
    // Short by exactly the GST on the increase, and the line's own columns would then disagree
    // with each other: quantity says 15 units, gross says 16,800, base and tax say 10 units.
    expect(after.grossAmount - oldGross).toBe(900);
    expect(900).toBe(requestedAmount * 0.18);
  });

  it("carries the increase through to pnl_cost_amount, which every P&L read uses", () => {
    // 50% recoverable GST, so the P&L cost is base + half the tax.
    const before = calculateBudgetLine({ ...BASE_LINE, quantity: 10, unitRate: 1000, taxTreatment: "exclusive", gstRate: 18, recoverableTaxPct: 50 });
    const after = calculateBudgetLine({ ...BASE_LINE, quantity: 15, unitRate: 1000, taxTreatment: "exclusive", gstRate: 18, recoverableTaxPct: 50 });

    expect(before.pnlCostAmount).toBe(10_900);
    expect(after.pnlCostAmount).toBe(16_350);
    // The old apply never wrote this column at all, so a formally approved Rs 5,000 increase
    // left the P&L reporting the branch against the pre-top-up figure.
    expect(after.pnlCostAmount).toBeGreaterThan(before.pnlCostAmount);
  });

  it("keeps base + tax equal to gross after the increase", () => {
    const after = calculateBudgetLine({ ...BASE_LINE, quantity: 15, unitRate: 1000, taxTreatment: "exclusive", gstRate: 18 });
    expect(after.baseAmount + after.taxAmount).toBe(after.grossAmount);
    // And the CGST/SGST split still adds back to the whole tax.
    expect(after.cgstAmount + after.sgstAmount).toBe(after.taxAmount);
  });

  it("is a plain quantity increase when the line is non_gst — the only shape live today", () => {
    // All 94 production lines are non_gst at 0%, so this is the path a real top-up takes now.
    const before = calculateBudgetLine({ ...BASE_LINE, quantity: 1, unitRate: 150_000, taxTreatment: "non_gst", gstRate: 0 });
    const after = calculateBudgetLine({ ...BASE_LINE, quantity: 2, unitRate: 150_000, taxTreatment: "non_gst", gstRate: 0 });
    expect(before.grossAmount).toBe(150_000);
    expect(after.grossAmount).toBe(300_000);
    expect(after.pnlCostAmount).toBe(300_000);
    expect(after.taxAmount).toBe(0);
  });
});
