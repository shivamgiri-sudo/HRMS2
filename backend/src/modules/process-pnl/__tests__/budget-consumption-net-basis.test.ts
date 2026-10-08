import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Charging a non-taxable budget line the GST-inclusive figure.
 *
 * A non_gst or exempt budget line's gross_amount is net of tax, so booking the tax-inclusive
 * invoice figure against it compares unlike things: a Rs 1,00,000 purchase carrying Rs 18,000
 * GST consumed Rs 1,18,000 against a Rs 1,02,000 line, and reserve() then REFUSED it — the
 * purchase was hard-blocked at Branch Head approval, not merely shown as overspent.
 *
 * consumptionBasis existed to correct exactly that and had been dead code since it was written:
 * no caller anywhere passed netAmountInput, so it always fell back to the gross. Every one of
 * the 94 budget lines in production is non_gst, so this governs every line there is.
 *
 * SYMMETRY IS THE LOAD-BEARING PART. release() and reverseConsumption() had no net parameter at
 * all. Passing the net to reserve() alone would charge the line Rs 1,00,000 and then try to
 * credit back Rs 1,18,000, which throws "Cannot release more budget amount than is reserved" —
 * converting a silent over-consumption into a failed rejection. All four take the net now, and
 * the round-trip test below is what would catch a future caller that forgets one.
 */

const { execute, getConnection } = vi.hoisted(() => ({ execute: vi.fn(), getConnection: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection } }));

import { budgetConsumptionService } from "../budget-consumption.service.js";

const GROSS = 118_000;
const NET = 100_000;

/** A budget line with Rs 1,02,000 of headroom, and a connection that records the writes. */
function lineConnection(taxTreatment: string, over: Partial<Record<string, unknown>> = {}) {
  const line = {
    id: "bl1", tax_treatment: taxTreatment, budget_status: "active",
    /*
     * pnl_cost_amount is the ceiling availability() measures against, NOT gross_amount.
     * gross_amount was a mixed-unit ceiling that silently allowed roughly (1/costRatio - 1)
     * over-spend on ITC lines, so the service moved to the P&L figure. This fixture kept only
     * gross_amount, so availability() read 0 and every reserve() here refused — the tests were
     * failing against correct code. For a non_gst/exempt line the two are equal by definition,
     * which is what production shows: pnl_cost_amount is populated on all 753 live budget lines
     * and equals gross on the 641 non-ITC ones.
     */
    gross_amount: 102_000, pnl_cost_amount: 102_000, quantity: 10,
    reserved_amount: 0, reserved_quantity: 0,
    consumed_amount: 0, consumed_quantity: 0,
    ...over,
  };
  const writes: Array<{ sql: string; params: unknown[] }> = [];
  return {
    writes,
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      const flat = String(sql).replace(/\s+/g, " ").trim();
      if (/SELECT .* FROM finance_budget_line/i.test(flat)) return [[line], []];
      writes.push({ sql: flat, params });
      return [{ affectedRows: 1 }, []];
    }),
  } as any;
}

/** The amount actually written, which is the first bound parameter on every UPDATE here. */
const chargedAmount = (conn: { writes: Array<{ params: unknown[] }> }) =>
  Number(conn.writes.at(-1)!.params[0]);

beforeEach(() => {
  execute.mockReset();
  getConnection.mockReset();
});

describe("a non-taxable budget line is charged the taxable value", () => {
  for (const treatment of ["non_gst", "exempt"]) {
    it(`reserve() charges the net against a ${treatment} line`, async () => {
      const conn = lineConnection(treatment);
      await budgetConsumptionService.reserve(conn, "bl1", GROSS, 1, NET);
      expect(chargedAmount(conn)).toBe(NET);
    });
  }

  it("reserve() no longer refuses a purchase that fits on the net", async () => {
    // The exact scenario the helper's own comment describes: 1,18,000 against 1,02,000 threw.
    const conn = lineConnection("non_gst");
    await expect(budgetConsumptionService.reserve(conn, "bl1", GROSS, 1, NET)).resolves.not.toThrow();
  });

  it("still refuses a purchase that does not fit even on the net", async () => {
    // The correction must not become a way past the ceiling.
    const conn = lineConnection("non_gst");
    await expect(
      budgetConsumptionService.reserve(conn, "bl1", 200_000, 1, 150_000)
    ).rejects.toThrow(/exceeds available budget amount/);
  });

  it("a taxable line is charged the net too — GST is ITC and never hits the budget", async () => {
    /*
     * This assertion used to expect the GROSS, on the theory that only non_gst/exempt lines
     * needed correcting. The rule has since widened and this test was left behind, failing
     * against correct code.
     *
     * budgetCostRatio() ignores the line's tax treatment entirely — its first parameter is
     * literally named `_taxTreatment` and is unused — because a budget represents P&L cost, and
     * for a vendor tax invoice the GST is recoverable as input tax credit and never reaches P&L.
     * So whenever a taxable value below the gross is supplied, that base is what consumes the
     * budget, on an `exclusive` line exactly as on a `non_gst` one.
     *
     * What still distinguishes the treatments in practice is the DATA, not this branch: for
     * non-ITC lines pnl_cost_amount equals gross_amount, so charging the base changes nothing.
     * Measured live, that holds for 641 of 753 budget lines.
     */
    const conn = lineConnection("exclusive", { gross_amount: 200_000, pnl_cost_amount: 200_000 });
    await budgetConsumptionService.reserve(conn, "bl1", GROSS, 1, NET);
    expect(chargedAmount(conn)).toBe(NET);
  });

  it("falls back to the gross when no net is supplied", async () => {
    // Keeps an un-updated caller on its previous behaviour rather than consuming zero.
    const conn = lineConnection("non_gst", { gross_amount: 200_000, pnl_cost_amount: 200_000 });
    await budgetConsumptionService.reserve(conn, "bl1", GROSS, 1);
    expect(chargedAmount(conn)).toBe(GROSS);
  });
});

describe("release and reverseConsumption use the same basis", () => {
  it("release() credits back exactly what reserve() charged", async () => {
    // Asymmetry here is not a rounding difference — it throws and blocks the rejection.
    const conn = lineConnection("non_gst", { reserved_amount: NET, reserved_quantity: 1 });
    await budgetConsumptionService.release(conn, "bl1", GROSS, 1, NET);
    expect(chargedAmount(conn)).toBe(NET);
  });

  it("release() without the net would exceed the reservation and throw", async () => {
    // Proves the asymmetry is real: the same call omitting the net is refused.
    const conn = lineConnection("non_gst", { reserved_amount: NET, reserved_quantity: 1 });
    await expect(
      budgetConsumptionService.release(conn, "bl1", GROSS, 1)
    ).rejects.toThrow(/Cannot release more budget amount than is reserved/);
  });

  it("reverseConsumption() credits back exactly what consume() charged", async () => {
    const conn = lineConnection("non_gst", { consumed_amount: NET, consumed_quantity: 1 });
    await budgetConsumptionService.reverseConsumption(conn, "bl1", GROSS, 1, NET);
    expect(chargedAmount(conn)).toBe(NET);
  });
});
