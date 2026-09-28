import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GRN approval limit on the EXCLUDING-GST amount (owner decision, 2026-09-24).
 *
 * Reporting already treats a budget line as its ex-GST base_amount and a GRN as its
 * amount_without_tax. Enforcement compared that ex-GST spend against pnl_cost_amount
 * (base + NON-recoverable GST): a line budgeted at base 100 with 18 of non-recoverable GST carried
 * a ceiling of 118, so 118 of ex-GST spend fitted on a line the P&L shows as a 100 budget.
 *
 * Fixture: line base 100, tax 18 at 0% recoverable (so gross = pnl_cost = 118); GRN base 100,
 * tax 18 (gross 118). The last two tests in the first block FAIL on the old code, which measured
 * headroom as pnl_cost_amount − reserved − consumed.
 */

const { execute, getConnection } = vi.hoisted(() => ({ execute: vi.fn(), getConnection: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection } }));

import { budgetConsumptionService } from "../budget-consumption.service.js";
import { getHeadSubHeadCoverage } from "../budget-headroom-gate.service.js";
import { budgetLineAvailableSql, budgetLineCeiling } from "../budget-tax-basis.js";

const GRN_GROSS = 118;
const GRN_BASE = 100;

/** A budget line whose reserved/consumed counters really move with each UPDATE, so a sequence of
 *  GRNs sees the headroom the previous ones left behind. */
function statefulLine(over: Partial<Record<string, unknown>> = {}) {
  const line: Record<string, unknown> = {
    id: "bl1", budget_id: "b1", head: "Rent", sub_head: "Office Rent",
    tax_treatment: "exclusive", recoverable_tax_pct: 0, budget_status: "active",
    base_amount: 100, tax_amount: 18, gross_amount: 118, recoverable_tax_amount: 0, pnl_cost_amount: 118,
    quantity: 1, reserved_amount: 0, reserved_quantity: 0, consumed_amount: 0, consumed_quantity: 0,
    ...over,
  };
  const connection = {
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      const flat = String(sql).replace(/\s+/g, " ").trim();
      if (/FROM finance_budget_line l JOIN finance_budget_header/i.test(flat)) return [[{ ...line }], []];
      if (/finance_budget_subhead_closure|closure/i.test(flat)) return [[], []];
      if (/^UPDATE finance_budget_line SET reserved_amount = reserved_amount \+ \?/i.test(flat)) {
        line.reserved_amount = Number(line.reserved_amount) + Number(params[0]);
        return [{ affectedRows: 1 }, []];
      }
      return [[], []];
    }),
  } as any;
  return { line, connection };
}

beforeEach(() => {
  execute.mockReset();
  getConnection.mockReset();
});

describe("GRN approval is checked on the ex-GST basis", () => {
  it("approves a base-100 / tax-18 GRN against a base-100 line when it is the only spend", async () => {
    const { line, connection } = statefulLine();
    await expect(
      budgetConsumptionService.reserve(connection, "bl1", GRN_GROSS, 1, GRN_BASE)
    ).resolves.toBeUndefined();
    // Charged the taxable value, not the invoice gross.
    expect(Number(line.reserved_amount)).toBe(100);
  });

  it("blocks a second identical GRN", async () => {
    const { connection } = statefulLine();
    await budgetConsumptionService.reserve(connection, "bl1", GRN_GROSS, 1, GRN_BASE);
    await expect(
      budgetConsumptionService.reserve(connection, "bl1", GRN_GROSS, 1, GRN_BASE)
    ).rejects.toMatchObject({ code: "GRN_EXCEEDS_BUDGET_AMOUNT" });
  });

  it("leaves no headroom after the first GRN (old basis left 18 — the line was read as 118)", async () => {
    const { connection } = statefulLine();
    await budgetConsumptionService.reserve(connection, "bl1", GRN_GROSS, 1, GRN_BASE);
    // An 18-base follow-up fitted under the old pnl_cost_amount ceiling (118 − 100 = 18).
    await expect(
      budgetConsumptionService.reserve(connection, "bl1", 21.24, 1, 18)
    ).rejects.toMatchObject({ code: "GRN_EXCEEDS_BUDGET_AMOUNT" });
  });

  it("refuses a single GRN whose ex-GST value exceeds the ex-GST budget (old basis approved it)", async () => {
    const { line, connection } = statefulLine();
    await expect(
      budgetConsumptionService.reserve(connection, "bl1", 129.8, 1, 110)
    ).rejects.toThrow(/exceeds available budget amount by 10\.00/);
    expect(Number(line.reserved_amount)).toBe(0);
  });
});

describe("budgetLineCeiling — the ex-GST ceiling with the zero-default guard", () => {
  it("is base_amount, not pnl_cost_amount", () => {
    expect(budgetLineCeiling({ base_amount: 100, tax_amount: 18, gross_amount: 118, pnl_cost_amount: 118 })).toBe(100);
  });

  it("reads DECIMAL strings as mysql2 returns them", () => {
    expect(budgetLineCeiling({ base_amount: "100.00", gross_amount: "118.00", tax_amount: "18.00" })).toBe(100);
  });

  it("falls back to gross − tax on a legacy row whose base_amount was never populated", () => {
    expect(budgetLineCeiling({ base_amount: 0, gross_amount: 118, tax_amount: 18, pnl_cost_amount: 118 })).toBe(100);
    // tax 0 on such rows: the whole gross, the same rule pnl-ex-gst.ts applies.
    expect(budgetLineCeiling({ base_amount: 0, gross_amount: 500, tax_amount: 0 })).toBe(500);
  });

  it("falls back to pnl_cost_amount when neither base nor gross is populated, never to a silent zero", () => {
    expect(budgetLineCeiling({ base_amount: 0, gross_amount: 0, tax_amount: 0, pnl_cost_amount: 75 })).toBe(75);
    expect(budgetLineCeiling({ pnl_cost_amount: 75 })).toBe(75);
  });
});

describe("the save-time headroom gate reads the same ex-GST ceiling", () => {
  it("getHeadSubHeadCoverage measures available as base_amount − reserved − consumed", async () => {
    execute.mockResolvedValueOnce([[{ id: "header-1" }], []]);
    execute.mockResolvedValueOnce([[], []]);
    await getHeadSubHeadCoverage("branch-1", "2026-09", "Rent", "Office Rent");
    const sql = String(execute.mock.calls[1][0]);
    expect(sql).toContain(budgetLineAvailableSql("l"));
    expect(sql).toContain("COALESCE(NULLIF(l.base_amount, 0)");
    expect(sql).not.toMatch(/l\.pnl_cost_amount\s*-\s*l\.reserved_amount/);
  });
});
