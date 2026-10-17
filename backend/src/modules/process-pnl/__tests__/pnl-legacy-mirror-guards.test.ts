import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../shared/dbHelpers.js", () => ({ tableExists: vi.fn().mockResolvedValue(true), queryRows: vi.fn() }));

import { readLegacyMirrorSpend } from "../pnl-actuals.service.js";

/** The helper runs one query: the period's mirror particulars. */
function replay(lines: object[]) {
  execute.mockReset();
  execute.mockResolvedValueOnce([lines, []]);
}
const line = (o: Record<string, unknown>) => ({ branch_id: "b1", cost_centre_id: "cc1", process_id: null, amount: 5000, grn_ref: "MAS/9/26/1", vendor: "V", particular: "P", ...o });
const run = (detail = false) => readLegacyMirrorSpend("2026-09", { sql: "1 = 1", params: [] }, false, () => "", () => "NULL", detail);

beforeEach(() => execute.mockReset());

describe("legacy mirror leg (db_bill GRNs, periods before 2026-10)", () => {
  it("keeps every voucher the query returns: HRMS-raised GRNs are not read for these periods, so there is nothing to defer to", async () => {
    replay([line({}), line({ grn_ref: "MAS/9/26/2", amount: 13480 })]);
    const r = await run(true);
    expect(r.map((x) => Number(x.amount)).sort((a, b) => a - b)).toEqual([5000, 13480]);
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it("sums lines of one cost centre when detail is off, and keeps GRN-level rows when it is on", async () => {
    replay([line({ amount: 100 }), line({ amount: 200, grn_ref: "MAS/9/26/9" })]);
    const plain = await run(false);
    expect(plain).toHaveLength(1);
    expect(Number(plain[0].amount)).toBe(300);
    replay([line({ amount: 100 }), line({ amount: 200, grn_ref: "MAS/9/26/9" })]);
    const detail = await run(true);
    expect(detail).toHaveLength(2);
  });
  it("returns nothing when the period has no mirror lines", async () => {
    replay([]);
    expect(await run()).toEqual([]);
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it("reads on the MAS Callnet P&L sheet basis (owner rule 2026-10-17)", async () => {
    replay([]);
    await run();
    const sql = String(execute.mock.calls[0][0]);
    expect(sql, "vendor particulars ex-GST, imprest at total, header amount only when a GRN has none").toContain("COALESCE(CASE WHEN l.entry_type = 'Imprest' THEN l.total ELSE l.amount END, ge.amount) AS amount");
    expect(sql, "db_bill's RejectDate decides rejection").toContain("ge.rejected_at IS NULL");
    expect(sql, "negative-id rows are budget reopens, not spend").toContain("ge.bill_source_id > 0");
    expect(sql).toContain("(ge.comp_id IS NULL OR ge.comp_id = 1)");
    expect(sql).toContain("ge.grn_no NOT LIKE 'IDC/%'");
    expect(sql).toContain("ge.grn_no NOT LIKE 'Pikquick/%'");
    expect(sql, "MAS Callnet asset purchases are counted (owner, 2026-10-17)").not.toContain("REGEXP");
  });
});
