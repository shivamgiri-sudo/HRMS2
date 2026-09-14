import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What the leakage report counts as a live gap, and what it refuses to.
 *
 * The whole value of this report is the separation. Measured on production 2026-09-03 the raw
 * unlinked-GRN population is 80,907 records worth Rs 101.8 crore, of which roughly 78,000 are
 * migrated 2017-2019 history that was never meant to carry a cost allocation. If those land in the
 * same total as live gaps, the Rs 84 lakh that can actually be acted on is invisible — which is the
 * observed reason the existing Unlinked GRN Review list does not get worked through. So:
 *
 *   - actionableAmount must exclude every informational bucket, however large;
 *   - the current-FY bucket must stop at the reporting period, because a GRN dated to a future
 *     accounting month has deliberately not been budgeted yet (the reviewer's FUTURE_DEFERRED
 *     distinction). Without this the report counted Rs 26,505 each in 2027-01/02/03 as a gap.
 */

const { execute, tableExists } = vi.hoisted(() => ({
  execute: vi.fn(),
  tableExists: vi.fn(),
}));

vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../shared/dbHelpers.js", () => ({ tableExists }));

import { financeYearBounds, getCostLeakageReview } from "../pnl-cost-leakage.service.js";

beforeEach(() => {
  execute.mockReset();
  tableExists.mockReset();
  tableExists.mockResolvedValue(true);
  execute.mockResolvedValue([[], []]);
});

describe("financeYearBounds", () => {
  it("runs April to March, not January to December", () => {
    expect(financeYearBounds("2026-09")).toEqual({ label: "FY2026-27", from: "2026-04", to: "2027-03" });
    // A January period belongs to the financial year that opened the previous April.
    expect(financeYearBounds("2027-01")).toEqual({ label: "FY2026-27", from: "2026-04", to: "2027-03" });
    expect(financeYearBounds("2026-04")).toEqual({ label: "FY2026-27", from: "2026-04", to: "2027-03" });
    expect(financeYearBounds("2026-03")).toEqual({ label: "FY2025-26", from: "2025-04", to: "2026-03" });
  });
});

describe("scoping", () => {
  it("bounds the actionable buckets at the reporting period, not the end of the year", async () => {
    await getCostLeakageReview("2026-09");

    const ranged = execute.mock.calls
      .map(([sql, params]) => ({ sql: String(sql), params: (params ?? []) as unknown[] }))
      .filter((c) => c.sql.includes("accounting_period BETWEEN"));

    expect(ranged.length).toBeGreaterThan(0);
    for (const call of ranged) {
      // Never 2027-03: a future-dated GRN is deferred by design, not a gap.
      expect(call.params).toEqual(["2026-04", "2026-09"]);
    }
  });

  it("asks for legacy records strictly before the financial year opened", async () => {
    await getCostLeakageReview("2026-09");
    const legacy = execute.mock.calls
      .map(([sql, params]) => ({ sql: String(sql), params: (params ?? []) as unknown[] }))
      .find((c) => c.sql.includes("accounting_period <"));
    expect(legacy?.params).toEqual(["2026-04"]);
  });

  it("rejects a malformed period rather than scanning everything", async () => {
    await expect(getCostLeakageReview("2026")).rejects.toThrow(/YYYY-MM/);
  });
});

describe("actionable total", () => {
  it("counts only actionable buckets, however much larger the informational ones are", async () => {
    /*
     * Dispatch on the SQL, not on call order. The five buckets run under Promise.all, so their
     * queries interleave in whatever order the microtask queue produces — an earlier version of
     * this test queued mockResolvedValueOnce per bucket and silently handed the staffless bucket
     * the excluded-treatment fixture, passing a wrong total off as right.
     */
    execute.mockImplementation(async (sql: unknown) => {
      const text = String(sql);
      if (text.includes("FROM cost_centre_master")) {
        return [[{ id: "cc-1", cost_centre_code: "CC1", cost_centre_name: "Head Office",
                   branch_name: "HO", grn_count: 3, amount: "500000.00" }], []];
      }
      if (text.includes("THEN 'no_cost_centre'")) {
        return [[{ accounting_period: "2026-08", kind: "no_cost_centre", grn_count: 4,
                   amount: "200000.00" }], []];
      }
      if (text.includes("finance_expense_sub_head_master")) {
        return [[{ sub_head_name: "Computers - Cost", pnl_treatment: "excluded", grn_count: 1,
                   amount: "100000.00" }], []];
      }
      if (text.includes("accounting_period <")) {
        return [[{ yr: "2019", grn_count: 22236, amount: "1010000000.00" }], []];
      }
      if (text.includes("FROM expense_claim")) {
        return [[{ status: "submitted", claim_count: 5634, amount: "124868847.00",
                   no_cost_centre: 5634, latest: "2026-06-25" }], []];
      }
      return [[], []];
    });

    const result = await getCostLeakageReview("2026-09");

    // 5,00,000 staffless + 2,00,000 unlinked. The 101 crore of legacy and 12.49 crore of expense
    // ledger are reported but must never enter this figure.
    expect(result.actionableAmount).toBe(700000);
    expect(result.financeYear).toBe("FY2026-27");

    const byCode = Object.fromEntries(result.buckets.map((b) => [b.code, b]));
    expect(byCode.STAFFLESS_COST_CENTRE.actionable).toBe(true);
    expect(byCode.STAFFLESS_COST_CENTRE.amount).toBe(500000);
    expect(byCode.UNLINKED_GRN_CURRENT_FY.actionable).toBe(true);
    expect(byCode.UNLINKED_GRN_CURRENT_FY.amount).toBe(200000);
    expect(byCode.EXCLUDED_TREATMENT_SPEND.actionable).toBe(false);
    expect(byCode.LEGACY_UNLINKED_GRN.actionable).toBe(false);
    expect(byCode.UNUSABLE_EXPENSE_LEDGER.actionable).toBe(false);

    // The informational buckets still report their real size — separated, not hidden.
    expect(byCode.LEGACY_UNLINKED_GRN.amount).toBe(1_010_000_000);
    expect(byCode.UNUSABLE_EXPENSE_LEDGER.amount).toBe(124_868_847);
  });

  it("stays at zero, and non-critical, when nothing is leaking", async () => {
    const result = await getCostLeakageReview("2026-09");
    expect(result.actionableAmount).toBe(0);
    const staffless = result.buckets.find((b) => b.code === "STAFFLESS_COST_CENTRE");
    expect(staffless?.severity).toBe("info");
  });
});

describe("resilience", () => {
  it("reports empty buckets rather than throwing when a source table is absent", async () => {
    tableExists.mockResolvedValue(false);
    const result = await getCostLeakageReview("2026-09");
    expect(result.buckets).toHaveLength(5);
    expect(result.buckets.every((b) => b.count === 0 && b.amount === 0)).toBe(true);
    expect(execute).not.toHaveBeenCalled();
  });
});
