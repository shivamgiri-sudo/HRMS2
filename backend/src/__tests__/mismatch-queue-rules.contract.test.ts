import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * WFM mismatch queue rules + reporting-manager escalation (mismatch-review.routes.ts,
 * mismatch-escalation.service.ts).
 *
 * The queue must show only genuine two-source disagreements (APR vs biometric, both with data)
 * and week-off-worked days with data — never plain absent / missing-punch rows, never rows payroll
 * has frozen, and never a month whose company-wide payroll run is finalized.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../db/mysql.js", () => ({ db: { execute, query: execute, getConnection: vi.fn() } }));

vi.mock("../shared/auditLog.js", () => ({ logSensitiveAction: vi.fn(async () => undefined) }));
vi.mock("../shared/enterpriseScope.js", () => ({
  resolveUserBusinessScope: vi.fn(async () => ({ roles: ["wfm"] })),
  buildEmployeeScopeCondition: vi.fn(() => ({ sql: "1=1", params: [] as unknown[] })),
}));

const { createItem, resolveItems } = vi.hoisted(() => ({
  createItem: vi.fn(async () => undefined),
  resolveItems: vi.fn(async () => 0),
}));
vi.mock("../modules/inbox/inbox.service.js", () => ({ inboxService: { createItem, resolveItems } }));

let actor: { id: string; role: string; roles: string[] };
vi.mock("../middleware/authMiddleware.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../middleware/authMiddleware.js")>();
  return { ...original, requireAuth: (req: any, _res: any, next: any) => { req.authUser = actor; next(); } };
});

import { mismatchReviewRouter } from "../modules/wfm/mismatch-review.routes.js";

function appFor(role: string, id = `u-${role}`) {
  actor = { id, role, roles: [role] };
  const app = express();
  app.use(express.json());
  app.use("/api/wfm/mismatches", mismatchReviewRouter);
  return app;
}

type Stub = {
  closedMonths?: string[];
  record?: Record<string, unknown> | null;
  priorEscalation?: Record<string, unknown> | null;
  escalationTableMissing?: boolean;
  manager?: Record<string, unknown> | null;
  pendingForMe?: Record<string, unknown> | null;
};

function stubDb(opts: Stub = {}) {
  execute.mockReset();
  execute.mockImplementation(async (sql: string) => {
    if (/FROM salary_prep_run/.test(sql)) {
      return [(opts.closedMonths ?? []).map((run_month) => ({ run_month })), []];
    }
    if (/attendance_mismatch_escalation/.test(sql) && opts.escalationTableMissing) {
      throw Object.assign(new Error("no such table"), { code: "ER_NO_SUCH_TABLE", errno: 1146 });
    }
    if (/SELECT id, level, status, escalated_to_employee_id/.test(sql)) {
      return [opts.priorEscalation ? [opts.priorEscalation] : [], []];
    }
    if (/SELECT id, escalated_by_user_id FROM attendance_mismatch_escalation/.test(sql)) {
      return [opts.pendingForMe ? [opts.pendingForMe] : [], []];
    }
    if (/JOIN employees m ON m\.id = COALESCE/.test(sql)) {
      return [opts.manager ? [opts.manager] : [], []];
    }
    if (/adr\.mismatch_resolved_at, *\n?\s*DATE_FORMAT|SELECT adr\.id, adr\.employee_id, adr\.is_locked/.test(sql)) {
      return [opts.record ? [opts.record] : [], []];
    }
    if (/COUNT\(\*\) AS total/.test(sql)) return [[{ total: 0 }], []];
    return [[], []];
  });
}

const openRecord = {
  id: "adr-1", employee_id: "emp-1", is_locked: 0, mismatch_resolved_at: null,
  record_date: "2026-09-10", employee_code: "E100", employee_name: "Asha Rao",
};

beforeEach(() => {
  createItem.mockClear();
  resolveItems.mockClear();
  stubDb();
});

describe("queue definition", () => {
  it("closes finalized company-wide payroll months and honours payroll-frozen rows", async () => {
    stubDb({ closedMonths: ["2026-08"] });
    const res = await request(appFor("wfm")).get("/api/wfm/mismatches");
    expect(res.status).toBe(200);
    const listCall = execute.mock.calls.find(([sql]) => /COUNT\(\*\) AS total/.test(sql))!;
    expect(listCall[0]).toMatch(/adr\.is_locked = 0/);
    expect(listCall[0]).toMatch(/adr\.mismatch_resolved_at IS NULL/);
    // August's bounds, with the real last day (not a fixed -31).
    expect(listCall[1]).toEqual(expect.arrayContaining(["2026-08-01", "2026-08-31"]));
  });

  it("only compares sources that both have data, and drops the missing_punch arm", async () => {
    const res = await request(appFor("wfm")).get("/api/wfm/mismatches");
    expect(res.status).toBe(200);
    const sql = execute.mock.calls.find(([s]) => /COUNT\(\*\) AS total/.test(s))![0] as string;
    expect(sql).toMatch(/adr\.biometric_status IS NOT NULL/);
    expect(sql).toMatch(/adr\.apr_status IS NOT NULL/);
    expect(sql).toMatch(/adr\.biometric_status <> adr\.apr_status/);
    expect(sql).toMatch(/week_off_worked' AND COALESCE\(adr\.raw_minutes, 0\) > 0/);
    expect(sql).not.toMatch(/missing_punch/);
  });
});

describe("POST /:id/escalate", () => {
  it("is refused for read-only roles", async () => {
    const res = await request(appFor("branch_head")).post("/api/wfm/mismatches/adr-1/escalate").send({});
    expect(res.status).toBe(403);
  });

  it("404s a record outside the caller's scope / not found", async () => {
    stubDb({ record: null });
    const res = await request(appFor("wfm")).post("/api/wfm/mismatches/adr-1/escalate").send({});
    expect(res.status).toBe(404);
  });

  it("409s an already-resolved record", async () => {
    stubDb({ record: { ...openRecord, mismatch_resolved_at: "2026-09-11 10:00:00" } });
    const res = await request(appFor("wfm")).post("/api/wfm/mismatches/adr-1/escalate").send({});
    expect(res.status).toBe(409);
  });

  it("answers 503 (not 500) while the escalation table is not yet applied", async () => {
    stubDb({ record: openRecord, escalationTableMissing: true });
    const res = await request(appFor("wfm")).post("/api/wfm/mismatches/adr-1/escalate").send({});
    expect(res.status).toBe(503);
    expect(res.body.message).toMatch(/1832/);
  });

  it("422s when the employee has no reporting manager with a login", async () => {
    stubDb({ record: openRecord, manager: null });
    const res = await request(appFor("wfm")).post("/api/wfm/mismatches/adr-1/escalate").send({});
    expect(res.status).toBe(422);
  });

  it("creates the escalation and notifies the manager", async () => {
    stubDb({ record: openRecord, manager: { id: "mgr-1", user_id: "u-mgr", name: "Ravi Kumar" } });
    const res = await request(appFor("wfm")).post("/api/wfm/mismatches/adr-1/escalate").send({ note: "please check" });
    expect(res.status).toBe(201);
    expect(res.body.data.level).toBe(1);
    expect(createItem).toHaveBeenCalledWith(expect.objectContaining({
      user_id: "u-mgr",
      entity_id: "adr-1",
      action_url: expect.stringContaining("/wfm/attendance-integrity?tab=mismatches"),
    }));
  });

  it("refuses a second escalation while the first is still inside its response window", async () => {
    stubDb({
      record: openRecord,
      priorEscalation: { id: "x1", level: 1, status: "pending", escalated_to_employee_id: "mgr-1", overdue: 0 },
    });
    const res = await request(appFor("wfm")).post("/api/wfm/mismatches/adr-1/escalate").send({});
    expect(res.status).toBe(409);
  });

  it("pushes an overdue escalation up one level, and stops at skip-level", async () => {
    stubDb({
      record: openRecord,
      priorEscalation: { id: "x1", level: 1, status: "pending", escalated_to_employee_id: "mgr-1", overdue: 1 },
      manager: { id: "mgr-2", user_id: "u-mgr2", name: "Skip Level" },
    });
    const up = await request(appFor("wfm")).post("/api/wfm/mismatches/adr-1/escalate").send({});
    expect(up.status).toBe(201);
    expect(up.body.data.level).toBe(2);

    stubDb({
      record: openRecord,
      priorEscalation: { id: "x2", level: 2, status: "pending", escalated_to_employee_id: "mgr-2", overdue: 1 },
    });
    const top = await request(appFor("wfm")).post("/api/wfm/mismatches/adr-1/escalate").send({});
    expect(top.status).toBe(409);
  });
});

describe("POST /:id/manager-response", () => {
  it("requires a recommended status and a note", async () => {
    const res = await request(appFor("manager")).post("/api/wfm/mismatches/adr-1/manager-response").send({});
    expect(res.status).toBe(400);
  });

  it("refuses anyone the escalation was not assigned to", async () => {
    stubDb({ record: openRecord, pendingForMe: null });
    const res = await request(appFor("manager", "u-someone-else"))
      .post("/api/wfm/mismatches/adr-1/manager-response")
      .send({ recommended_status: "present", note: "I saw them in" });
    expect(res.status).toBe(403);
  });

  it("records the recommendation for the assigned manager and closes their inbox item", async () => {
    stubDb({ record: openRecord, pendingForMe: { id: "x1", escalated_by_user_id: "u-wfm" } });
    const res = await request(appFor("manager", "u-mgr"))
      .post("/api/wfm/mismatches/adr-1/manager-response")
      .send({ recommended_status: "present", note: "I saw them in" });
    expect(res.status).toBe(200);
    expect(resolveItems).toHaveBeenCalledWith(expect.objectContaining({ entity_id: "adr-1", user_id: "u-mgr" }));
    expect(createItem).toHaveBeenCalledWith(expect.objectContaining({ user_id: "u-wfm" }));
  });

  it("rejects a status outside the allowed set", async () => {
    stubDb({ record: openRecord, pendingForMe: { id: "x1", escalated_by_user_id: "u-wfm" } });
    const res = await request(appFor("manager", "u-mgr"))
      .post("/api/wfm/mismatches/adr-1/manager-response")
      .send({ recommended_status: "bogus", note: "x" });
    expect(res.status).toBe(400);
  });
});
