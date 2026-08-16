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

/**
 * markFfPaid now runs the UPDATE and its audit row in ONE transaction on a pooled connection,
 * so the harness has to offer one. The connection's execute is the SAME mock as the pool's, so
 * the stub() routing below still matches the UPDATE wherever it is issued from.
 */
const { execute, conn } = vi.hoisted(() => {
  const execute = vi.fn();
  return {
    execute,
    conn: {
      execute,
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
      release: vi.fn(),
    },
  };
});
vi.mock("../../../db/mysql.js", () => ({
  db: { execute, getConnection: vi.fn().mockResolvedValue(conn) },
}));

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

/**
 * First SELECT returns the record; everything after is the UPDATE and the getFF re-read.
 *
 * The UPDATE must report affectedRows: the service reads it to tell a real transition from
 * one that matched no row because a concurrent actor got there first. `updateAffectedRows: 0`
 * simulates losing that race.
 */
function stub(row: Record<string, unknown> | null, opts: { updateAffectedRows?: number } = {}) {
  execute.mockReset();
  execute.mockImplementation((sql: string) => {
    if (String(sql).includes("SELECT * FROM full_final_calculation")) {
      return Promise.resolve([row ? [row] : [], []]);
    }
    if (/^\s*UPDATE full_final_calculation/i.test(String(sql))) {
      return Promise.resolve([{ affectedRows: opts.updateAffectedRows ?? 1 }, []]);
    }
    return Promise.resolve([[], []]);
  });
}

beforeEach(() => {
  execute.mockReset();
  logSensitiveAction.mockReset();
  conn.beginTransaction.mockClear();
  conn.commit.mockClear();
  conn.rollback.mockClear();
  conn.release.mockClear();
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

  /**
   * §16 — irreversible money events audit strictly.
   *
   * The audit row is written on the SAME connection inside the SAME transaction as the status
   * change, and is awaited. Previously this was `void logSensitiveAction(...)` — neither awaited
   * nor throwing — so a settlement could commit as PAID with no audit row while the caller saw
   * success. A payment with no record cannot be reconciled against a bank statement or attributed
   * to a payer, and FF_PAID_BUT_EMPLOYEE_ACTIVE reads that same trail.
   *
   * Strict is the right trade HERE and not generally: "payment not recorded" is retryable
   * (the UPDATE is guarded on status='approved', so a retry applies once or 409s), whereas
   * "paid with no audit" is not even detectable.
   */
  it("writes the audit row inside the paying transaction, and commits once", async () => {
    stub(ffRow());
    await ffService.markFfPaid(FF_ID, PAYER, "UTR123456789").catch(() => undefined);

    const auditInsert = execute.mock.calls.find(([s]) =>
      /INSERT INTO sensitive_action_log/i.test(String(s))
    );
    expect(auditInsert, "FULL_FINAL_PAID audit row was not written on the connection").toBeTruthy();
    expect(auditInsert![1]).toContain("FULL_FINAL_PAID");
    // The reference travels inside the JSON-bound change_summary, not as a bare parameter.
    expect(JSON.stringify(auditInsert![1])).toContain("UTR123456789");

    // Ordering: the audit must land before the commit, not after it.
    const updateIdx = execute.mock.calls.findIndex(([s]) => String(s).includes("SET status = 'paid'"));
    const auditIdx = execute.mock.calls.findIndex(([s]) => /INSERT INTO sensitive_action_log/i.test(String(s)));
    expect(auditIdx).toBeGreaterThan(updateIdx);
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.rollback).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledTimes(1);
  });

  it("rolls the payment back when the audit write fails — never paid-but-unrecorded", async () => {
    stub(ffRow());
    // Everything succeeds except the audit insert.
    const base = execute.getMockImplementation()!;
    execute.mockImplementation((sql: string, params?: unknown) => {
      if (/INSERT INTO sensitive_action_log/i.test(String(sql))) {
        return Promise.reject(new Error("audit sink unavailable"));
      }
      return base(sql, params);
    });

    await expect(ffService.markFfPaid(FF_ID, PAYER, "UTR999")).rejects.toThrow(/audit sink unavailable/);

    // The UPDATE was issued, but inside a transaction that was rolled back — so the settlement
    // is NOT recorded as paid, and the caller is told so rather than being given a false success.
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledTimes(1);
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

  /**
   * Same claim as before — the audit entry carries who paid, how much and against what
   * reference — but asserted against the mechanism that now writes it. This used to read
   * logSensitiveAction's call args; the entry is now written by recordMoneyEventAudit as a
   * real INSERT on the paying connection, so the assertion reads the bound parameters.
   *
   * logSensitiveAction must NOT also fire here: a second, non-transactional copy of the same
   * event would reintroduce exactly the write that could go missing.
   */
  it("writes a sensitive-action audit entry carrying the amount and reference", async () => {
    stub(ffRow());
    await ffService.markFfPaid(FF_ID, PAYER, "UTR999").catch(() => undefined);

    const insert = execute.mock.calls.find(([s]) =>
      /INSERT INTO sensitive_action_log/i.test(String(s))
    );
    expect(insert, "no FULL_FINAL_PAID audit insert was issued").toBeTruthy();
    const params = insert![1] as unknown[];
    expect(params).toContain("FULL_FINAL_PAID");
    expect(params).toContain(PAYER);

    // change_summary is bound as JSON, so read it back rather than matching the raw array.
    const summary = JSON.parse(
      params.find((p) => typeof p === "string" && p.startsWith("{")) as string
    );
    expect(summary.payment_reference).toBe("UTR999");
    expect(summary.net_payable).toBe(50000);

    expect(logSensitiveAction).not.toHaveBeenCalled();
  });

  it("404s a settlement that does not exist", async () => {
    stub(null);
    await expect(ffService.markFfPaid(FF_ID, PAYER, "UTR1")).rejects.toThrow(/not found/i);
  });
});

/**
 * 2026-08-16 — Rule 7 concurrency.
 *
 * The expected-state predicate on the UPDATE was already correct; its RESULT was never read.
 * Two payers recording the same settlement both passed the SELECT-time guards and both issued
 * the UPDATE; only the first matched a row. The second silently discarded its own payment
 * reference, then wrote a FULL_FINAL_PAID audit naming itself as payer and returned success —
 * producing an audit trail showing one settlement disbursed twice, under two references, one
 * of which was never recorded anywhere.
 */
describe("markFfPaid — a payment that did not happen is not recorded as one", () => {
  it("refuses with 409 when another payer won the race", async () => {
    stub(ffRow(), { updateAffectedRows: 0 });
    await expect(ffService.markFfPaid(FF_ID, PAYER, "UTR1")).rejects.toMatchObject({ statusCode: 409 });
  });

  it("writes NO audit entry when the transition matched no row", async () => {
    stub(ffRow(), { updateAffectedRows: 0 });
    await ffService.markFfPaid(FF_ID, PAYER, "UTR1").catch(() => undefined);
    expect(logSensitiveAction).not.toHaveBeenCalled();
  });

  it("carries a statusCode on every governance refusal, so the reason survives production", async () => {
    // Without one the error handler replaces the message and Finance sees a bare 500 —
    // a maker-checker refusal then reads as a broken screen instead of a control working.
    stub(ffRow({ approved_by: PAYER }));
    await expect(ffService.markFfPaid(FF_ID, PAYER, "UTR1")).rejects.toMatchObject({ statusCode: 403 });

    stub(ffRow({ status: "draft" }));
    await expect(ffService.markFfPaid(FF_ID, PAYER, "UTR1")).rejects.toMatchObject({ statusCode: 409 });

    stub(ffRow());
    await expect(ffService.markFfPaid(FF_ID, PAYER, "  ")).rejects.toMatchObject({ statusCode: 400 });

    stub(null);
    await expect(ffService.markFfPaid(FF_ID, PAYER, "UTR1")).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("approveFF — approval is guarded on the state it was decided on", () => {
  it("carries the observed status in the WHERE, so a paid settlement cannot be reverted", async () => {
    // Was `WHERE id = ?` with no predicate: if another actor marked the settlement paid
    // between the SELECT and this UPDATE, this statement wrote it back to 'approved' while
    // ff_paid_by / ff_payment_reference stayed populated — leaving a disbursed settlement
    // sitting in 'approved', eligible to be paid a second time.
    stub(ffRow({ status: "verified" }));
    await ffService.approveFF(FF_ID, APPROVER).catch(() => undefined);

    const update = execute.mock.calls.find(([s]) => String(s).includes("SET status = 'approved'"));
    expect(update, "no approval UPDATE was issued").toBeTruthy();
    expect(String(update![0])).toContain("AND status = ?");
    expect(update![1]).toContain("verified");
  });

  it("refuses with 409, and writes no audit, when the row moved first", async () => {
    stub(ffRow({ status: "verified" }), { updateAffectedRows: 0 });
    await expect(ffService.approveFF(FF_ID, APPROVER)).rejects.toMatchObject({ statusCode: 409 });
    expect(logSensitiveAction).not.toHaveBeenCalled();
  });

  it("still refuses to re-approve a paid settlement", async () => {
    // Rule 8 governance — unchanged, and must stay that way.
    stub(ffRow({ status: "paid" }));
    await expect(ffService.approveFF(FF_ID, APPROVER)).rejects.toThrow(/already paid/i);
  });

  it("still refuses a provisional calculation", async () => {
    stub(ffRow({ is_ff_provisional: 1 }));
    await expect(ffService.approveFF(FF_ID, APPROVER)).rejects.toThrow(/provisional/i);
  });
});
