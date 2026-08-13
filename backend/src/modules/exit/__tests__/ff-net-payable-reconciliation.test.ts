/**
 * F&F settlements may no longer store a net payable that contradicts their own components.
 *
 * There is no F&F calculation engine — every monetary field on FfInput is supplied by the
 * caller, net_payable included. Nothing verified that the headline figure agreed with the
 * workings stored beside it, so a settlement could be saved, approved and paid on a number
 * unrelated to its own columns, and the gap would surface only if someone added them up by
 * hand, possibly years later in a dispute.
 *
 * This guard does not calculate the settlement. It refuses a total that disagrees with its
 * parts, which is the most that can honestly be asserted without an engine.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../db/mysql.js", () => ({
  db: { execute: vi.fn(async () => [[{ id: "x1", employee_id: "e1" }], []]) },
}));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction: vi.fn() }));
vi.mock("../exit.notifications.js", () => ({ notifyFullFinalReady: vi.fn() }));
vi.mock("../../payroll/payrollCalculate.service.js", () => ({ calculateGratuity: vi.fn() }));

const { ffService, ffComponentSum, FF_NET_TOLERANCE } = await import("../ff.service.js");

const BASE = {
  calculationDate: "2026-07-31",
  earnedLeaveEncashment: 12000,
  gratuityAmount: 50000,
  salaryHold: 8000,
  noticeRecovery: 15000,
  advancesRecovery: 5000,
};
// 12000 + 50000 + 8000 - 15000 - 5000
const CORRECT_NET = 50000;

describe("ffComponentSum", () => {
  it("is payouts less recoveries, and invents no component", () => {
    expect(ffComponentSum(BASE)).toBe(CORRECT_NET);
  });

  it("treats every missing field as zero rather than NaN", () => {
    expect(ffComponentSum({})).toBe(0);
    expect(ffComponentSum({ gratuityAmount: 100 })).toBe(100);
  });

  it("subtracts recoveries, so a large recovery can drive the settlement negative", () => {
    expect(ffComponentSum({ salaryHold: 1000, noticeRecovery: 4000 })).toBe(-3000);
  });
});

describe("createFF rejects a net payable that disagrees with its components", () => {
  it("accepts a settlement whose net equals its components", async () => {
    await expect(
      ffService.createFF("exit-1", { ...BASE, netPayable: CORRECT_NET }, "user-1"),
    ).resolves.toBeDefined();
  });

  it("rejects a net payable that is too high", async () => {
    await expect(
      ffService.createFF("exit-1", { ...BASE, netPayable: 65000 }, "user-1"),
    ).rejects.toThrow(/does not equal its own components/);
  });

  it("rejects a net payable that is too low", async () => {
    await expect(
      ffService.createFF("exit-1", { ...BASE, netPayable: 100 }, "user-1"),
    ).rejects.toThrow(/does not equal its own components/);
  });

  it("rejects the specific failure this guard exists for: recoveries omitted from the total", async () => {
    // The realistic mistake — someone totals the payouts and forgets to subtract what is owed.
    const payoutsOnly = 12000 + 50000 + 8000;
    await expect(
      ffService.createFF("exit-1", { ...BASE, netPayable: payoutsOnly }, "user-1"),
    ).rejects.toThrow(/notice recovery 15000\.00/);
  });

  it("rejects a settlement that omits net payable entirely while components are non-zero", async () => {
    const { netPayable: _omitted, ...noNet } = { ...BASE, netPayable: undefined };
    await expect(ffService.createFF("exit-1", noNet, "user-1")).rejects.toThrow(
      /does not equal its own components/,
    );
  });

  it("tolerates only sub-paisa float drift, not a real discrepancy", async () => {
    await expect(
      ffService.createFF("exit-1", { ...BASE, netPayable: CORRECT_NET + FF_NET_TOLERANCE / 2 }, "user-1"),
    ).resolves.toBeDefined();
    await expect(
      ffService.createFF("exit-1", { ...BASE, netPayable: CORRECT_NET + 1 }, "user-1"),
    ).rejects.toThrow(/does not equal its own components/);
  });

  it("accepts an all-zero settlement, which is internally consistent", async () => {
    await expect(ffService.createFF("exit-1", { calculationDate: "2026-07-31" }, "user-1")).resolves.toBeDefined();
  });

  it("names both figures in the error, so the preparer can see which side is wrong", async () => {
    await expect(
      ffService.createFF("exit-1", { ...BASE, netPayable: 65000 }, "user-1"),
    ).rejects.toThrow(/65000\.00.*50000\.00/s);
  });
});
