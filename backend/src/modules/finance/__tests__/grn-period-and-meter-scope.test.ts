import fs from "fs";
import path from "path";
import { describe, expect, it, vi } from "vitest";

/**
 * Three defects that each look like nothing until the data is read back.
 *
 *  - A meter could point at another branch's cost centre. Nothing rejected it; the metered
 *    amount simply vanished from the allocation later.
 *  - The GRN "which heads may I use" endpoint summed headroom across every period at once, so
 *    it offered money that createDraft then refused.
 *  - accounting_period was never written, so the column was NULL on every GRN and the
 *    accountingPeriod filter fell back to bill_date permanently.
 */

const financeDir = path.resolve(__dirname, "..");
const pnlDir = path.resolve(__dirname, "../../process-pnl");
const read = (dir: string, file: string) => fs.readFileSync(path.join(dir, file), "utf8");

describe("a meter belongs to one branch", () => {
  it("refuses a cost centre from another branch", async () => {
    vi.resetModules();
    const execute = vi.fn(async (sql: string) => {
      if (/FROM cost_centre_master/i.test(sql)) return [[{ branch_id: "branch-B" }], []];
      return [[], []];
    });
    vi.doMock("../../../db/mysql.js", () => ({ db: { execute, query: execute } }));
    const { createMeter } = await import("../../process-pnl/meter.service.js");

    await expect(
      createMeter({
        branchId: "branch-A", costCentreId: "cc-of-B", meterCode: "M1", meterName: "Main",
        readingUnit: "kWh", fixedRate: 8, effectiveFrom: "2026-08-01",
      }, "u1"),
      "the allocation silently drops a foreign cost centre, so this must be refused at the source"
    ).rejects.toThrow(/same branch/i);

    // Nothing may be written on the way to the refusal.
    const inserts = execute.mock.calls.filter(([sql]) => /INSERT INTO finance_meter_master/i.test(String(sql)));
    expect(inserts).toHaveLength(0);
    vi.doUnmock("../../../db/mysql.js");
  });

  it("refuses a cost centre that does not exist", async () => {
    vi.resetModules();
    const execute = vi.fn(async () => [[], []]);
    vi.doMock("../../../db/mysql.js", () => ({ db: { execute, query: execute } }));
    const { createMeter } = await import("../../process-pnl/meter.service.js");
    await expect(
      createMeter({
        branchId: "branch-A", costCentreId: "nope", meterCode: "M1", meterName: "Main",
        readingUnit: "kWh", fixedRate: 8, effectiveFrom: "2026-08-01",
      }, "u1")
    ).rejects.toThrow(/Cost centre not found/);
    vi.doUnmock("../../../db/mysql.js");
  });

  it("still drops an unmatched cost centre in the allocation — the reason the guard exists", () => {
    const allocation = read(pnlDir, "branch-budget-allocation.service.ts");
    expect(allocation).toContain("costCentres\n        .filter((cc) => branchConsumption.has(cc.id))");
  });
});

describe("expense-selectable answers for one branch and one period", () => {
  it("requires a period, for the same reason it requires a single branch", () => {
    const routes = read(financeDir, "grn.routes.ts");
    // Headroom is per branch AND per period; summing across periods offers money that is not
    // available in the month the GRN books to.
    expect(routes).toContain("Select a budget period (YYYY-MM) to see which expense heads are available");
    expect(routes).toContain("periodCode,");
    expect(routes).not.toContain("periodCode: req.query.periodCode ? String(req.query.periodCode) : undefined");
  });

  it("the service still filters on the period it is given", () => {
    const service = read(financeDir, "vendor-expense-mapping.service.ts");
    expect(service).toContain('conditions.push("bh.period_code = ?")');
  });
});

describe("a GRN records the period it books to", () => {
  it("writes accounting_period rather than leaving it NULL", () => {
    const service = read(financeDir, "grn.service.ts");
    const insert = service.slice(service.indexOf("INSERT INTO grn_request"));
    expect(insert.slice(0, 900)).toContain("bill_date, accounting_period,");
    // The same resolved value must number the GRN and be stored on it.
    expect(service).toContain("const accountingPeriod = resolveAccountingPeriod({");
    expect(service).toContain("allocateMonthlyGrnNumber({ periodCode: accountingPeriod })");
    expect(service).toContain("        accountingPeriod,\n");
  });

  it("keeps the bill_date fallback for rows raised before the column was written", () => {
    // Older rows have no stored period, so the filter must still find them.
    const service = read(financeDir, "grn.service.ts");
    expect(service).toContain("COALESCE(g.accounting_period, DATE_FORMAT(g.bill_date, '%Y-%m')) = ?");
  });
});
