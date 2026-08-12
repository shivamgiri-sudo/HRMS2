import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Multi-month recognition (Requirement 5).
 *
 * The invariant that matters is exactness. sum(period rows) must equal the amount being split,
 * to the paise, for every divisor — and it must hold by construction rather than by tolerance,
 * because the P&L view is a read model and drift there is invisible until a month-end fails to
 * tie. The brief's own worked examples are asserted directly.
 *
 * The financial-year rule is the user's ruling of 2026-08-07: the WHOLE amount is spread across
 * the months of the GRN's own FY only. A Jul-26..Jun-27 policy has nine eligible months and the
 * full amount is divided by nine — nothing carries forward, nothing is left unallocated.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

let svc: typeof import("../grn-period-allocation.service.js");
beforeAll(async () => {
  svc = await import("../grn-period-allocation.service.js");
}, 120_000);

beforeEach(() => execute.mockReset());

const sum = (rows: { recognition_amount: number }[]) =>
  rows.reduce((s, r) => s + Math.round(r.recognition_amount * 100), 0);

describe("computeEqualSplit — exactness", () => {
  it("splits 12,00,000 over 12 months into clean 1,00,000 rows", async () => {
    const periods = svc.monthsBetween("2026-04", "2027-03");
    const rows = svc.computeEqualSplit(1_200_000, periods);
    expect(rows).toHaveLength(12);
    expect(rows.every((r) => r.recognition_amount === 100_000)).toBe(true);
    expect(sum(rows)).toBe(120_000_000);
  });

  it("splits 10,000 over 3 months as 3,333.33 + 3,333.33 + 3,333.34", async () => {
    const rows = svc.computeEqualSplit(10_000, ["2026-04", "2026-05", "2026-06"]);
    expect(rows.map((r) => r.recognition_amount)).toEqual([3333.33, 3333.33, 3333.34]);
    expect(sum(rows)).toBe(1_000_000);
  });

  it("puts the residue on the LAST row, never the first", async () => {
    // A larger first row and smaller last one reads as an error to whoever checks it.
    const rows = svc.computeEqualSplit(10_000, ["2026-04", "2026-05", "2026-06"]);
    expect(rows[0].recognition_amount).toBeLessThanOrEqual(rows[2].recognition_amount);
  });

  it("reconciles exactly for every divisor from 1 to 24, on an awkward amount", async () => {
    // The general proof. 1,200,001.37 does not divide cleanly by anything useful.
    for (let n = 1; n <= 24; n++) {
      const periods = Array.from({ length: n }, (_, i) => `2026-${String((i % 12) + 1).padStart(2, "0")}`);
      const rows = svc.computeEqualSplit(1_200_001.37, periods);
      expect(sum(rows), `failed at n=${n}`).toBe(120_000_137);
    }
  });

  it("handles a single month without inventing a residue", async () => {
    const rows = svc.computeEqualSplit(4_567.89, ["2026-08"]);
    expect(rows).toHaveLength(1);
    expect(rows[0].recognition_amount).toBe(4_567.89);
  });

  it("refuses an empty month list rather than silently allocating nothing", async () => {
    expect(() => svc.computeEqualSplit(1000, [])).toThrow(/no months/i);
  });
});

describe("financial year", () => {
  it("starts in April", async () => {
    expect(svc.financialYearOf("2026-04")).toBe("2026-27");
    expect(svc.financialYearOf("2027-03")).toBe("2026-27");
    expect(svc.financialYearOf("2026-03")).toBe("2025-26");
  });

  it("rejects a malformed period instead of coercing it", async () => {
    expect(() => svc.financialYearOf("2026-13")).toThrow(/YYYY-MM/);
    expect(() => svc.financialYearOf("Aug-26")).toThrow(/YYYY-MM/);
  });
});

/**
 * These five tests asserted the FY clamp of 2026-08-07, which the ruling of
 * 2026-08-12 superseded: a recognition window may now cross financial years, and
 * the caller warns instead of the service silently shortening the window.
 * c4c5d8f8 changed resolveEligiblePeriods accordingly and left the tests behind,
 * so they were failing against behaviour that is deliberate. Rewritten to the
 * current ruling - the service is not touched.
 */
describe("resolveEligiblePeriods — FY crossing", () => {
  it("keeps all twelve months of an April-to-March policy", async () => {
    const r = svc.resolveEligiblePeriods({
      accountingPeriod: "2026-04", startPeriod: "2026-04", endPeriod: "2027-03",
    });
    expect(r.periods).toHaveLength(12);
    expect(r.clamped).toBe(false);
    expect(r.financialYear).toBe("2026-27");
  });

  it("keeps all twelve months of a July-to-June policy and flags the crossing", async () => {
    // Previously clamped to the nine months inside FY 2026-27. The window is now
    // kept whole and crossFy tells the caller to warn.
    const r = svc.resolveEligiblePeriods({
      accountingPeriod: "2026-07", startPeriod: "2026-07", endPeriod: "2027-06",
    });
    expect(r.periods).toEqual([
      "2026-07","2026-08","2026-09","2026-10","2026-11","2026-12",
      "2027-01","2027-02","2027-03","2027-04","2027-05","2027-06",
    ]);
    expect(r.clamped).toBe(false);
    expect(r.crossFy).toBe(true);
    expect(r.requestedCount).toBe(12);
    // the accounting period still determines the FY the GRN belongs to
    expect(r.financialYear).toBe("2026-27");
  });

  it("spreads the whole amount across every month of the window", async () => {
    // Still nothing left unallocated - but over twelve months, so the monthly
    // charge is the honest 1/12 rather than the 1/9 the clamp forced.
    const r = svc.resolveEligiblePeriods({
      accountingPeriod: "2026-07", startPeriod: "2026-07", endPeriod: "2027-06",
    });
    const rows = svc.computeEqualSplit(1_200_000, r.periods);
    expect(rows).toHaveLength(12);
    expect(sum(rows), "the full 12,00,000 must still be recognised").toBe(120_000_000);
    expect(rows.every((x) => x.recognition_amount === 100_000)).toBe(true);
  });

  it("keeps all six months of a Jan-to-Jun policy that runs into the next FY", async () => {
    // Jan-Mar 2027 are FY 2026-27, Apr-Jun 2027 are FY 2027-28.
    const r = svc.resolveEligiblePeriods({
      accountingPeriod: "2027-01", startPeriod: "2027-01", endPeriod: "2027-06",
    });
    expect(r.periods).toEqual(["2027-01","2027-02","2027-03","2027-04","2027-05","2027-06"]);
    expect(r.crossFy).toBe(true);
    const rows = svc.computeEqualSplit(600_000, r.periods);
    expect(rows.every((x) => x.recognition_amount === 100_000)).toBe(true);
  });

  it("allows a window lying entirely in the next FY, flagged as crossing", async () => {
    // Under the clamp this was zero eligible months and a hard error. It is now a
    // legitimate window - prepaid annual cover bought in advance - and the Finance
    // Head is warned rather than blocked.
    const r = svc.resolveEligiblePeriods({
      accountingPeriod: "2026-08", startPeriod: "2027-04", endPeriod: "2027-06",
    });
    expect(r.periods).toEqual(["2027-04", "2027-05", "2027-06"]);
    expect(r.crossFy).toBe(true);
    expect(r.financialYear).toBe("2026-27");
  });

  it("still refuses a window with no months at all", async () => {
    // The empty-split guard has to survive removing the clamp.
    expect(() =>
      svc.resolveEligiblePeriods({
        accountingPeriod: "2026-08", startPeriod: "2026-09", endPeriod: "2026-07",
      }),
    ).toThrow();
  });

  it("refuses a backwards window", async () => {
    expect(() =>
      svc.resolveEligiblePeriods({
        accountingPeriod: "2026-08", startPeriod: "2026-09", endPeriod: "2026-07",
      }),
    ).toThrow(/cannot end before it starts/i);
  });
});

describe("monthsBetween", () => {
  it("is inclusive of both ends and crosses the year boundary", async () => {
    expect(svc.monthsBetween("2026-11", "2027-02")).toEqual(["2026-11","2026-12","2027-01","2027-02"]);
  });

  it("returns one month when start equals end", async () => {
    expect(svc.monthsBetween("2026-08", "2026-08")).toEqual(["2026-08"]);
  });
});

describe("saveSplit", () => {
  function conn() {
    const statements: string[] = [];
    return {
      statements,
      execute: vi.fn(async (sql: string) => { statements.push(String(sql).replace(/\s+/g, " ").trim()); return [[], []]; }),
    };
  }

  it("refuses to write outside a transaction", async () => {
    await expect(
      svc.grnPeriodAllocationService.saveSplit(
        { costAllocationId: "a1", grnRequestId: "g1", recognitionAmount: 1200, accountingPeriod: "2026-04",
          startPeriod: "2026-04", endPeriod: "2026-06", actorUserId: "u1" },
        undefined as never,
      ),
    ).rejects.toThrow(/inside the caller's transaction/i);
  });

  it("clears the previous split before writing, so a re-save cannot double it", async () => {
    const c = conn();
    await svc.grnPeriodAllocationService.saveSplit(
      { costAllocationId: "a1", grnRequestId: "g1", recognitionAmount: 1200, accountingPeriod: "2026-04",
        startPeriod: "2026-04", endPeriod: "2026-06", actorUserId: "u1" },
      c as never,
    );
    const del = c.statements.findIndex((s) => /DELETE FROM grn_period_allocation/.test(s));
    const ins = c.statements.findIndex((s) => /INSERT INTO grn_period_allocation/.test(s));
    expect(del).toBeGreaterThanOrEqual(0);
    expect(ins).toBeGreaterThan(del);
  });

  it("marks the GRN deferred only when there is more than one month", async () => {
    const many = conn();
    await svc.grnPeriodAllocationService.saveSplit(
      { costAllocationId: "a1", grnRequestId: "g1", recognitionAmount: 1200, accountingPeriod: "2026-04",
        startPeriod: "2026-04", endPeriod: "2026-06", actorUserId: "u1" }, many as never);
    const manyUpdate = many.execute.mock.calls.find(([s]) => /UPDATE grn_request/.test(String(s)));
    expect(manyUpdate?.[1]).toContain("deferred");

    const one = conn();
    await svc.grnPeriodAllocationService.saveSplit(
      { costAllocationId: "a1", grnRequestId: "g1", recognitionAmount: 1200, accountingPeriod: "2026-04",
        startPeriod: "2026-04", endPeriod: "2026-04", actorUserId: "u1" }, one as never);
    const oneUpdate = one.execute.mock.calls.find(([s]) => /UPDATE grn_request/.test(String(s)));
    expect(oneUpdate?.[1]).toContain("single");
  });

  it("reports the FY crossing back to the caller so the UI can warn", async () => {
    const c = conn();
    const out = await svc.grnPeriodAllocationService.saveSplit(
      { costAllocationId: "a1", grnRequestId: "g1", recognitionAmount: 1_200_000, accountingPeriod: "2026-07",
        startPeriod: "2026-07", endPeriod: "2027-06", actorUserId: "u1" }, c as never);
    expect(out.clamped).toBe(false);
    expect(out.crossFy).toBe(true);
    // nothing is dropped any more, so eligible and requested agree
    expect(out.eligibleCount).toBe(12);
    expect(out.requestedCount).toBe(12);
    expect(out.financialYear).toBe("2026-27");
  });
});
