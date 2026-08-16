/**
 * Approval and finance sign-off are two independent tracks on salary_prep_run:
 * payroll-signoff.routes.ts writes finance_approved_by/finance_approved_at and never
 * changes status, while updateRunStatus writes status and never reads sign-off. Because
 * the pending-sign-off queue filters on status='processing', moving a run to 'approved'
 * silently removes it from that queue whether or not finance ever signed.
 *
 * Verified live 2026-08-15: finance_approved_by is NULL on all 66 salary_prep_run rows -
 * sign-off has never been used once.
 *
 * UPDATED 2026-08-16 by owner ruling. Sign-off is now MANDATORY before LOCK or DISBURSE, with
 * an audited break-glass - see payroll-signoff-separation.test.ts. It is still deliberately NOT
 * required for 'approved', for the reason this file already gave: approval is the checker step,
 * and gating it on sign-off would make every run unapprovable. So the cases below still stand
 * exactly as written - approval records the flag rather than refusing on it. What changed is
 * only that the two states which move money are no longer reachable without it.
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

const { payrollService } = await import("../payroll.service.js");

function runRow(over: Record<string, unknown> = {}) {
  return { id: "run-1", run_month: "2026-06", status: "processing", finance_approved_by: null, ...over };
}

function arrange(row: Record<string, unknown>) {
  mockDb.execute.mockImplementation(async (sql: string) => {
    if (/SELECT \* FROM salary_prep_run/.test(sql)) return [[row], []];
    return [{ affectedRows: 1 }, []];
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("approving a run records whether finance had signed off", () => {
  it("flags finance_signed_off false when sign-off was never given", async () => {
    arrange(runRow({ finance_approved_by: null }));

    await payrollService.updateRunStatus("run-1", { status: "approved" } as any, "actor-1");

    const entry = mockLogSensitiveAction.mock.calls[0][0] as any;
    expect(entry.action_type).toBe("PAYROLL_RUN_APPROVED");
    expect(entry.change_summary.finance_signed_off).toBe(false);
    expect(entry.change_summary.previous_status).toBe("processing");
  });

  it("flags it true when finance had signed off", async () => {
    arrange(runRow({ finance_approved_by: "finance-user-9" }));

    await payrollService.updateRunStatus("run-1", { status: "approved" } as any, "actor-1");

    const entry = mockLogSensitiveAction.mock.calls[0][0] as any;
    expect(entry.change_summary.finance_signed_off).toBe(true);
  });

  it("does NOT block approval when sign-off is missing - it is recorded, not refused", async () => {
    arrange(runRow({ finance_approved_by: null }));

    await expect(
      payrollService.updateRunStatus("run-1", { status: "approved" } as any, "actor-1"),
    ).resolves.toBeDefined();

    const updates = mockDb.execute.mock.calls.filter((c: any[]) =>
      /UPDATE salary_prep_run SET/.test(String(c[0])),
    );
    expect(updates).toHaveLength(1);
    expect(String(updates[0][0])).toContain("approved_by = ?");
  });

  it("adds the flag only for approval, leaving other transitions' audit shape untouched", async () => {
    // finance_approved_at is now set on this fixture because DISBURSE is gated on sign-off as
    // of the 2026-08-16 ruling. The assertion below is unchanged and still about audit SHAPE -
    // that finance_signed_off is an approval-only field - not about whether disbursement is
    // allowed. Without a signed-off fixture the call would fail on the gate before ever
    // reaching the audit, and this case would be testing the wrong thing.
    arrange(runRow({ status: "locked", finance_approved_by: "finance-user-9", finance_approved_at: "2026-08-16 10:00:00" }));

    await payrollService.updateRunStatus("run-1", { status: "disbursed" } as any, "actor-1");

    const entry = mockLogSensitiveAction.mock.calls[0][0] as any;
    expect(entry.change_summary).not.toHaveProperty("finance_signed_off");
    expect(entry.action_type).toBe("PAYROLL_RUN_DISBURSED");
  });
});
