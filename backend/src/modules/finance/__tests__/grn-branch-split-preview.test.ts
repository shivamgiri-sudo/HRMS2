import { beforeEach, describe, expect, it, vi } from "vitest";

const executeMock = vi.fn();
vi.mock("../../../db/mysql.js", () => ({ db: { execute: (...a: unknown[]) => executeMock(...a) } }));
vi.mock("../grn-head-office-bypass.js", () => ({ isHeadOfficeBranch: async (id: string) => id === "ho" }));
const coverageMock = vi.fn();
vi.mock("../../process-pnl/budget-headroom-gate.service.js", () => ({ getHeadSubHeadCoverage: (...a: unknown[]) => coverageMock(...a) }));
const driversMock = vi.fn();
vi.mock("../../process-pnl/branch-budget-allocation.service.js", () => ({ getMonthlyDrivers: (...a: unknown[]) => driversMock(...a) }));

import { getBranchSplitPreview } from "../grn-branch-split.js";

const cc = (id: string, code: string, extra: Record<string, unknown> = {}) =>
  ({ id, cost_centre_code: code, cost_centre_name: code, cc_type: "BACK OFFICE", process_type: "BACK OFFICE", ...extra });

describe("getBranchSplitPreview", () => {
  beforeEach(() => {
    executeMock.mockReset(); coverageMock.mockReset(); driversMock.mockReset();
    executeMock.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (/FROM branch_master/.test(sql)) return [[{ id: "ho", branch_name: "HEAD OFFICE" }, { id: "n2", branch_name: "NOIDA-2" }, { id: "d", branch_name: "Delhi Office" }], []];
      if (params?.[0] === "n2") return [[cc("577", "BSS/BO/NOIDA-2/577", { client_name: "Back Office" }), cc("576", "BSS/BO/NOIDA-2/576", { client_name: "Onfido LTD" })], []];
      return [[], []];
    });
    coverageMock.mockResolvedValue({ headerActive: true, lines: [{}], aggregateAvailable: 5000 });
    driversMock.mockResolvedValue([
      { plannedHeadcount: 10, revenueRatePerHead: 100, seatCount: 6, floorAreaSqft: 0, deviceCount: 0 },
      { plannedHeadcount: 30, revenueRatePerHead: 200, seatCount: 4, floorAreaSqft: 0, deviceCount: 0 },
    ]);
  });

  it("gives each receiving branch its own headroom and summed drivers; skips HO and branches with no Back Office", async () => {
    const out = await getBranchSplitPreview({ period: "2026-10", head: "Rent", subHead: null }, { GRN_BRANCH_SPLIT_ENABLED: "true" } as NodeJS.ProcessEnv);
    const n2 = out.branches.find((b) => b.branchId === "n2")!;
    expect(n2.status).toBe("ok");
    expect(n2.resolved?.code).toBe("BSS/BO/NOIDA-2/577");
    expect(n2.coverage).toEqual({ headerActive: true, hasAnyLine: true, aggregateAvailable: 5000 });
    expect(n2.drivers?.plannedHeadcount).toBe(40);
    expect(n2.drivers!.plannedHeadcount * n2.drivers!.revenueRatePerHead).toBe(10 * 100 + 30 * 200);
    expect(n2.drivers?.seatCount).toBe(10);
    expect(out.branches.find((b) => b.branchId === "ho")).toMatchObject({ coverage: null, drivers: null });
    expect(out.branches.find((b) => b.branchId === "d")).toMatchObject({ status: "none", coverage: null });
    expect(coverageMock).toHaveBeenCalledTimes(1);
  });
});
