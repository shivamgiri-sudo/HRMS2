/**
 * Approval and finance sign-off are two independent tracks on salary_prep_run:
 * payroll-signoff.routes.ts writes finance_approved_by/finance_approved_at and never
 * changes status, while updateRunStatus writes status and never reads sign-off. Because
 * the pending-sign-off queue filters on status='processing', moving a run to 'approved'
 * silently removes it from that queue whether or not finance ever signed.
 *
 * Verified live 2026-08-15: finance_approved_by is NULL on all 66 salary_prep_run rows -
 * sign-off has never been used once. So this is deliberately RECORDED, not blocked: a
 * precondition requiring sign-off would make approval impossible for every run, including
 * the two 'processing' months this audit just unblocked. Hardening it is a payroll/finance
 * ruling; making the exception visible is not.
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
    arrange(runRow({ status: "locked", finance_approved_by: null }));

    await payrollService.updateRunStatus("run-1", { status: "disbursed" } as any, "actor-1");

    const entry = mockLogSensitiveAction.mock.calls[0][0] as any;
    expect(entry.change_summary).not.toHaveProperty("finance_signed_off");
    expect(entry.action_type).toBe("PAYROLL_RUN_DISBURSED");
  });
});
