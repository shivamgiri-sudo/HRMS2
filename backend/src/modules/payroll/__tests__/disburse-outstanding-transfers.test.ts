/**
 * A run must not be marked DISBURSED while salary-transfer items for it are still unresolved
 * ('exported' = no bank return yet, 'rejected', 'corrected_ready'). Approved by the owner 2026-10-03.
 * An independent break-glass reason overrides it and is audited as PAYROLL_RUN_DISBURSED_BREAKGLASS.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDb = { execute: vi.fn() };
vi.mock("../../../db/mysql.js", () => ({ db: mockDb }));

const mockLogSensitiveAction = vi.fn(async () => {});
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction: mockLogSensitiveAction }));
vi.mock("../payroll.notifications.js", () => ({
  notifyPayrollRunStatus: vi.fn(async () => {}),
  notifyPayslipsReady: vi.fn(async () => ({ employees: 0 })),
}));
vi.mock("../loans.service.js", () => ({ applyPayrollDeductions: vi.fn(async () => {}) }));

const { payrollService } = await import("../payroll.service.js");

const RUN = {
  id: "run-1",
  run_month: "2026-09",
  status: "locked",
  created_by: "preparer-1",
  approved_by: "approver-1",
  finance_approved_by: "fin-1",
  finance_approved_at: "2026-10-01 10:00:00", // sign-off given, so only the transfer guard is in play
};

function arrange(outstanding: Array<{ status: string; n: number }>) {
  mockDb.execute.mockImplementation(async (sql: string) => {
    if (/SELECT \* FROM salary_prep_run/.test(sql)) return [[RUN], []];
    if (/FROM user_roles/.test(sql)) return [[{ one: 1 }], []]; // actor holds a head role
    if (/FROM salary_transfer_batch_item/.test(sql)) return [outstanding, []];
    return [{ affectedRows: 1 }, []];
  });
}

beforeEach(() => vi.clearAllMocks());

describe("mark disbursed with unresolved salary transfers", () => {
  it("is refused with PAYROLL_TRANSFERS_OUTSTANDING and names the counts", async () => {
    arrange([{ status: "exported", n: 12 }, { status: "rejected", n: 3 }]);
    await expect(
      payrollService.updateRunStatus("run-1", { status: "disbursed" } as any, "head-9"),
    ).rejects.toMatchObject({ statusCode: 409, code: "PAYROLL_TRANSFERS_OUTSTANDING" });
    try {
      await payrollService.updateRunStatus("run-1", { status: "disbursed" } as any, "head-9");
    } catch (e: any) {
      expect(e.message).toContain("12 exported");
      expect(e.message).toContain("3 rejected");
      expect(e.outstanding).toEqual([{ status: "exported", count: 12 }, { status: "rejected", count: 3 }]);
    }
    // nothing was written
    const writes = mockDb.execute.mock.calls.filter(([sql]) => /^\s*UPDATE salary_prep_run/.test(String(sql)));
    expect(writes).toHaveLength(0);
  });

  it("proceeds when every item is confirmed (no unresolved rows)", async () => {
    arrange([]);
    await payrollService.updateRunStatus("run-1", { status: "disbursed" } as any, "head-9");
    const entry = mockLogSensitiveAction.mock.calls[0][0] as any;
    expect(entry.action_type).toBe("PAYROLL_RUN_DISBURSED");
  });

  it("proceeds for a run with no transfer items at all (paid outside the Payment Center)", async () => {
    arrange([]);
    await expect(
      payrollService.updateRunStatus("run-1", { status: "disbursed" } as any, "head-9"),
    ).resolves.toBeDefined();
  });

  it("can be overridden by an INDEPENDENT actor with a break-glass reason, and is audited as such", async () => {
    arrange([{ status: "exported", n: 2 }]);
    await payrollService.updateRunStatus(
      "run-1",
      { status: "disbursed", breakGlassReason: "Bank confirmed by phone, return file delayed" } as any,
      "independent-head",
    );
    const entry = mockLogSensitiveAction.mock.calls[0][0] as any;
    expect(entry.action_type).toBe("PAYROLL_RUN_DISBURSED_BREAKGLASS");
    expect(entry.reason).toBe("Bank confirmed by phone, return file delayed");
  });

  it("refuses break-glass from the person who prepared or approved the run", async () => {
    arrange([{ status: "rejected", n: 1 }]);
    for (const actor of ["preparer-1", "approver-1"]) {
      await expect(
        payrollService.updateRunStatus("run-1", { status: "disbursed", breakGlassReason: "urgent" } as any, actor),
      ).rejects.toMatchObject({ statusCode: 403, code: "PAYROLL_BREAKGLASS_NOT_INDEPENDENT" });
    }
  });

  it("does not apply to other transitions (locking is unaffected)", async () => {
    mockDb.execute.mockImplementation(async (sql: string) => {
      if (/SELECT \* FROM salary_prep_run/.test(sql)) return [[{ ...RUN, status: "approved" }], []];
      if (/FROM user_roles/.test(sql)) return [[{ one: 1 }], []];
      if (/FROM salary_transfer_batch_item/.test(sql)) throw new Error("must not be queried when not disbursing");
      if (/FROM salary_prep_line/.test(sql)) return [[], []]; // locking lapses leave for the run's employees
      return [{ affectedRows: 1 }, []];
    });
    await expect(
      payrollService.updateRunStatus("run-1", { status: "locked" } as any, "head-9"),
    ).resolves.toBeDefined();
  });
});
