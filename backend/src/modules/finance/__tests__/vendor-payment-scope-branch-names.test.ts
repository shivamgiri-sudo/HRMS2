import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * getScopeBranchNames resolves the branch_master names for a branch-bound
 * FinanceBranchScope, and returns [] for organisation-wide scope — the data
 * the capabilities route needs to show "Karnal only" instead of a generic
 * "branch scope" pill.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

beforeEach(() => {
  execute.mockReset();
});

describe("vendorPaymentService.getScopeBranchNames", () => {
  it("returns [] for organisation-wide scope without querying the database", async () => {
    const { vendorPaymentService } = await import("../vendor-payment.service.js");
    const result = await vendorPaymentService.getScopeBranchNames({ mode: "all" });
    expect(result).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns resolved branch_name values for a branch-bound scope", async () => {
    execute.mockResolvedValue([
      [{ branch_name: "Karnal" }, { branch_name: "Noida-2" }],
      [],
    ]);
    const { vendorPaymentService } = await import("../vendor-payment.service.js");
    const result = await vendorPaymentService.getScopeBranchNames({
      mode: "branches",
      branchIds: ["branch-karnal", "branch-noida2"],
    });
    expect(result).toEqual(["Karnal", "Noida-2"]);
    expect(execute).toHaveBeenCalledTimes(1);
    const [sql, params] = execute.mock.calls[0];
    expect(sql).toMatch(/FROM branch_master/);
    expect(params).toEqual(["branch-karnal", "branch-noida2"]);
  });

  it("returns [] for a branch-bound scope with an empty branchIds array, without querying", async () => {
    const { vendorPaymentService } = await import("../vendor-payment.service.js");
    const result = await vendorPaymentService.getScopeBranchNames({
      mode: "branches",
      branchIds: [],
    });
    expect(result).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });
});
