import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * DB is globally mocked in tests/setup.ts. We hoist our own execute spy here so
 * we can queue per-test responses with mockResolvedValueOnce, matching the pattern
 * used by pnl-reconciliation.test.ts and other tests in this suite.
 */
const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

// Fixed IDs so assertions are deterministic across runs
const testEmployeeId = "emp-cc-hist-test-0001";
const ccOldId = "cc-hist-old-0001-uuid";
const ccNewId = "cc-hist-new-0001-uuid";

beforeEach(() => {
  execute.mockReset();
  execute.mockResolvedValue([[], []]);
  vi.resetModules();
});

describe("Cost Centre History Resolution", () => {
  it("returns old cost centre for date before transfer", async () => {
    // getCostCentreAtDate(emp, "2026-08-10")
    // Q1: effective_date <= '2026-08-10' → no rows (transfer is on 2026-08-15)
    execute.mockResolvedValueOnce([[], []]);
    // Q2: earliest change (ORDER BY effective_date ASC) → from=ccOldId, effective=2026-08-15
    execute.mockResolvedValueOnce([[{ from_cost_centre_id: ccOldId, effective_date: "2026-08-15" }], []]);

    const { getCostCentreAtDate } = await import("../cost-centre-history.service.js");
    const cc = await getCostCentreAtDate(testEmployeeId, "2026-08-10");
    expect(cc).toBe(ccOldId);
  });

  it("returns new cost centre for date on or after transfer", async () => {
    // getCostCentreAtDate(emp, "2026-08-15")
    // Q1: effective_date <= '2026-08-15' → row found (the transfer itself)
    execute.mockResolvedValueOnce([[{ to_cost_centre_id: ccNewId }], []]);

    const { getCostCentreAtDate } = await import("../cost-centre-history.service.js");
    const cc = await getCostCentreAtDate(testEmployeeId, "2026-08-15");
    expect(cc).toBe(ccNewId);
  });

  it("returns two periods for mid-month transfer", async () => {
    // getCostCentrePeriods(emp, "2026-08-01", "2026-08-31")
    //
    // Q1 (getCostCentrePeriods): changes within month → one row on 2026-08-15
    execute.mockResolvedValueOnce([[{ effective_date: "2026-08-15", to_cost_centre_id: ccNewId }], []]);
    // Q2 (getCostCentreAtDate("2026-08-01")): effective_date <= '2026-08-01' → no rows
    execute.mockResolvedValueOnce([[], []]);
    // Q3 (getCostCentreAtDate("2026-08-01")): earliest change → from=ccOldId, effective=2026-08-15
    execute.mockResolvedValueOnce([[{ from_cost_centre_id: ccOldId, effective_date: "2026-08-15" }], []]);

    const { getCostCentrePeriods } = await import("../cost-centre-history.service.js");
    const periods = await getCostCentrePeriods(testEmployeeId, "2026-08-01", "2026-08-31");

    expect(periods).toHaveLength(2);
    expect(periods[0]).toMatchObject({
      costCentreId: ccOldId,
      fromDate: "2026-08-01",
      toDate: "2026-08-14",
      days: 14,
    });
    expect(periods[1]).toMatchObject({
      costCentreId: ccNewId,
      fromDate: "2026-08-15",
      toDate: "2026-08-31",
      days: 17,
    });
  });
});
