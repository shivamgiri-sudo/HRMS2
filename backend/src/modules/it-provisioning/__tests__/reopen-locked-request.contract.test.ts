/**
 * Audited Reopen for a locked IT-provisioning request.
 *
 * The 48h auto-lock (autoLockConfirmedRequests) is deliberate audit-evidence
 * immutability (commit d4dd2e47: "marks actioned requests confirmed+locked
 * for immutable audit"), so removing it was rejected. Instead this mirrors
 * the payroll/attendance unlock precedent (attendance-engine.routes.ts's
 * POST /:employeeId/:date/unlock): a role-gated, reason-required, durably
 * audited override that reverses the lock rather than deleting it.
 *
 * locked=1 only ever coincides with status='confirmed' (the only two
 * writers, confirmAndLockRequest and autoLockConfirmedRequests, flip that
 * pair together), so reopenLockedRequest() reverses it back to
 * status='actioned', locked=0 — at which point POST /tasks/:id/complete
 * already handles everything else correctly (see
 * provisioning-resubmit-incomplete.test.ts): alreadyActioned becomes true
 * again, so it skips actionProvisioningRequest (which 400s on a 'confirmed'
 * row) and goes straight to the already-idempotent persistStructuredFields().
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type Rows = Record<string, unknown>[];
const state: { request?: Rows } = {};

const REQUEST_ID = "11111111-2222-3333-4444-555555555555";
const ACTOR_ID = "actor-1";

const dbExecute = vi.fn(async (sql: string, params: unknown[] = []) => {
  const s = String(sql);
  if (s.includes("SELECT * FROM it_provisioning_request WHERE id")) return [state.request ?? []];
  return [{ affectedRows: 1 }];
});
const logSensitiveAction = vi.fn(async () => {});

vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction }));

const { reopenLockedRequest } = await import("../it-provisioning.service.js");

beforeEach(() => {
  state.request = [];
  dbExecute.mockClear();
  logSensitiveAction.mockClear();
});

describe("reopenLockedRequest", () => {
  it("404s when the request does not exist", async () => {
    state.request = [];
    await expect(reopenLockedRequest(REQUEST_ID, ACTOR_ID, "a valid ten char reason")).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(logSensitiveAction).not.toHaveBeenCalled();
  });

  it("400s when the request is not locked — nothing to reopen", async () => {
    state.request = [{ id: REQUEST_ID, locked: 0, status: "actioned", task_code: "ADMIN_BIOMETRIC_ID_CARD", employee_id: "emp-1" }];
    await expect(reopenLockedRequest(REQUEST_ID, ACTOR_ID, "a valid ten char reason")).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(logSensitiveAction).not.toHaveBeenCalled();
  });

  it("reverses status and locked, and writes a durable audit entry with the reason", async () => {
    state.request = [{ id: REQUEST_ID, locked: 1, status: "confirmed", task_code: "ADMIN_BIOMETRIC_ID_CARD", employee_id: "emp-1" }];
    await reopenLockedRequest(REQUEST_ID, ACTOR_ID, "ID card printed was ticked by mistake");

    const updateCall = dbExecute.mock.calls.find(([sql]) => String(sql).includes("UPDATE it_provisioning_request"));
    expect(updateCall, "must issue the reversing UPDATE").toBeTruthy();
    expect(String(updateCall![0])).toContain("status = 'actioned'");
    expect(String(updateCall![0])).toContain("locked = 0");

    expect(logSensitiveAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actor_user_id: ACTOR_ID,
        action_type: "it_provisioning_reopened",
        entity_id: REQUEST_ID,
        employee_id: "emp-1",
        reason: "ID card printed was ticked by mistake",
      }),
    );
  });

  it("does not touch evidence_note — the original completion evidence stays intact", async () => {
    state.request = [{ id: REQUEST_ID, locked: 1, status: "confirmed", task_code: "ADMIN_BIOMETRIC_ID_CARD", employee_id: "emp-1", evidence_note: "original evidence" }];
    await reopenLockedRequest(REQUEST_ID, ACTOR_ID, "a valid ten char reason");
    const updateCall = dbExecute.mock.calls.find(([sql]) => String(sql).includes("UPDATE it_provisioning_request"));
    expect(String(updateCall![0])).not.toContain("evidence_note");
  });
});

// ── Route-level checks (source-inspection, matching this module's existing
// style — see provisioning-resubmit-incomplete.test.ts) ─────────────────────

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const ROUTES = "src/modules/it-provisioning/it-provisioning.routes.ts";

function reopenHandler(src: string): string {
  const start = src.indexOf("router.post('/tasks/:id/reopen'");
  if (start === -1) return "";
  const next = src.indexOf("\nrouter.", start + 1);
  return src.slice(start, next === -1 ? src.length : next);
}

describe("POST /tasks/:id/reopen route", () => {
  const src = read(ROUTES);
  const handler = reopenHandler(src);

  it("exists and is gated to the full provisioning role set (admin, IT, WFM, HR, branch_admin)", () => {
    expect(handler, "the reopen route must exist").toBeTruthy();
    const start = src.indexOf("router.post('/tasks/:id/reopen'");
    const line = src.slice(start, src.indexOf("\n", start));
    expect(line).toContain("requireRole(...PROVISIONING_ROLES)");
  });

  it("requires a reason of at least 10 characters before calling reopenLockedRequest", () => {
    const reasonCheckAt = handler.indexOf("reason.length < 10");
    const callAt = handler.indexOf("reopenLockedRequest(");
    expect(reasonCheckAt, "must validate reason length").toBeGreaterThan(-1);
    expect(callAt, "must call reopenLockedRequest").toBeGreaterThan(-1);
    expect(reasonCheckAt, "the length check must run before reopenLockedRequest is called").toBeLessThan(callAt);
    expect(handler).toContain("res.status(400)");
  });
});
