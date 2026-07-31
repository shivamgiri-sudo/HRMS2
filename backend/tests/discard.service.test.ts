import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The restore ladder is the part of the discard feature that can silently
 * corrupt attendance, so it is tested directly rather than through the
 * transaction. Every branch below corresponds to a real shape found in the live
 * database on 2026-07-31.
 */

// vi.mock is hoisted above the imports, so the spy must be hoisted with it.
const { getConnection } = vi.hoisted(() => ({ getConnection: vi.fn() }));
vi.mock("../src/db/mysql.js", () => ({
  db: { execute: vi.fn().mockResolvedValue([[], []]), getConnection },
  pingDb: vi.fn(),
}));
vi.mock("../src/shared/scopeAccess.js", () => ({
  hasScopedAccess: vi.fn().mockResolvedValue(true),
  hasAnyRole: vi.fn().mockResolvedValue(true),
}));
vi.mock("../src/shared/auditLog.js", () => ({
  logSensitiveAction: vi.fn().mockResolvedValue(undefined),
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

import { db } from "../src/db/mysql.js";
import {
  planLeaveRestore,
  planRegularizationRestore,
  discardService,
  PAYROLL_CLOSED_STATUSES,
} from "../src/modules/discard/discard.service.js";
import { enumerateDates } from "../src/shared/attendanceSnapshot.js";

const exec = db.execute as ReturnType<typeof vi.fn>;
const REG_ID = "reg-1";
const DATE = "2026-07-15";

beforeEach(() => {
  vi.clearAllMocks();
  exec.mockResolvedValue([[], []]);
});

describe("enumerateDates", () => {
  it("is inclusive of both ends", () => {
    expect(enumerateDates("2026-06-01", "2026-06-03")).toEqual(["2026-06-01", "2026-06-02", "2026-06-03"]);
  });

  it("returns a single day when from === to", () => {
    expect(enumerateDates("2026-06-01", "2026-06-01")).toEqual(["2026-06-01"]);
  });

  it("crosses a month boundary without dropping or duplicating a day", () => {
    expect(enumerateDates("2026-01-30", "2026-02-02")).toEqual([
      "2026-01-30", "2026-01-31", "2026-02-01", "2026-02-02",
    ]);
  });

  it("handles a leap day", () => {
    expect(enumerateDates("2024-02-28", "2024-03-01")).toEqual([
      "2024-02-28", "2024-02-29", "2024-03-01",
    ]);
  });
});

describe("planRegularizationRestore — restore ladder", () => {
  it("restores exactly from the snapshot when one exists", () => {
    const plan = planRegularizationRestore(
      REG_ID, DATE,
      { attendance_status: "present", lwp_value: 0, regularization_id: REG_ID, is_locked: 1 },
      { row_existed: 1, snapshot: { attendance_status: "absent", lwp_value: 1 } }
    );
    expect(plan.mode).toBe("snapshot");
    expect(plan.restoredStatus).toBe("absent");
    expect(plan.restoredLwp).toBe(1);
  });

  it("DELETES the row when the snapshot says none existed before", () => {
    const plan = planRegularizationRestore(
      REG_ID, DATE,
      { attendance_status: "present", lwp_value: 0, regularization_id: REG_ID, is_locked: 1 },
      { row_existed: 0, snapshot: null }
    );
    expect(plan.mode).toBe("delete");
  });

  it("falls back to old_attendance_status when there is no snapshot", () => {
    const plan = planRegularizationRestore(
      REG_ID, DATE,
      {
        attendance_status: "present", lwp_value: 0, regularization_id: REG_ID, is_locked: 1,
        old_attendance_status: "half_day", old_lwp_value: 0.5,
        status_change_reason: "Regularization approved: WFH",
      },
      undefined
    );
    expect(plan.mode).toBe("partial");
    expect(plan.restoredStatus).toBe("half_day");
    expect(plan.restoredLwp).toBe(0.5);
  });

  it("DELETES when no snapshot and old_attendance_status is NULL on a row this approval created", () => {
    // attendance_status is NOT NULL DEFAULT 'unreconciled' (verified live: 0 NULLs
    // in 112,609 rows), so a NULL old_attendance_status can only mean the INSERT
    // branch ran — no row existed. 23 of 25 live approved regularizations are this shape.
    const plan = planRegularizationRestore(
      REG_ID, DATE,
      {
        attendance_status: "present", lwp_value: 0, regularization_id: REG_ID, is_locked: 1,
        old_attendance_status: null, old_lwp_value: null,
        status_change_reason: "Regularization approved: work_from_home",
      },
      undefined
    );
    expect(plan.mode).toBe("delete");
  });

  it("re-derives when nothing identifies the approval as the writer", () => {
    const plan = planRegularizationRestore(
      REG_ID, DATE,
      {
        attendance_status: "present", lwp_value: 0, regularization_id: REG_ID, is_locked: 0,
        old_attendance_status: null, status_change_reason: "some other process",
      },
      undefined
    );
    expect(plan.mode).toBe("rederive");
  });

  it("never touches a row a later correction owns", () => {
    const plan = planRegularizationRestore(
      REG_ID, DATE,
      { attendance_status: "present", lwp_value: 0, regularization_id: "some-other-reg", is_locked: 1 },
      { row_existed: 1, snapshot: { attendance_status: "absent", lwp_value: 1 } }
    );
    expect(plan.mode).toBe("skip_owned");
    expect(plan.restoredStatus).toBe("present"); // unchanged
  });

  it("never touches a locked row it does not own", () => {
    const plan = planRegularizationRestore(
      REG_ID, DATE,
      { attendance_status: "present", lwp_value: 0, regularization_id: null, is_locked: 1 },
      { row_existed: 1, snapshot: { attendance_status: "absent", lwp_value: 1 } }
    );
    expect(plan.mode).toBe("skip_locked");
  });
});

describe("planLeaveRestore — restore ladder", () => {
  it("restores from the snapshot", () => {
    const plan = planLeaveRestore(
      DATE,
      { attendance_status: "leave_approved", lwp_value: 0, is_locked: 0 },
      { row_existed: 1, snapshot: { attendance_status: "week_off", lwp_value: 0 } }
    );
    expect(plan.mode).toBe("snapshot");
    expect(plan.restoredStatus).toBe("week_off");
  });

  it("DELETES a row the approval created", () => {
    const plan = planLeaveRestore(
      DATE,
      { attendance_status: "leave_approved", lwp_value: 0, is_locked: 0 },
      { row_existed: 0, snapshot: null }
    );
    expect(plan.mode).toBe("delete");
  });

  it("re-derives rather than marking absent when there is no snapshot", () => {
    // Regression lock on the existing defect at leave.service.ts:340-348, which
    // blanket-writes absent + lwp 1.00 across every calendar day — inventing
    // unpaid absences on weekends and holidays the leave never covered.
    const plan = planLeaveRestore(
      DATE,
      { attendance_status: "leave_approved", lwp_value: 0, is_locked: 0 },
      undefined
    );
    expect(plan.mode).toBe("rederive");
    expect(plan.restoredStatus).not.toBe("absent");
    expect(plan.restoredLwp).not.toBe(1);
  });

  it("leaves a locked row alone", () => {
    const plan = planLeaveRestore(
      DATE,
      { attendance_status: "leave_approved", lwp_value: 0, is_locked: 1 },
      { row_existed: 1, snapshot: { attendance_status: "present", lwp_value: 0 } }
    );
    expect(plan.mode).toBe("skip_locked");
  });

  it("leaves a day that is no longer marked as approved leave alone", () => {
    const plan = planLeaveRestore(
      DATE,
      { attendance_status: "present", lwp_value: 0, is_locked: 0 },
      { row_existed: 1, snapshot: { attendance_status: "absent", lwp_value: 1 } }
    );
    expect(plan.mode).toBe("skip_owned");
  });
});

describe("payroll closed statuses", () => {
  it("includes finalized in lowercase so the utf8mb4_unicode_ci column matches stored 'FINALIZED'", () => {
    // Live census: 51 of 67 salary_prep_run rows are 'FINALIZED'. 'locked' and
    // 'disbursed' appear in zero rows, which is why CLOSED_RUN_STATUSES from
    // payroll-targeted-recalculation is deliberately not reused here.
    expect(PAYROLL_CLOSED_STATUSES).toContain("finalized");
    expect(PAYROLL_CLOSED_STATUSES).toContain("disbursed");
    expect(PAYROLL_CLOSED_STATUSES).toContain("locked");
    expect(PAYROLL_CLOSED_STATUSES).toContain("published");
  });

  it("treats an approved run as closed", () => {
    // calculatePayrollRunScoped ends with an unconditional
    // `UPDATE salary_prep_run SET status = 'processing'`, so recalculating an
    // approved run silently reverts its sign-off. 80 approved leaves sit in such
    // months and must go through a payroll adjustment instead.
    expect(PAYROLL_CLOSED_STATUSES).toContain("approved");
  });
});

describe("discardService.previewLeave", () => {
  const leaveRow = {
    id: "lr-1", employee_id: "emp-1", leave_type_id: "lt-1",
    from_date: "2026-07-01", to_date: "2026-07-03", total_days: 3,
    status: "approved", leave_name: "Casual Leave",
    employee_code: "MAS1", employee_name: "Test User",
  };

  function mockPreview(overrides: { leave?: any; run?: any[]; balance?: any } = {}) {
    exec.mockImplementation((sql: string) => {
      if (sql.includes("FROM leave_request")) return [[overrides.leave ?? leaveRow], []];
      if (sql.includes("FROM employees")) return [[{ branch_id: "b1" }], []];
      if (sql.includes("FROM salary_prep_run")) return [overrides.run ?? [], []];
      if (sql.includes("FROM leave_balance_ledger")) {
        return [[overrides.balance ?? { allocated_days: 12, adjusted_days: 0, used_days: 5 }], []];
      }
      if (sql.includes("FROM attendance_daily_record")) return [[], []];
      if (sql.includes("FROM attendance_state_snapshot")) return [[], []];
      return [[], []];
    });
  }

  const actor = { userId: "u1", roles: ["super_admin"], role: "super_admin" };

  it("computes the balance the discard would restore", async () => {
    mockPreview();
    const preview = await discardService.previewLeave("lr-1", actor);
    expect(preview.leave?.daysToRestore).toBe(3);
    expect(preview.leave?.balanceBefore).toBe(7);  // 12 + 0 - 5
    expect(preview.leave?.balanceAfter).toBe(10);  // 7 + 3
    expect(preview.blockers).toHaveLength(0);
  });

  it("blocks a leave that is not approved", async () => {
    mockPreview({ leave: { ...leaveRow, status: "pending" } });
    const preview = await discardService.previewLeave("lr-1", actor);
    expect(preview.blockers.map((b) => b.code)).toContain("NOT_APPROVED");
  });

  it("blocks when the payroll month is FINALIZED", async () => {
    mockPreview({ run: [{ run_month: "2026-07", status: "FINALIZED" }] });
    const preview = await discardService.previewLeave("lr-1", actor);
    expect(preview.blockers.map((b) => b.code)).toContain("PAYROLL_MONTH_CLOSED");
    expect(preview.payroll[0].isClosed).toBe(true);
  });

  it("blocks when the payroll month is approved (recalc would revert the sign-off)", async () => {
    mockPreview({ run: [{ run_month: "2026-07", status: "approved" }] });
    const preview = await discardService.previewLeave("lr-1", actor);
    expect(preview.blockers.map((b) => b.code)).toContain("PAYROLL_MONTH_CLOSED");
  });

  it("does not block a draft or processing month", async () => {
    mockPreview({ run: [{ run_month: "2026-07", status: "processing" }] });
    const preview = await discardService.previewLeave("lr-1", actor);
    expect(preview.blockers.map((b) => b.code)).not.toContain("PAYROLL_MONTH_CLOSED");
    expect(preview.payroll[0].isClosed).toBe(false);
  });

  it("blocks when any run for the month is closed, even if another is open", async () => {
    // 2026-03 really does carry both an 'approved' and a 'FINALIZED' run.
    mockPreview({ run: [
      { run_month: "2026-07", status: "approved" },
      { run_month: "2026-07", status: "FINALIZED" },
    ] });
    const preview = await discardService.previewLeave("lr-1", actor);
    expect(preview.blockers.map((b) => b.code)).toContain("PAYROLL_MONTH_CLOSED");
  });

  it("warns rather than crashing when no balance ledger row exists", async () => {
    exec.mockImplementation((sql: string) => {
      if (sql.includes("FROM leave_request")) return [[leaveRow], []];
      if (sql.includes("FROM employees")) return [[{ branch_id: "b1" }], []];
      if (sql.includes("FROM leave_balance_ledger")) return [[], []];
      return [[], []];
    });
    const preview = await discardService.previewLeave("lr-1", actor);
    expect(preview.leave?.ledgerRowExists).toBe(false);
    expect(preview.warnings.join(" ")).toMatch(/nothing to credit back/i);
  });

  it("throws 404 when the leave does not exist", async () => {
    exec.mockResolvedValue([[], []]);
    await expect(discardService.previewLeave("missing", actor)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("discardService.discardLeave", () => {
  const actor = { userId: "u1", roles: ["super_admin"], role: "super_admin" };

  it("refuses to run when the preview is blocked, and opens no transaction", async () => {
    exec.mockImplementation((sql: string) => {
      if (sql.includes("FROM leave_request")) {
        return [[{ id: "lr-1", employee_id: "emp-1", leave_type_id: "lt-1",
                   from_date: "2026-07-01", to_date: "2026-07-01", total_days: 1,
                   status: "pending" }], []];
      }
      if (sql.includes("FROM employees")) return [[{ branch_id: "b1" }], []];
      return [[], []];
    });
    await expect(discardService.discardLeave("lr-1", actor, "wrong employee entirely"))
      .rejects.toMatchObject({ statusCode: 409, code: "NOT_APPROVED" });
    expect(getConnection).not.toHaveBeenCalled();
  });
});
