import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Owner ruling 2026-08-16 (decision 5): mandatory Finance sign-off before LOCK or DISBURSE,
 * with an audited break-glass, and a preparer who cannot approve their own run.
 *
 * WHAT IT REPLACES
 * Preparing, calculating, approving, locking and disbursing were one effective permission -
 * POST /runs, POST /runs/:id/calculate and PATCH /runs/:id/status all carried the identical
 * requireRole("admin","super_admin","finance","payroll") - so one person could take a run from
 * creation to disbursed unaccompanied. Sign-off was a parallel track this endpoint never read:
 * verified live, 0 of 66 runs have ever been finance-approved, yet 12 reached 'approved'. The
 * sign-off queue filters on status='processing', so those 12 left the queue permanently with
 * nobody having signed them.
 *
 * DELIBERATELY NOT APPLIED TO 'approved'. Payroll approval is the checker step; requiring
 * sign-off before it would make approval impossible for every run. The gate sits where money
 * can actually leave.
 */

const { mockExecute } = vi.hoisted(() => ({ mockExecute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: mockExecute } }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction: vi.fn(async () => undefined) }));

const { payrollService } = await import("../payroll.service.js");

const PREPARER = "user-preparer";
const APPROVER = "user-approver";
const OUTSIDER = "user-finance";

const run = (over: Record<string, unknown> = {}) => ({
  id: "run-1",
  run_month: "2026-08",
  status: "approved",
  created_by: PREPARER,
  approved_by: APPROVER,
  finance_approved_by: null,
  finance_approved_at: null,
  ...over,
});

/** getRun -> SELECT *, then the guarded UPDATE, then a re-read. */
function stub(row: Record<string, unknown>, updateAffected = 1) {
  mockExecute.mockReset();
  mockExecute.mockImplementation(async (sql: unknown) => {
    const s = String(sql ?? "");
    if (/^\s*SELECT \* FROM salary_prep_run/i.test(s)) return [[row], []];
    if (/^\s*UPDATE salary_prep_run SET status/i.test(s)) return [{ affectedRows: updateAffected }, []];
    return [[], []];
  });
}

beforeEach(() => mockExecute.mockReset());

describe("Finance sign-off gates the two states that move money", () => {
  it("refuses LOCK when the run has no sign-off", async () => {
    stub(run({ status: "approved" }));
    await expect(
      payrollService.updateRunStatus("run-1", { status: "locked" } as never, OUTSIDER),
    ).rejects.toMatchObject({ statusCode: 409, code: "PAYROLL_FINANCE_SIGNOFF_REQUIRED" });
  });

  it("refuses DISBURSE when the run has no sign-off", async () => {
    stub(run({ status: "locked" }));
    await expect(
      payrollService.updateRunStatus("run-1", { status: "disbursed" } as never, OUTSIDER),
    ).rejects.toMatchObject({ code: "PAYROLL_FINANCE_SIGNOFF_REQUIRED" });
  });

  it("allows LOCK once Finance has signed off", async () => {
    stub(run({ status: "approved", finance_approved_at: "2026-08-16 10:00:00", finance_approved_by: OUTSIDER }));
    await expect(
      payrollService.updateRunStatus("run-1", { status: "locked" } as never, OUTSIDER),
    ).resolves.toBeDefined();
  });

  it("does NOT gate 'approved' — that is the checker step, not a payment", async () => {
    // Gating approval on sign-off would make every run unapprovable, since sign-off is
    // requested after approval in this workflow.
    stub(run({ status: "processing", approved_by: null }));
    await expect(
      payrollService.updateRunStatus("run-1", { status: "approved" } as never, APPROVER),
    ).resolves.toBeDefined();
  });
});

describe("the preparer cannot approve their own run", () => {
  it("refuses when the approver is the person who created it", async () => {
    stub(run({ status: "processing", approved_by: null }));
    await expect(
      payrollService.updateRunStatus("run-1", { status: "approved" } as never, PREPARER),
    ).rejects.toMatchObject({ statusCode: 403, code: "PAYROLL_SELF_APPROVAL" });
  });

  it("allows a different approver", async () => {
    stub(run({ status: "processing", approved_by: null }));
    await expect(
      payrollService.updateRunStatus("run-1", { status: "approved" } as never, APPROVER),
    ).resolves.toBeDefined();
  });

  it("does not block a legacy run whose created_by is NULL", async () => {
    stub(run({ status: "processing", created_by: null, approved_by: null }));
    await expect(
      payrollService.updateRunStatus("run-1", { status: "approved" } as never, PREPARER),
    ).resolves.toBeDefined();
  });
});

describe("break-glass is a third pair of hands, not a way round your own control", () => {
  it("lets an independent actor lock without sign-off, given a reason", async () => {
    stub(run({ status: "approved" }));
    await expect(
      payrollService.updateRunStatus(
        "run-1",
        { status: "locked", breakGlassReason: "Bank cut-off in 20 minutes; CFO approved verbally on call" } as never,
        OUTSIDER,
      ),
    ).resolves.toBeDefined();
  });

  it("refuses break-glass by the preparer", async () => {
    stub(run({ status: "approved" }));
    await expect(
      payrollService.updateRunStatus(
        "run-1",
        { status: "locked", breakGlassReason: "Bank cut-off in 20 minutes; CFO approved verbally on call" } as never,
        PREPARER,
      ),
    ).rejects.toMatchObject({ statusCode: 403, code: "PAYROLL_BREAKGLASS_NOT_INDEPENDENT" });
  });

  it("refuses break-glass by the approver", async () => {
    stub(run({ status: "approved" }));
    await expect(
      payrollService.updateRunStatus(
        "run-1",
        { status: "locked", breakGlassReason: "Bank cut-off in 20 minutes; CFO approved verbally on call" } as never,
        APPROVER,
      ),
    ).rejects.toMatchObject({ code: "PAYROLL_BREAKGLASS_NOT_INDEPENDENT" });
  });
});

describe("two actors cannot both win the same transition", () => {
  it("refuses with 409 when the row moved between the read and the write", async () => {
    stub(run({ status: "approved", finance_approved_at: "2026-08-16 10:00:00" }), 0);
    await expect(
      payrollService.updateRunStatus("run-1", { status: "locked" } as never, OUTSIDER),
    ).rejects.toMatchObject({ statusCode: 409, code: "PAYROLL_RUN_STATE_CHANGED" });
  });

  it("carries the observed status in the WHERE clause", async () => {
    stub(run({ status: "approved", finance_approved_at: "2026-08-16 10:00:00" }));
    await payrollService.updateRunStatus("run-1", { status: "locked" } as never, OUTSIDER);
    const update = mockExecute.mock.calls.find(([s]) => /UPDATE salary_prep_run SET status/i.test(String(s)));
    expect(String(update![0])).toMatch(/WHERE id = \? AND status = \?/);
  });
});
