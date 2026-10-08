import { describe, expect, it } from "vitest";
import { calculateBudgetLine } from "../branch-budget.service.js";

const base = {
  head: "IT",
  itemName: "Laptop hire",
  quantity: 10,
  unit: "Device",
  unitRate: 1000,
  taxTreatment: "exclusive" as const,
  gstRate: 18,
  gstType: "cgst_sgst" as const,
  recoverableTaxPct: 100,
  justification: "Monthly plan",
};

describe("branch budget tax calculation", () => {
  it("adds tax for an exclusive quote", () => {
    expect(calculateBudgetLine(base)).toMatchObject({ baseAmount: 10000, taxAmount: 1800, grossAmount: 11800, pnlCostAmount: 10000, cgstAmount: 900, sgstAmount: 900 });
  });

  it("backs tax out of an inclusive quote", () => {
    const result = calculateBudgetLine({ ...base, unitRate: 1180, taxTreatment: "inclusive" });
    expect(result).toMatchObject({ baseAmount: 10000, taxAmount: 1800, grossAmount: 11800, pnlCostAmount: 10000 });
  });

  it("adds non-recoverable tax to P&L cost", () => {
    const result = calculateBudgetLine({ ...base, recoverableTaxPct: 0 });
    expect(result.pnlCostAmount).toBe(11800);
  });

  it("keeps exempt lines tax free", () => {
    const result = calculateBudgetLine({ ...base, taxTreatment: "exempt", gstRate: 18 });
    expect(result).toMatchObject({ baseAmount: 10000, taxAmount: 0, grossAmount: 10000, pnlCostAmount: 10000, gstType: "none" });
  });
});
