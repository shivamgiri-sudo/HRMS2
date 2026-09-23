import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PNL_TERMS, pnlLabel } from "@/components/finance/pnl/pnlLabels";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const PNL_DIR = "src/components/finance/pnl";

/** The tabs a reader compares side by side: header strip, CEO Overview, Live P&L, Statement, Trend, Insights. */
const CROSS_TAB_SOURCES = [
  "src/pages/finance/ProcessPnlPage.tsx",
  `${PNL_DIR}/CeoOverviewPanel.tsx`,
  `${PNL_DIR}/PnlReconciliationPanel.tsx`,
  `${PNL_DIR}/PnlStatementView.tsx`,
  `${PNL_DIR}/PnlTrendExplorer.tsx`,
  `${PNL_DIR}/PnlInsightsPanel.tsx`,
];

describe("P&L glossary (audit items 23/24/28)", () => {
  it("uses British spelling and the canonical names", () => {
    expect(pnlLabel("RECOGNISED_REVENUE")).toBe("Recognised Revenue");
    expect(pnlLabel("PEOPLE_COST")).toBe("People Cost");
    expect(pnlLabel("INDIRECT_COST")).toBe("Indirect Cost (GRN)");
    expect(pnlLabel("GRN_CONSUMED")).toBe("GRN Consumed");
    expect(pnlLabel("GRN_COMMITTED")).toBe("GRN Committed (reserved)");
    expect(pnlLabel("OPERATING_PROFIT")).toBe("Operating Profit");
    expect(pnlLabel("OPERATING_MARGIN")).toBe("Operating Margin %");
    expect(pnlLabel("ACTIVE_HEADCOUNT")).toBe("Active Headcount");
    expect(pnlLabel("PAID_STAFF")).toBe("Paid Staff");
  });

  it("gives figures that differ by design clearly different names, each explaining the other", () => {
    const contribution = PNL_TERMS.OPERATING_PROFIT_CONTRIBUTION;
    const statement = PNL_TERMS.OPERATING_PROFIT;
    const ebit = PNL_TERMS.EBIT;
    expect(new Set([contribution.label, statement.label, ebit.label]).size).toBe(3);
    expect(contribution.tooltip).toMatch(/Statement/);
    expect(statement.tooltip).toMatch(/Operating Profit \(contribution\)/);
    expect(ebit.tooltip).toMatch(/Operating Profit \(contribution\)/);
    expect(ebit.label).toMatch(/after depreciation/);
  });

  it("every term has a non-empty tooltip", () => {
    for (const term of Object.values(PNL_TERMS)) expect(term.tooltip.length).toBeGreaterThan(20);
  });

  it("the cross-tab surfaces no longer carry the retired variant names", () => {
    const retired = [
      /"Recognized revenue"/,
      /"Invoiced revenue"/,
      /"Indicative OP \(simplified\)"/,
      />OP\*</,
      /"Vendor \(GRN\) cost"/,
      /"GRN actual \(consumed\)"/,
      /"Payroll cost"/,
      /label="People cost"/,
      /"Operating margin"/,
      />Operating margin</,
      /"Staff paid"/,
    ];
    for (const path of CROSS_TAB_SOURCES) {
      const source = read(path);
      for (const pattern of retired) expect({ path, hit: pattern.test(source) }).toEqual({ path, hit: false });
    }
  });

  it("CEO focus panel no longer calls blended revenue 'Invoiced revenue'", () => {
    const ceo = read(`${PNL_DIR}/CeoOverviewPanel.tsx`);
    expect(ceo).not.toContain('label="Invoiced revenue"');
    expect(ceo).toContain("<FocusCell label={revenueLabel}");
  });

  it("CEO People Cost tooltip describes the Statement's posted-payroll-first rule", () => {
    const ceo = read(`${PNL_DIR}/CeoOverviewPanel.tsx`);
    expect(ceo).not.toContain("separate day-by-day earned-to-date estimate");
    expect(ceo).toContain("posted payroll where it exists, the running snapshot otherwise");
  });
});
