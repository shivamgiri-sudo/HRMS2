/**
 * DPDP withdrawal audit events that had code paths but wrote nothing.
 *
 * docs/dpdp/DPDP_EXISTING_STATE_AUDIT.md §7 lists 18 required audit events the withdrawal
 * workflow never emitted. Four of them were already covered by the time of this pass
 * (HOLD_APPLIED, DATA_RESTRICTED, HOLD_RELEASED, CLOSED). Four more had a real, already-
 * implemented code path that simply logged nothing, and those are what this file locks in:
 *
 *   DPDP_WITHDRAWAL_VIEWED                  — HR/DPO opening someone's withdrawal record
 *   DPDP_WITHDRAWAL_AUDIT_VIEWED            — HR/DPO opening its audit trail
 *   DPDP_WITHDRAWAL_MODULE_ACTION_COMPLETED — completeTask(), the one implemented workflow
 *                                             action in the service that wrote no entry, so
 *                                             a withdrawal could reach closed with no record
 *                                             of the work done in between
 *   DPDP_PROCESSING_HOLD_ENFORCED           — dpdpRestrictionGuard actually blocking a read.
 *                                             HOLD_APPLIED is written once when review
 *                                             starts; without this, the trail showed a
 *                                             restriction existed but never that it stopped
 *                                             anyone, which is the only evidence it worked.
 *
 * The remaining ten (ACKNOWLEDGED, ASSIGNED, INFORMATION_REQUESTED/PROVIDED,
 * PARTIALLY_APPROVED, IMPLEMENTATION_STARTED, DATA_ANONYMIZED, DATA_DELETED,
 * THIRD_PARTY_NOTICE_SENT, EXPORTED) have no code path to attach to — they need the workflow
 * states and columns §7 itself lists as missing, which is a schema and product change rather
 * than a missing log line. They are deliberately not faked here.
 *
 * Two behaviours are asserted as much as the emissions themselves, because both were
 * deliberate design choices that a later refactor could quietly undo:
 *   - a data principal reading their OWN request is not logged (the DPDP interest is who
 *     else looked), and
 *   - the audit-log endpoint does not also record a phantom VIEWED for its access check.
 */
import type { Request, Response, NextFunction } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const WITHDRAWAL_ID = "11111111-1111-1111-1111-111111111111";
const TASK_ID = "22222222-2222-2222-2222-222222222222";
const HR_USER = "33333333-3333-3333-3333-333333333333";
const OWNER_USER = "44444444-4444-4444-4444-444444444444";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

const svc = await import("../dpdp-withdrawal.service.js");
const { checkDpdpRestriction } = await import("../dpdpRestrictionGuard.js");

/** The audit writes are fire-and-forget; let their microtasks run before asserting. */
const flush = () => new Promise((r) => setImmediate(r));

/** Every action string handed to the audit INSERT. */
function loggedActions(): string[] {
  return execute.mock.calls
    .filter((c) => String(c[0]).includes("INSERT INTO dpdp_withdrawal_audit_log"))
    .map((c) => String((c[1] as unknown[])[1]));
}

beforeEach(() => execute.mockReset());

describe("DPDP withdrawal — audit events on already-implemented paths", () => {
  it("records VIEWED when HR opens a withdrawal record", async () => {
    execute
      .mockResolvedValueOnce([[{ id: WITHDRAWAL_ID, requester_id: OWNER_USER }]]) // SELECT record
      .mockResolvedValue([{}]);                                                    // audit INSERT

    await svc.getById(WITHDRAWAL_ID, HR_USER, true, true);
    await flush();

    expect(loggedActions()).toContain("DPDP_WITHDRAWAL_VIEWED");
  });

  it("does NOT log a view when the data principal reads their own request", async () => {
    execute
      .mockResolvedValueOnce([[{ id: WITHDRAWAL_ID, requester_id: OWNER_USER }]])
      .mockResolvedValue([{}]);

    await svc.getById(WITHDRAWAL_ID, OWNER_USER, false, true);
    await flush();

    expect(loggedActions()).not.toContain("DPDP_WITHDRAWAL_VIEWED");
  });

  it("does NOT log a view for the audit endpoint's own access check", async () => {
    // The audit route calls getById without opting in, purely to authorise the caller.
    execute
      .mockResolvedValueOnce([[{ id: WITHDRAWAL_ID, requester_id: OWNER_USER }]])
      .mockResolvedValue([{}]);

    await svc.getById(WITHDRAWAL_ID, HR_USER, true /* isHr */);
    await flush();

    expect(loggedActions()).not.toContain("DPDP_WITHDRAWAL_VIEWED");
  });

  it("records AUDIT_VIEWED when the audit trail is opened", async () => {
    execute
      .mockResolvedValueOnce([[]])   // SELECT audit rows
      .mockResolvedValue([{}]);      // audit INSERT

    await svc.getAudit(WITHDRAWAL_ID, HR_USER);
    await flush();

    expect(loggedActions()).toContain("DPDP_WITHDRAWAL_AUDIT_VIEWED");
  });

  it("records MODULE_ACTION_COMPLETED when a withdrawal task is completed", async () => {
    execute
      .mockResolvedValueOnce([{}])                                                   // UPDATE task
      .mockResolvedValueOnce([[{ withdrawal_id: WITHDRAWAL_ID, module_key: "payroll" }]]) // SELECT back
      .mockResolvedValue([{}]);                                                      // audit INSERT

    await svc.completeTask(TASK_ID, HR_USER, "done");
    await flush();

    const insert = execute.mock.calls.find((c) =>
      String(c[0]).includes("INSERT INTO dpdp_withdrawal_audit_log"));
    expect(insert).toBeTruthy();
    const params = insert![1] as unknown[];
    expect(params[1]).toBe("DPDP_WITHDRAWAL_MODULE_ACTION_COMPLETED");
    expect(params[0]).toBe(WITHDRAWAL_ID); // logged against the withdrawal, not the task
  });

  it("records HOLD_ENFORCED when the restriction guard actually blocks a read", async () => {
    execute
      .mockResolvedValueOnce([[{ id: WITHDRAWAL_ID }]]) // active restriction found
      .mockResolvedValue([{}]);                        // audit INSERT

    const req = {
      params: { employeeId: OWNER_USER },
      query: {},
      method: "GET",
      path: "/api/employees/x",
      originalUrl: "/api/employees/x",
      authUser: { id: HR_USER },
    } as unknown as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as Response;
    const next = vi.fn() as unknown as NextFunction;

    await checkDpdpRestriction(req, res, next);
    await flush();

    expect(res.status).toHaveBeenCalledWith(403); // still fails closed
    expect(next).not.toHaveBeenCalled();
    expect(loggedActions()).toContain("DPDP_PROCESSING_HOLD_ENFORCED");
  });

  it("still returns 403 even if the audit write fails — the guard must fail closed", async () => {
    execute
      .mockResolvedValueOnce([[{ id: WITHDRAWAL_ID }]])            // restriction found
      .mockRejectedValueOnce(new Error("audit table unavailable")) // the audit write only
      .mockResolvedValue([{}]);

    const req = {
      params: { employeeId: OWNER_USER }, query: {}, method: "GET",
      path: "/x", originalUrl: "/x", authUser: { id: HR_USER },
    } as unknown as Request;
    const res = {
      status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(),
    } as unknown as Response;
    const next = vi.fn() as unknown as NextFunction;

    await checkDpdpRestriction(req, res, next);
    await flush();

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
