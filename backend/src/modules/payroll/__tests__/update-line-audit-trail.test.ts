/**
 * updateLine's actor id was received and discarded (`_userId`, unused) — an
 * edit to a calculated payroll line's attendance-derived inputs
 * (present_days/lwp_days/late_marks/dialer_hours/remarks) left no record of
 * who made it, violating the "every state-changing action must be
 * auditable" rule. Root-caused 2026-08-14 during the Payroll Run audit.
 *
 * Fixed by writing a sensitive_action_log row (via the existing
 * logSensitiveAction, matching updateRunStatus's own pattern a few lines
 * above updateLine in this file) with per-field old/new values, only for
 * fields the caller actually changed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDb = {
  execute: vi.fn(),
};

vi.mock("../../../db/mysql.js", () => ({ db: mockDb }));

const mockLogSensitiveAction = vi.fn(async () => {});
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction: mockLogSensitiveAction }));

const { payrollService } = await import("../payroll.service.js");

const EXISTING_LINE = {
  id: "line-1",
  run_id: "run-1",
  employee_id: "emp-1",
  present_days: 20,
  lwp_days: 1,
  late_marks: 2,
  dialer_hours: 160,
  remarks: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.execute.mockImplementation(async (sql: string) => {
    if (/SELECT \* FROM salary_prep_line WHERE id/.test(sql)) return [[EXISTING_LINE], []];
    if (/SELECT status FROM salary_prep_run/.test(sql)) return [[{ status: "draft" }], []];
    if (/UPDATE salary_prep_line SET/.test(sql)) return [{ affectedRows: 1 }, []];
    return [[], []];
  });
});

describe("updateLine writes an audited record of who changed what", () => {
  it("logs the actor, old value and new value for a changed field", async () => {
    await payrollService.updateLine("line-1", { presentDays: 21 } as any, "actor-42");

    expect(mockLogSensitiveAction).toHaveBeenCalledTimes(1);
    const entry = mockLogSensitiveAction.mock.calls[0][0];
    expect(entry.actor_user_id).toBe("actor-42");
    expect(entry.entity_type).toBe("salary_prep_line");
    expect(entry.entity_id).toBe("line-1");
    expect(entry.employee_id).toBe("emp-1");
    expect(entry.old_value_json).toEqual({ present_days: 20 });
    expect(entry.new_value_json).toEqual({ present_days: 21 });
  });

  it("only reports fields the caller actually changed, not the whole line", async () => {
    await payrollService.updateLine("line-1", { lwpDays: 2, remarks: "corrected" } as any, "actor-42");

    const entry = mockLogSensitiveAction.mock.calls[0][0];
    expect(Object.keys(entry.new_value_json)).toEqual(["lwp_days", "remarks"]);
    expect(entry.old_value_json).toEqual({ lwp_days: 1, remarks: null });
  });

  it("does not write an audit row when nothing was actually changed", async () => {
    await payrollService.updateLine("line-1", {} as any, "actor-42");
    expect(mockLogSensitiveAction).not.toHaveBeenCalled();
  });

  it("refuses to edit a line on a closed run before ever reaching the audit call", async () => {
    mockDb.execute.mockImplementation(async (sql: string) => {
      if (/SELECT \* FROM salary_prep_line WHERE id/.test(sql)) return [[EXISTING_LINE], []];
      if (/SELECT status FROM salary_prep_run/.test(sql)) return [[{ status: "FINALIZED" }], []];
      return [[], []];
    });
    await expect(
      payrollService.updateLine("line-1", { presentDays: 21 } as any, "actor-42"),
    ).rejects.toThrow(/Cannot edit line/);
    expect(mockLogSensitiveAction).not.toHaveBeenCalled();
  });
});
