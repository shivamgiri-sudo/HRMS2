import { describe, expect, it } from "vitest";
import { allocateBranchPools } from "../bpo-pnl.service.js";
import { allocateBranchPool } from "../bpo-pnl-allocation-overlay.service.js";
import type { ManualAllocationWarning } from "../bpo-pnl.calculation.js";

// Minimal fixtures — allocateBranchPools/allocateBranchPool are pure functions (no DB calls),
// so a plain in-memory ProcessPnlRecord-shaped row is enough.
function row(overrides: Record<string, unknown>) {
  return { processId: "p1", branchId: "b1", activeHc: 1, billableHc: 1, contractedSeats: 1, revenueMtd: 1, ...overrides } as any;
}

describe("allocateBranchPools — manual imbalance warning collection", () => {
  it("does not warn when manual percentages sum to 100", () => {
    const rows = [row({ processId: "p1" }), row({ processId: "p2" })];
    const policies = [
      { branch_id: "b1", process_id: "p1", pool_type: "bmc_people", allocation_driver: "manual", manual_allocation_pct: 60 },
      { branch_id: "b1", process_id: "p2", pool_type: "bmc_people", allocation_driver: "manual", manual_allocation_pct: 40 },
    ] as any;
    const pools = new Map([["b1", { amount: 100000 }]]);
    const warnings: ManualAllocationWarning[] = [];
    allocateBranchPools(rows, pools, policies, "bmc_people", warnings);
    expect(warnings).toHaveLength(0);
  });

  it("collects a warning when manual percentages don't sum to 100", () => {
    const rows = [row({ processId: "p1" }), row({ processId: "p2" })];
    const policies = [
      { branch_id: "b1", process_id: "p1", pool_type: "bmc_people", allocation_driver: "manual", manual_allocation_pct: 60 },
      { branch_id: "b1", process_id: "p2", pool_type: "bmc_people", allocation_driver: "manual", manual_allocation_pct: 30 },
    ] as any;
    const pools = new Map([["b1", { amount: 100000 }]]);
    const warnings: ManualAllocationWarning[] = [];
    allocateBranchPools(rows, pools, policies, "bmc_people", warnings);
    expect(warnings).toEqual([{ branchId: "b1", poolType: "bmc_people", percentTotal: 90 }]);
  });

  it("does not warn for non-manual (weighted) drivers, which always reconcile exactly", () => {
    const rows = [row({ processId: "p1", activeHc: 3 }), row({ processId: "p2", activeHc: 1 })];
    const policies = [{ branch_id: "b1", process_id: null, pool_type: "bmc_people", allocation_driver: "active_hc" }] as any;
    const pools = new Map([["b1", { amount: 100000 }]]);
    const warnings: ManualAllocationWarning[] = [];
    allocateBranchPools(rows, pools, policies, "bmc_people", warnings);
    expect(warnings).toHaveLength(0);
  });
});

describe("allocateBranchPool (overlay) — manual imbalance warning collection", () => {
  it("collects a warning when manual percentages don't sum to 100", () => {
    const rows = [row({ processId: "p1" }), row({ processId: "p2" })] as any;
    const policies = [
      { branch_id: "b1", process_id: "p1", pool_type: "shared_service", allocation_driver: "manual", manual_allocation_pct: 50 },
      { branch_id: "b1", process_id: "p2", pool_type: "shared_service", allocation_driver: "manual", manual_allocation_pct: 40 },
    ] as any;
    const warnings: ManualAllocationWarning[] = [];
    allocateBranchPool(rows, "b1", "shared_service", 50000, policies, warnings);
    expect(warnings).toEqual([{ branchId: "b1", poolType: "shared_service", percentTotal: 90 }]);
  });
});
