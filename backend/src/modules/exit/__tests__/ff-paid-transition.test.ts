import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * full_final_calculation.status is enum('draft','verified','approved','paid'), but 'paid' was
 * unreachable AND unrecordable: ff.service.ts's only status write was `SET status = 'approved'`,
 * and the table had no paid_by / paid_at / payment-reference columns at all. Verified live
 * 2026-08-15 — nothing has ever been 'paid'.
 *
 * Two controls were silently inert because of it:
 *   - FF_PAID_BUT_EMPLOYEE_ACTIVE, labelled P0, queries status='paid' and so could never fail.
 *   - The "already paid, cannot re-approve" guards in approveFF and
 *     ff-approval-guard.compat.routes.ts guarded a state nothing could produce.
 *
 * markFfPaid (with migration 1220's columns) closes that. These cases pin the three policy
 * choices it encodes, so changing any of them is a deliberate act with a failing test, not a
 * quiet edit.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

const { logSensitiveAction } = vi.hoisted(() => ({ logSensitiveAction: vi.fn() }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction }));
vi.mock("../exit.notifications.js", () => ({
  notifyFullFinalReady: vi.fn(),
  notifyResignationSubmitted: vi.fn(),
  notifyResignationDecision: vi.fn(),
}));
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail: vi.fn() }) } }));

const { ffService } = await import("../ff.service.js");

const FF_ID = "ff-1";
const APPROVER = "user-approver";
const PAYER = "user-payer";

function ffRow(over: Record<string, unknown> = {}) {
  return {
    id: FF_ID,
    exit_request_id: "exit-1",
    employee_id: "emp-1",
    status: "approved",
    approved_by: APPROVER,
    net_payable: 50000,
    is_ff_provisional: 0,
    ...over,
  };
}

/** First SELECT returns the record; everything after is the UPDATE and the getFF re-read. */
function stub(row: Record<string, unknown> | null) {
  execute.mockReset();
  execute.mockImplementation((sql: string) => {
    if (String(sql).includes("SELECT * FROM full_final_calculation")) {
      return Promise.resolve([row ? [row] : [], []]);
    }
    return Promise.resolve([[], []]);
  });
}

beforeEach(() => {
  execute.mockReset();
  logSensitiveAction.mockReset();
});

describe("markFfPaid — the transition that did not exist", () => {
  it("marks an approved settlement paid, recording who, when and the reference", async () => {
    stub(ffRow());
    await ffService.markFfPaid(FF_ID, PAYER, "UTR123456789").catch(() => undefined);

    const update = execute.mock.calls.find(([s]) => String(s).includes("SET status = 'paid'"));
    expect(update, "no UPDATE to status='paid' was issued").toBeTruthy();
    expect(update![1]).toContain(PAYER);
    expect(update![1]).toContain("UTR123456789");
    // Guarded on the expected prior state, so a concurrent change cannot be overwritten.
    expect(String(update![0])).toContain("AND status = 'approved'");
  });

  it("refuses a settlement that is not approved yet", async () => {
    stub(ffRow({ status: "draft" }));
    await expect(ffService.markFfPaid(FF_ID, PAYER, "UTR1")).rejects.toThrow(/not 'approved'/);
    expect(execute.mock.calls.some(([s]) => String(s).includes("SET status = 'paid'"))).toBe(false);
  });

  it("refuses to pay the same settlement twice", async () => {
    stub(ffRow({ status: "paid" }));
    await expect(ffService.markFfPaid(FF_ID, PAYER, "UTR1")).rejects.toThrow(/already marked paid/);
  });

  it("requires a payment reference — 'paid' without evidence is an assertion, not a record", async () => {
    stub(ffRow());
    await expect(ffService.markFfPaid(FF_ID, PAYER, "   ")).rejects.toThrow(/payment reference/i);
    expect(execute.mock.calls.some(([s]) => String(s).includes("SET status = 'paid'"))).toBe(false);
  });

  it("refuses to let the approver also record the payment (maker-checker)", async () => {
    // Same guard as cost-centre approveL1/L2: approval and disbursement are two controls, and
    // one person holding both collapses them into one.
    stub(ffRow({ approved_by: PAYER }));
    await expect(ffService.markFfPaid(FF_ID, PAYER, "UTR1")).rejects.toThrow(/other than the person who approved/);
  });

  it("does not block a legacy row whose approved_by is NULL", async () => {
    stub(ffRow({ approved_by: null }));
    await ffService.markFfPaid(FF_ID, PAYER, "UTR1").catch(() => undefined);
    expect(execute.mock.calls.some(([s]) => String(s).includes("SET status = 'paid'"))).toBe(true);
  });

  it("writes a sensitive-action audit entry carrying the amount and reference", async () => {
    stub(ffRow());
    await ffService.markFfPaid(FF_ID, PAYER, "UTR999").catch(() => undefined);

    expect(logSensitiveAction).toHaveBeenCalledTimes(1);
    const entry = logSensitiveAction.mock.calls[0][0];
    expect(entry.action_type).toBe("FULL_FINAL_PAID");
    expect(entry.actor_user_id).toBe(PAYER);
    expect(entry.change_summary.payment_reference).toBe("UTR999");
    expect(entry.change_summary.net_payable).toBe(50000);
  });

  it("404s a settlement that does not exist", async () => {
    stub(null);
    await expect(ffService.markFfPaid(FF_ID, PAYER, "UTR1")).rejects.toThrow(/not found/i);
  });
});
