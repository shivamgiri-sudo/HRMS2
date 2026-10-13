import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../shared/dbHelpers.js", () => ({ tableExists: vi.fn().mockResolvedValue(true), queryRows: vi.fn() }));

import { readLegacyMirrorSpend } from "../pnl-actuals.service.js";

/** Replays the three queries of the helper in order: mirror lines, HRMS-raised GRNs with those numbers, HRMS-raised GRN totals. */
function replay(lines: object[], counted: string[], twins: object[]) {
  execute.mockReset();
  execute.mockResolvedValueOnce([lines, []]).mockResolvedValueOnce([counted.map((g) => ({ g })), []]).mockResolvedValueOnce([twins, []]);
}
const line = (o: Record<string, unknown>) => ({ branch_id: "b1", cost_centre_id: "cc1", process_id: null, amount: 5000, grn_ref: "MAS/9/26/1", vendor: "V", particular: "P", ...o });
const run = (detail = false) => readLegacyMirrorSpend("2026-09", { sql: "1 = 1", params: [] }, false, () => "", () => "NULL", detail);

beforeEach(() => execute.mockReset());

describe("legacy mirror leg: duplicate guards applied in code", () => {
  it("keeps a voucher HRMS does not carry", async () => {
    replay([line({})], [], []);
    const r = await run();
    expect(r).toHaveLength(1);
    expect(Number(r[0].amount)).toBe(5000);
  });
  it("guard 1: drops a voucher whose GRN number an HRMS-raised, counted GRN carries (case-insensitive)", async () => {
    replay([line({ grn_ref: "mas/9/26/1" })], ["MAS/9/26/1"], []);
    expect(await run()).toHaveLength(0);
  });
  it("guard 2: drops an amount twin (same branch, within a rupee, 1,000 or more) under another number", async () => {
    replay([line({ amount: 13480 })], [], [{ branch_id: "b1", ex_total: 13480.4, gross_total: 15906 }]);
    expect(await run()).toHaveLength(0);
  });
  it("guard 2 also matches the GST-inclusive total", async () => {
    replay([line({ amount: 15906 })], [], [{ branch_id: "b1", ex_total: 13480, gross_total: 15906 }]);
    expect(await run()).toHaveLength(0);
  });
  it("guard 2 leaves small amounts and other branches alone, and ignores a GRN without allocations", async () => {
    replay([line({ amount: 900 }), line({ amount: 7000, grn_ref: "MAS/9/26/2" }), line({ amount: 8000, grn_ref: "MAS/9/26/3" })], [],
      [{ branch_id: "b1", ex_total: 900, gross_total: 900 }, { branch_id: "other", ex_total: 7000, gross_total: 7000 }, { branch_id: "b1", ex_total: null, gross_total: null }]);
    expect((await run(true)).map((r) => Number(r.amount)).sort((a, b) => a - b)).toEqual([900, 7000, 8000]);
  });
  it("sums lines of one cost centre when detail is off, and keeps GRN-level rows when it is on", async () => {
    replay([line({ amount: 100 }), line({ amount: 200, grn_ref: "MAS/9/26/9" })], [], []);
    const plain = await run(false);
    expect(plain).toHaveLength(1);
    expect(Number(plain[0].amount)).toBe(300);
    replay([line({ amount: 100 }), line({ amount: 200, grn_ref: "MAS/9/26/9" })], [], []);
    const detail = await run(true);
    expect(detail).toHaveLength(2);
    expect(detail[0].source).toBe("db_bill_mirror");
  });
  it("returns nothing, and runs no guard query, when the period has no mirror lines", async () => {
    replay([], [], []);
    expect(await run()).toEqual([]);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
