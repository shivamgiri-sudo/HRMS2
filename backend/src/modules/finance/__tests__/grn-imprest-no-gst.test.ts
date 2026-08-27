import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { calculateBudgetLine } from "../../process-pnl/branch-budget.service.js";
import { applyImprestNoGst, IMPREST_TAX_PROFILE } from "../grn-imprest-tax.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../../../..");
const repoRoot = path.resolve(backendRoot, "..");

const read = (p: string) => fs.readFileSync(path.join(backendRoot, p), "utf8");
const readRepo = (p: string) => fs.readFileSync(path.join(repoRoot, p), "utf8");

/**
 * An imprest GRN is petty cash paid out of the branch float — a tea bill, an auto fare. There is
 * no tax invoice behind it, so there is no input tax credit to claim and every rupee of it is a
 * real cost: the WHOLE amount belongs in the P&L.
 *
 * The bug: an imprest allocation inherited the tax profile of whichever BUDGET LINE funded it.
 * Budget lines carry a PLANNING tax classification, and "Staff Welfare / Tea, Coffee &
 * Refreshment" is planned GST-inclusive at 18% with 100% recoverable. So a ₹2,112 tea voucher
 * split equally across 5 cost centres was decomposed into base + "GST", the phantom GST was
 * treated as recoverable, and only ₹1,789.85 reached the P&L — understating branch cost by
 * ₹322.15 of tax that was never paid and can never be reclaimed.
 */
describe("imprest GRNs carry no GST — the whole amount is P&L cost", () => {
  // The exact voucher from the report: ₹2,112.00 over 5 cost centres, equal split, against a
  // budget line planned as GST-inclusive 18% / 100% recoverable.
  const SHARE = 422.4;
  const inclusive18 = (unitRate: number) =>
    calculateBudgetLine({
      head: "Staff Welfare",
      subHead: "Tea, Coffee & Refreshment",
      itemName: "Tea, Coffee & Refreshment",
      quantity: 1,
      unit: "amount",
      unitRate,
      taxTreatment: "inclusive",
      gstRate: 18,
      gstType: "cgst_sgst",
      recoverableTaxPct: 100,
      justification: "Approved budget line",
    });

  it("reproduces the understatement the raw budget-line maths produces", () => {
    const rows = [SHARE, SHARE, SHARE, SHARE, SHARE].map(inclusive18);
    const gross = rows.reduce((sum, r) => sum + r.grossAmount, 0);
    const pnl = rows.reduce((sum, r) => sum + r.pnlCostAmount, 0);

    expect(Number(gross.toFixed(2))).toBe(2112);
    // This is the wrong number the Cost panel was showing — kept here so the regression is
    // recognisable if anyone reintroduces it.
    expect(Number(pnl.toFixed(2))).toBe(1789.85);
    expect(Number((gross - pnl).toFixed(2))).toBe(322.15);
  });

  it("applyImprestNoGst books the full amount to P&L and zeroes every tax column", () => {
    const rows = [SHARE, SHARE, SHARE, SHARE, SHARE].map(inclusive18).map(applyImprestNoGst);
    const gross = rows.reduce((sum, r) => sum + r.grossAmount, 0);
    const pnl = rows.reduce((sum, r) => sum + r.pnlCostAmount, 0);

    expect(Number(gross.toFixed(2))).toBe(2112);
    expect(Number(pnl.toFixed(2))).toBe(2112);
    for (const row of rows) {
      expect(row.baseAmount).toBe(row.grossAmount);
      expect(row.pnlCostAmount).toBe(row.grossAmount);
      expect(row.taxAmount).toBe(0);
      expect(row.cgstAmount).toBe(0);
      expect(row.sgstAmount).toBe(0);
      expect(row.igstAmount).toBe(0);
      expect(row.recoverableTaxAmount).toBe(0);
      expect(row.gstType).toBe("none");
      expect(row.recoverablePct).toBe(0);
    }
  });

  it("leaves an exclusive-GST budget line's gross untouched — only the split changes", () => {
    // exclusive 18% on ₹1,000 quotes ₹1,180 gross. Imprest must still consume ₹1,180 of budget
    // (headroom is measured in gross), it just books all ₹1,180 to P&L instead of ₹1,000.
    const raw = calculateBudgetLine({
      head: "Staff Welfare",
      itemName: "Tea",
      quantity: 1,
      unit: "amount",
      unitRate: 1000,
      taxTreatment: "exclusive",
      gstRate: 18,
      gstType: "cgst_sgst",
      recoverableTaxPct: 100,
      justification: "Approved budget line",
    });
    const imprest = applyImprestNoGst(raw);
    expect(raw.pnlCostAmount).toBe(1000);
    expect(imprest.grossAmount).toBe(raw.grossAmount);
    expect(imprest.grossAmount).toBe(1180);
    expect(imprest.pnlCostAmount).toBe(1180);
  });

  it("is a no-op on a line that already has no GST", () => {
    const raw = calculateBudgetLine({
      head: "Staff Welfare",
      itemName: "Tea",
      quantity: 1,
      unit: "amount",
      unitRate: 1428,
      taxTreatment: "non_gst",
      gstRate: 0,
      gstType: "none",
      recoverableTaxPct: 0,
      justification: "Approved budget line",
    });
    const imprest = applyImprestNoGst(raw);
    expect(imprest.grossAmount).toBe(1428);
    expect(imprest.pnlCostAmount).toBe(raw.pnlCostAmount);
    expect(imprest.pnlCostAmount).toBe(1428);
  });

  it("stores non-GST tax columns so nothing downstream re-derives a split", () => {
    expect(IMPREST_TAX_PROFILE).toEqual({
      taxTreatment: "non_gst",
      gstRate: 0,
      gstType: "none",
      recoverableTaxPct: 0,
    });
  });
});

describe("both GRN write paths apply the imprest rule", () => {
  it("saveAllocations() — the endpoint imprest actually posts to — flattens every row", () => {
    const service = read("src/modules/finance/grn-smart.service.ts");
    expect(service).toContain('const isImprest = String(grn.grn_type) === "imprest";');
    expect(service).toContain("const rowAmounts = isImprest ? applyImprestNoGst(amounts) : amounts;");
    // The flattened amounts are what gets persisted, not the raw budget-line maths.
    expect(service).toContain("amounts: rowAmounts,");
    expect(service).toContain("isImprest ? IMPREST_TAX_PROFILE.taxTreatment : item.line.tax_treatment,");
    expect(service).toContain("isImprest ? IMPREST_TAX_PROFILE.recoverableTaxPct : item.line.recoverable_tax_pct,");
  });

  it("the legacy single-line create path flattens too", () => {
    const service = read("src/modules/finance/grn.service.ts");
    expect(service).toContain('const isImprest = payload.grnType === "imprest";');
    expect(service).toContain("const amountsForGrn = isImprest ? applyImprestNoGst(amounts) : amounts;");
    expect(service).toContain("amountsForGrn.pnlCostAmount,");
    // The budget-line headroom check still runs on the untouched gross.
    expect(service).toContain("if (amounts.grossAmount > Number(budgetLine.available_gross_amount) + 0.01) {");
  });

  it("the GRN form shows the full amount as P&L impact for imprest", () => {
    const form = readRepo("src/components/finance/grn/BudgetLinkedGrnForm.tsx");
    expect(form).toContain("if (!isVendor) {");
    expect(form).toContain("sum.pnl += Number(calc.gross);");
  });
});
