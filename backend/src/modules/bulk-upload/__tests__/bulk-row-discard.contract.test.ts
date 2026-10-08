import fs from "fs";
import path from "path";
import { describe, expect, it, vi } from "vitest";

/**
 * Discarding ONE employee out of a pending incentive or deduction batch.
 *
 * Two things here are easy to get wrong in a way nothing would surface:
 *
 * 1. **A discarded incentive line must actually leave incentive_upload_line.**
 *    payrollCalculate.service.ts §5f sums that table for the month and filters ONLY on
 *    the parent batch's status — there is no validation_status test, no row-level flag it
 *    consults. So a line marked "discarded" but left in the table is still paid the moment
 *    the batch is approved, and every screen would show it as discarded while the payslip
 *    disagreed. Deductions are the opposite: payroll reads `status = 'active'`, so
 *    'inactive' is already invisible and a delete would destroy evidence for no gain.
 *
 * 2. **A discard needs a reason, and the reason has to reach the person who uploaded it.**
 *    Silently dropping a row from someone's file is worse than refusing the file.
 */

const DIR = path.resolve(__dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(DIR, f), "utf8");

/** Source with comments stripped — these files EXPLAIN the delete/deactivate split in
 *  prose, and a raw substring match would pass on the explanation alone. */
const readCode = (f: string) =>
  read(f)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

describe("what a discard does to the staged row", () => {
  const code = readCode("bulk-approval-review.service.ts");

  it("removes the incentive line from the table payroll actually reads", () => {
    expect(code).toMatch(/DELETE iul FROM incentive_upload_line iul/);
  });

  it("only ever deletes a line whose batch is still pending approval", () => {
    // Once the Payroll Head has approved, the rows are locked in
    // bulk_upload_locked_entity and reversing one is the discard module's job.
    const del = code.slice(code.indexOf("DELETE iul FROM incentive_upload_line"));
    expect(del.slice(0, 400)).toContain("iub.status = 'pending_approval'");
  });

  it("re-rolls the incentive batch totals so the header cannot disagree with its lines", () => {
    expect(code).toContain("ib.total_employees = (");
    expect(code).toContain("ib.total_amount = (");
  });

  it("deactivates a deduction rather than deleting it", () => {
    // payroll reads status='active', so 'inactive' is already invisible — deleting would
    // throw away the evidence of what was proposed for nothing.
    expect(code).toMatch(/UPDATE employee_deduction_entries\s+SET status = 'inactive'/);
    expect(code).not.toMatch(/DELETE\s+(FROM\s+)?employee_deduction_entries/);
  });

  it("keeps the spreadsheet row, with who discarded it, when, at which stage and why", () => {
    expect(code).toContain("row_status = 'discarded'");
    for (const col of ["discarded_by", "discarded_at", "discard_stage", "discard_reason"]) {
      expect(code).toContain(col);
    }
  });

  /**
   * Both of these were written after the browser walkthrough had already run, so neither
   * had been exercised end to end. They were verified live afterwards (imported_rows
   * 3 -> 2 -> 1; the emptied NSA sub-batch closed to 'rejected' with its totals at zero
   * while the PERF one stayed pending) and are pinned here so a refactor cannot drop them.
   */
  it("decrements the batch's own row count, so the queue does not show a stale number", () => {
    // imported_rows drives the ROWS column and the decision footer's "N rows will be…".
    expect(code).toMatch(/UPDATE upload_batch[\s\S]{0,200}imported_rows = GREATEST/);
    // GREATEST(..., 0): a replay must never drive the count negative.
    expect(code).toContain("GREATEST(COALESCE(imported_rows, 0) - 1, 0)");
  });

  it("closes an incentive sub-batch whose every line has been discarded", () => {
    // applyIncentiveBatch finds its sub-batches by joining THROUGH incentive_upload_line,
    // so one with no lines left is invisible to the approval that follows and would sit
    // at 'pending_approval' for ever with nothing able to move it.
    const del = code.slice(code.indexOf("DELETE iul FROM incentive_upload_line"));
    expect(del).toContain("SELECT COUNT(*) AS c FROM incentive_upload_line WHERE batch_id = ?");
    expect(del).toMatch(/UPDATE incentive_upload_batch[\s\S]{0,160}status = 'rejected'/);
    // Only ever closes one that is still pending — never reopens or overwrites a decision.
    expect(del).toMatch(/WHERE id = \? AND status = 'pending_approval'/);
  });

  it("writes the row-level decision to the shared approval timeline", () => {
    expect(code).toContain("recordFinanceApprovalEvent");
    expect(code).toContain("ROW_ENTITY_TYPE");
  });

  it("commits the domain change and the row mark together, or neither", () => {
    // Without one transaction per row, a failure could leave the spreadsheet row marked
    // discarded while its money was still staged — the exact discrepancy this prevents.
    expect(code).toContain("beginTransaction()");
    expect(code).toContain("conn.commit()");
    expect(code).toContain("conn.rollback()");
    expect(code).toContain("conn.release()");
  });
});

describe("the reason is mandatory", () => {
  it("refuses a discard with a reason under 10 characters", async () => {
    vi.resetModules();
    vi.doMock("../../../db/mysql.js", () => ({ db: { execute: vi.fn(), getConnection: vi.fn() } }));
    vi.doMock("../../../shared/auditLog.js", () => ({ logSensitiveAction: vi.fn() }));
    vi.doMock("../../../shared/financeApprovalEvent.js", () => ({
      recordFinanceApprovalEvent: vi.fn(), listFinanceApprovalEvents: vi.fn(),
    }));

    const { discardRows } = await import("../bulk-approval-review.service.js");
    await expect(
      discardRows({
        batch: {
          id: "b1", upload_batch_no: "BATCH-1", upload_type_code: "INCENTIVE_BULK",
          approval_status: "pending_branch_head",
        } as never,
        rowIds: ["r1"],
        stage: "branch",
        actorRole: "branch_head",
        userId: "u1",
        reason: "wrong",
      }),
    ).rejects.toThrow(/at least 10 characters/);
  });

  it("refuses a discard on a type that has no cost-centre review", async () => {
    vi.resetModules();
    vi.doMock("../../../db/mysql.js", () => ({ db: { execute: vi.fn(), getConnection: vi.fn() } }));
    vi.doMock("../../../shared/auditLog.js", () => ({ logSensitiveAction: vi.fn() }));
    vi.doMock("../../../shared/financeApprovalEvent.js", () => ({
      recordFinanceApprovalEvent: vi.fn(), listFinanceApprovalEvents: vi.fn(),
    }));

    const { discardRows } = await import("../bulk-approval-review.service.js");
    await expect(
      discardRows({
        batch: {
          id: "b1", upload_batch_no: "BATCH-1", upload_type_code: "LEAVE_APPLICATION_BULK",
          approval_status: "pending_branch_head",
        } as never,
        rowIds: ["r1"],
        stage: "branch",
        actorRole: "branch_head",
        userId: "u1",
        reason: "This leave row is not needed after all",
      }),
    ).rejects.toThrow(/only incentive and deduction/i);
  });
});

describe("the route around it", () => {
  const routes = readCode("bulk-approval.routes.ts");

  it("re-checks the stage permission — it does not trust that the page hid the button", () => {
    const fn = routes.slice(routes.indexOf('"/approvals/batches/:id/rows/discard"'));
    expect(fn).toContain("resolveStage(batch)");
    expect(fn).toContain("assertCanApprove(userId, batch, stage)");
  });

  it("refuses once the batch is no longer pending", () => {
    const fn = routes.slice(routes.indexOf('"/approvals/batches/:id/rows/discard"'));
    expect(fn).toMatch(/if \(!stage\)/);
  });

  it("notifies the creator once for the whole action, not once per row", () => {
    const fn = routes.slice(
      routes.indexOf('"/approvals/batches/:id/rows/discard"'),
      routes.indexOf('"/approvals/batches/:id/approve"'),
    );
    expect(fn.match(/notifyBatchCreator\(/g)?.length).toBe(1);
    expect(fn).toContain('event: "rows_discarded"');
  });
});

describe("the creator notification", () => {
  const code = readCode("bulk-approval-notify.service.ts");

  it("never lets a channel failure fail the decision", () => {
    // The money has either moved or it has not; an SMTP timeout has no business
    // changing that answer.
    expect(code.match(/catch \(err\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(code).toContain("return outcome;");
  });

  it("reads the display name off employees, never off auth_user.full_name", () => {
    // auth_user has no full_name column (live schema). Two call sites selected it and
    // could only ever raise ER_BAD_FIELD_ERROR.
    expect(code).not.toMatch(/au\.full_name|auth_user[\s\S]{0,120}\bfull_name\b(?![^\n]*employees)/);
    expect(code).toContain("LEFT JOIN employees e ON e.user_id = au.id");
  });

  it("uses a DLT-registered template for SMS rather than free text", () => {
    // Under TRAI DLT the content must match a registered template; SmartPing answers
    // HTTP 200 even when it refuses, so an unregistered send fails invisibly.
    expect(code).toContain('sendSMS(creator.mobile, "bulk_upload_failed"');
  });

  it("does not SMS a plain approval — only outcomes the creator must act on", () => {
    expect(code).toContain('if (params.event !== "approved")');
  });
});

describe("auth_user.full_name is gone for good", () => {
  it("no file in this module selects it", () => {
    for (const f of [
      "bulk-approval.service.ts",
      "bulk-approval.routes.ts",
      "bulk-approval-notify.service.ts",
      "bulk-approval-review.service.ts",
    ]) {
      const code = readCode(f);
      expect(code, `${f} still reads auth_user.full_name`).not.toMatch(
        /\bau\.full_name\b|FROM auth_user[^;]{0,200}\bfull_name\b/,
      );
    }
  });
});
