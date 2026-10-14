import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * HRMS client-invoice revenue leg behind PNL_REVENUE_FROM_HRMS_BILLS: off = the db_bill-snapshot
 * query and output exactly as before; on = approved HRMS invoices (ex-GST) minus approved HRMS
 * credit notes, MAS only, is_migrated = 0, deduped against the snapshots by legacy_id.
 */
const { execute, tableExists } = vi.hoisted(() => ({ execute: vi.fn(), tableExists: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute } }));
vi.mock("../../../shared/dbHelpers.js", () => ({ tableExists, queryRows: vi.fn() }));

import { getInvoicedRevenueActuals } from "../pnl-actuals.service.js";
import { hrmsBillRevenueEnabled, monthLabelOfPeriod } from "../pnl-hrms-bill-revenue.js";

const ROWS = [
  { branch_id: "b1", cost_centre_id: "c1", process_id: "p1", amount: "100000.00" },
  { branch_id: "b1", cost_centre_id: "c2", process_id: "p2", amount: "-5000.00" },
];
const lastCall = () => execute.mock.calls.at(-1) as [string, unknown[]];

beforeEach(() => {
  execute.mockReset().mockResolvedValue([ROWS, []]);
  tableExists.mockReset().mockResolvedValue(true);
  delete process.env.PNL_REVENUE_FROM_HRMS_BILLS;
});
afterEach(() => { delete process.env.PNL_REVENUE_FROM_HRMS_BILLS; });

describe("flag", () => {
  it("is off by default and on for true / 1", () => {
    expect(hrmsBillRevenueEnabled()).toBe(false);
    process.env.PNL_REVENUE_FROM_HRMS_BILLS = "false";
    expect(hrmsBillRevenueEnabled()).toBe(false);
    process.env.PNL_REVENUE_FROM_HRMS_BILLS = "true";
    expect(hrmsBillRevenueEnabled()).toBe(true);
    process.env.PNL_REVENUE_FROM_HRMS_BILLS = "1";
    expect(hrmsBillRevenueEnabled()).toBe(true);
  });

  it("maps a period to the bill's month label", () => {
    expect(monthLabelOfPeriod("2026-09")).toBe("Sep-26");
    expect(monthLabelOfPeriod("2027-01")).toBe("Jan-27");
  });
});

describe("getInvoicedRevenueActuals with the flag off", () => {
  for (const withProvision of [true, false]) {
    it(`reads only the db_bill snapshots, same params and output (provision table ${withProvision ? "present" : "absent"})`, async () => {
      tableExists.mockImplementation(async (t: string) => t !== "billing_provision_snapshot" || withProvision);
      const out = await getInvoicedRevenueActuals("2026-09");
      const [sql, params] = lastCall();
      expect(sql).not.toContain("client_invoice");
      expect(sql).not.toContain("client_credit_note");
      expect(sql).not.toContain("hrms_");
      expect(params).toEqual(withProvision ? ["2026-09", "2026-09", "2026-09"] : ["2026-09", "2026-09"]);
      expect(out.byBranch.get("b1")).toBe(95000);
      expect(out.byProcess.get("p1")).toBe(100000);
      expect(out.byCostCentre.get("c2")).toBe(-5000);
    });
  }
});

describe("getInvoicedRevenueActuals with the flag on", () => {
  beforeEach(() => { process.env.PNL_REVENUE_FROM_HRMS_BILLS = "true"; });

  it("adds approved HRMS invoices minus approved HRMS credit notes, MAS, not migrated, deduped", async () => {
    await getInvoicedRevenueActuals("2026-09");
    const [sql, params] = lastCall();
    expect(sql).toContain("FROM client_invoice ci");
    expect(sql).toContain("ci.invoice_status = 'approved' AND ci.is_migrated = 0");
    expect(sql).toContain("SUM(ci.total_amount)");
    expect(sql).toContain("NOT EXISTS (SELECT 1 FROM billing_invoice_snapshot bis WHERE bis.bill_source_id = ci.legacy_id)");
    expect(sql).toContain("FROM client_credit_note cn");
    expect(sql).toContain("cn.credit_status = 'approved' AND cn.is_migrated = 0");
    expect(sql).toContain("-cn.total_amount");
    expect(sql).toContain("NOT EXISTS (SELECT 1 FROM billing_credit_note_snapshot bcs WHERE bcs.bill_source_id = cn.legacy_id)");
    // MAS predicate on both HRMS legs (plus the three snapshot legs).
    expect(sql.match(/mascallnet/g)!.length).toBe(5);
    // HRMS invoices also reduce their cost centre's provision fallback, like snapshot invoices.
    expect(sql).toContain("UNION ALL SELECT cost_centre_code, invoice_amount FROM hrms_invoice_actual");
    // Placeholders in SQL order: particulars, provision, HRMS invoice (label, month), snapshot CN, HRMS CN.
    expect(params).toEqual(["2026-09", "2026-09", "Sep-26", "2026-09", "2026-09", "Sep-26", "2026-09"]);
    expect((sql.match(/\?/g) ?? []).length).toBe(params.length);
  });

  it("without the provision table, the HRMS legs join the plain union with matching params", async () => {
    tableExists.mockImplementation(async (t: string) => t !== "billing_provision_snapshot");
    await getInvoicedRevenueActuals("2026-09");
    const [sql, params] = lastCall();
    expect(sql).toContain("FROM client_invoice ci");
    expect(sql).toContain("FROM client_credit_note cn");
    expect(params).toEqual(["2026-09", "Sep-26", "2026-09", "2026-09", "Sep-26", "2026-09"]);
    expect((sql.match(/\?/g) ?? []).length).toBe(params.length);
  });
});
