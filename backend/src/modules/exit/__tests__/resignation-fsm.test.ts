import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * resignation.routes.ts's /:exitId/withdraw, /mark-clearance-pending,
 * /mark-fnf-pending and /close each wrote exit_request.status via a raw
 * UPDATE with NO precondition on the current status at all — an exit still
 * in 'draft' could be closed directly, an already-'exited' one could be
 * "withdrawn". They also used a status vocabulary
 * (clearance_pending/fnf_pending/closed/withdrawn) the canonical FSM in
 * exit.secure.routes.ts didn't recognize, so no guard could ever have
 * covered them even in principle.
 * (delta-audit 2026-08-14, Stage 5g, user-approved: extend the FSM)
 *
 * Fixed by extending exit.secure.routes.ts's ALLOWED_EXIT_TRANSITIONS
 * (single source of truth) with a second terminal chain off 'accepted'
 * (clearance_pending → fnf_pending → closed) and 'withdrawn' mirroring
 * 'revoked', then having all four resignation.routes.ts handlers call the
 * exported assertValidExitTransition before writing. mark-clearance-pending
 * and mark-fnf-pending also gained the exit_approval_log write their
 * siblings /close and /withdraw already had.
 *
 * These tests use the REAL exit.secure.routes.js FSM (not mocked) so they
 * exercise genuine end-to-end transition enforcement, not just that some
 * function got called.
 */

const ACTOR_ID = "actor-1";
const EXIT_ID = "exit-1";

const { dbExecute } = vi.hoisted(() => ({ dbExecute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));

let authUser: { id: string; role: string; roles: string[] } = {
  id: ACTOR_ID,
  role: "hr",
  roles: ["hr"],
};

vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { authUser: typeof authUser }).authUser = authUser;
    next();
  },
}));

vi.mock("../exit.controller.js", () => ({ exitController: { createExitRequest: vi.fn() } }));
vi.mock("../exit.service.js", () => ({ exitService: { updateExitStatus: vi.fn(), getExitRequest: vi.fn() } }));

const { getEmployeeForUser, hasRole } = vi.hoisted(() => ({
  getEmployeeForUser: vi.fn().mockResolvedValue(null),
  hasRole: vi.fn().mockResolvedValue(true), // admin/hr/manager privileged path by default
}));
vi.mock("../../../shared/accessGuard.js", () => ({ getEmployeeForUser, hasRole }));

const { resignationRouter } = await import("../resignation.routes.js");

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api/exit/resignation", resignationRouter);
  return a;
}

function mockStatusThenUpdate(currentStatus: string) {
  dbExecute.mockImplementation((sql: string) => {
    if (String(sql).includes("SELECT status FROM exit_request")) {
      return Promise.resolve([[{ status: currentStatus }], []]);
    }
    return Promise.resolve([{ affectedRows: 1 }, []]);
  });
}

beforeEach(() => {
  dbExecute.mockReset();
  getEmployeeForUser.mockReset().mockResolvedValue(null);
  hasRole.mockReset().mockResolvedValue(true);
  authUser = { id: ACTOR_ID, role: "hr", roles: ["hr"] };
});

describe("POST /:exitId/mark-clearance-pending", () => {
  it("409s from a status the FSM does not allow (draft)", async () => {
    mockStatusThenUpdate("draft");

    const res = await request(app()).post(`/api/exit/resignation/${EXIT_ID}/mark-clearance-pending`);

    expect(res.status).toBe(409);
    expect(res.body.message).toContain("draft → clearance_pending");
    expect(dbExecute).toHaveBeenCalledTimes(1); // only the SELECT, no UPDATE, no audit log
  });

  it("succeeds from 'accepted' and writes the exit_approval_log entry it was missing", async () => {
    mockStatusThenUpdate("accepted");

    const res = await request(app()).post(`/api/exit/resignation/${EXIT_ID}/mark-clearance-pending`);

    expect(res.status).toBe(200);
    const sqls = dbExecute.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => s.includes("UPDATE exit_request SET status = 'clearance_pending'"))).toBe(true);
    expect(sqls.some((s) => s.includes("INSERT INTO exit_approval_log"))).toBe(true);
  });
});

describe("POST /:exitId/mark-fnf-pending", () => {
  it("409s when clearance_pending was skipped", async () => {
    mockStatusThenUpdate("accepted");

    const res = await request(app()).post(`/api/exit/resignation/${EXIT_ID}/mark-fnf-pending`);

    expect(res.status).toBe(409);
    expect(dbExecute).toHaveBeenCalledTimes(1);
  });

  it("succeeds from 'clearance_pending' and writes the audit log", async () => {
    mockStatusThenUpdate("clearance_pending");

    const res = await request(app()).post(`/api/exit/resignation/${EXIT_ID}/mark-fnf-pending`);

    expect(res.status).toBe(200);
    const sqls = dbExecute.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => s.includes("UPDATE exit_request SET status = 'fnf_pending'"))).toBe(true);
    expect(sqls.some((s) => s.includes("INSERT INTO exit_approval_log"))).toBe(true);
  });
});

describe("POST /:exitId/close", () => {
  it("409s when an exit still in 'draft' is closed directly (the exact gap this fix closes)", async () => {
    mockStatusThenUpdate("draft");

    const res = await request(app()).post(`/api/exit/resignation/${EXIT_ID}/close`);

    expect(res.status).toBe(409);
    expect(dbExecute).toHaveBeenCalledTimes(1);
  });

  it("succeeds from 'fnf_pending', the terminal step of the new chain", async () => {
    mockStatusThenUpdate("fnf_pending");

    const res = await request(app()).post(`/api/exit/resignation/${EXIT_ID}/close`);

    expect(res.status).toBe(200);
  });

  it("404s when the exit request does not exist, before any transition check", async () => {
    dbExecute.mockResolvedValueOnce([[], []]);

    const res = await request(app()).post(`/api/exit/resignation/${EXIT_ID}/close`);

    expect(res.status).toBe(404);
    expect(dbExecute).toHaveBeenCalledTimes(1);
  });
});

describe("POST /:exitId/withdraw", () => {
  it("409s an already-'exited' request — cannot withdraw what already concluded", async () => {
    mockStatusThenUpdate("exited");

    const res = await request(app()).post(`/api/exit/resignation/${EXIT_ID}/withdraw`);

    expect(res.status).toBe(409);
  });

  it("409s an already-'closed' request", async () => {
    mockStatusThenUpdate("closed");

    const res = await request(app()).post(`/api/exit/resignation/${EXIT_ID}/withdraw`);

    expect(res.status).toBe(409);
  });

  it("succeeds from 'submitted', mirroring 'revoked's allowed source states", async () => {
    mockStatusThenUpdate("submitted");

    const res = await request(app()).post(`/api/exit/resignation/${EXIT_ID}/withdraw`);

    expect(res.status).toBe(200);
  });
});
