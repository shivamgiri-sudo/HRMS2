import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Money is the spending control. The whole-unit quantity count is not.
 *
 * A budget line carries two ledgers. Lines are planned in whole units — "1 Month @ Rs 1,19,000",
 * "1 Connection @ Rs 1,20,000" — and every GRN books ONE unit against them whatever it is worth:
 * 1,506 of the 1,553 allocations on live budgets carry quantity = 1.0000. So the second invoice
 * of the month exhausted a 1-unit line while most of its money was unspent, and because 74% of
 * invoices come in under the approved unit rate, a burned unit always stranded money behind it.
 * The quantity ledger had also drifted from its own allocations on 362 of 701 active lines
 * (money: 23), including lines showing consumed_quantity > 0 with no allocation rows at all.
 *
 * availableLines() then hid any line with no quantity left, so the raiser was told the head had
 * no budget and to raise a top-up — for money already approved and sitting there. Rs 8,16,707
 * across 24 lines and 3 branches was unreachable in 2026-08 alone.
 *
 * Quantity is still written and still displayed. It must never refuse anything.
 */

const { execute, getConnection } = vi.hoisted(() => ({ execute: vi.fn(), getConnection: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection } }));

import { budgetConsumptionService } from "../budget-consumption.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../../../..");
const read = (p: string) => fs.readFileSync(path.join(backendRoot, p), "utf8");

/** A line whose money is fine but whose whole-unit count is exhausted — the real shape of
 *  NOIDA-2's "Security Service Charges": 1 Month planned, the month already booked, money left. */
function lineConnection(over: Partial<Record<string, unknown>> = {}) {
  const line = {
    id: "bl1", tax_treatment: "non_gst", budget_status: "active", unit: "Month",
    gross_amount: 119_000, quantity: 1,
    reserved_amount: 0, reserved_quantity: 1,
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

beforeEach(() => {
  execute.mockReset();
  getConnection.mockReset();
});

describe("the quantity ledger never refuses", () => {
  it("reserve() lets a GRN through on a line whose units are gone but whose money is not", async () => {
    // 1 Month planned and already reserved; Rs 1,19,000 still unspent. Before this, reserve()
    // threw GRN_EXCEEDS_BUDGET_QUANTITY and the spend was hard-blocked.
    const conn = lineConnection();
    await expect(budgetConsumptionService.reserve(conn, "bl1", 9_000, 1, 9_000)).resolves.toBeUndefined();
    expect(conn.writes.at(-1)!.params[0]).toBe(9_000);
  });

  it("reserve() still refuses when the MONEY runs out", async () => {
    const conn = lineConnection({ reserved_amount: 115_000 });
    await expect(
      budgetConsumptionService.reserve(conn, "bl1", 9_000, 1, 9_000)
    ).rejects.toMatchObject({ code: "GRN_EXCEEDS_BUDGET_AMOUNT" });
  });

  it("consume() no longer refuses when the reserved unit count is short of the GRN's", async () => {
    // Drifted ledger: money reserved, quantity not. This used to throw RESERVATION_INSUFFICIENT
    // and strand the GRN between Branch Head approval and payment.
    const conn = lineConnection({ reserved_amount: 9_000, reserved_quantity: 0 });
    await expect(budgetConsumptionService.consume(conn, "bl1", 9_000, 1, 9_000)).resolves.toBeUndefined();
  });

  it("consume() still refuses when the reserved MONEY is short", async () => {
    const conn = lineConnection({ reserved_amount: 100, reserved_quantity: 5 });
    await expect(
      budgetConsumptionService.consume(conn, "bl1", 9_000, 1, 9_000)
    ).rejects.toMatchObject({ code: "RESERVATION_INSUFFICIENT" });
  });

  it("release() and reverseConsumption() are not blocked by a drifted unit count", async () => {
    const release = lineConnection({ reserved_amount: 9_000, reserved_quantity: 0 });
    await expect(budgetConsumptionService.release(release, "bl1", 9_000, 1, 9_000)).resolves.toBeUndefined();
    const reverse = lineConnection({ consumed_amount: 9_000, consumed_quantity: 0 });
    await expect(
      budgetConsumptionService.reverseConsumption(reverse, "bl1", 9_000, 1, 9_000)
    ).resolves.toBeUndefined();
  });

  it("still writes the quantity, so the planning figure keeps updating", async () => {
    const conn = lineConnection();
    await budgetConsumptionService.reserve(conn, "bl1", 9_000, 3, 9_000);
    const write = conn.writes.at(-1)!;
    expect(write.sql).toContain("reserved_quantity = reserved_quantity + ?");
    expect(write.params[1]).toBe(3);
  });
});

describe("no GRN path gates on quantity any more", () => {
  it("the budget-line picker filters on money alone", () => {
    const service = read("src/modules/process-pnl/branch-budget.service.ts");
    expect(service).toContain("HAVING available_gross_amount > 0");
    expect(service).not.toContain("HAVING available_quantity > 0 AND available_gross_amount > 0");
  });

  it("neither GRN save path throws HEADROOM_EXCEEDED on quantity", () => {
    const service = read("src/modules/finance/grn-smart.service.ts");
    expect(service).not.toContain("split allocation exceeds available quantity");
    // The money-side branch-aggregate gate is untouched and still the hard limit. It now also
    // passes the row's TAXABLE value, so a line planned as non_gst/exempt is weighed against the
    // taxable figure it will actually be charged rather than the tax-inclusive one — still money,
    // still the hard limit, just the right money.
    expect(service).toContain("const draws = allocateAcrossLines(preferredLineId, grossTarget, netLines, netTarget);");
  });

  it("linking an unbudgeted split is not blocked by the line's unit count", () => {
    const service = read("src/modules/finance/grn-smart.service.ts");
    expect(service).not.toContain("remain approved on that line");
  });

  it("the legacy single-line create path drops its quantity refusal, keeps the money one", () => {
    const service = read("src/modules/finance/grn.service.ts");
    expect(service).not.toContain("GRN quantity exceeds available approved quantity");
    // The money refusal survives; it is now the BRANCH AGGREGATE rather than the single line the
    // raiser picked, so create and allocation-save answer alike instead of contradicting.
    expect(service).toContain("if (amounts.grossAmount > absorbable + 0.01) {");
    expect(service).toContain('"HEADROOM_EXCEEDED"');
  });
});
