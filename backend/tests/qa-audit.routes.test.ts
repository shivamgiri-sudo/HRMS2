import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const execute = vi.fn();
const submitQaAudit = vi.fn();
const listAuditsForEmployee = vi.fn();
const getUserRoleContext = vi.fn();
const resolveDashboardScope = vi.fn();

let currentUser = { id: "user-1" };

vi.mock("../src/db/mysql.js", () => ({ db: { execute: (...a: unknown[]) => execute(...a) } }));
vi.mock("../src/middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => { req.authUser = currentUser; next(); },
}));
vi.mock("../src/middleware/requireRole.js", () => ({
  requireRole: (...roles: string[]) => (req: any, res: any, next: () => void) =>
    roles.includes(req.__role) ? next() : res.status(403).json({ message: "forbidden" }),
}));
vi.mock("../src/shared/roleResolver.js", () => ({
  getUserRoleContext: (...a: unknown[]) => getUserRoleContext(...a),
}));
vi.mock("../src/shared/dashboardScope.js", () => ({
  resolveDashboardScope: (...a: unknown[]) => resolveDashboardScope(...a),
  buildScopeWhereEmployees: () => ({ sql: "1=1", params: [] }),
}));
vi.mock("../src/modules/quality-dashboard/qa-audit.service.js", () => ({
  submitQaAudit: (...a: unknown[]) => submitQaAudit(...a),
  listAuditsForEmployee: (...a: unknown[]) => listAuditsForEmployee(...a),
  QaAuditError: class extends Error { constructor(m: string, public statusCode = 400) { super(m); } },
}));

const { qaAuditRouter } = await import("../src/modules/quality-dashboard/qa-audit.routes.js");

/**
 * A quality score is personal, and "employee" is the largest role in the system
 * at 1,357 users. These pin that an agent reads their own audits and nobody
 * else's, and that a privileged reader still cannot step outside their scope by
 * changing an id in the URL.
 */

function appAs(role: string) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.__role = role; next(); });
  app.use("/api/qa", qaAuditRouter);
  return app;
}

beforeEach(() => {
  execute.mockReset(); submitQaAudit.mockReset(); listAuditsForEmployee.mockReset();
  getUserRoleContext.mockReset(); resolveDashboardScope.mockReset();
  currentUser = { id: "user-1" };
  listAuditsForEmployee.mockResolvedValue([]);
  resolveDashboardScope.mockResolvedValue({ level: "ORG_ALL" });
});

describe("an agent may read only their own audits", () => {
  it("returns their own record without needing to pass an id", async () => {
    getUserRoleContext.mockResolvedValue({ primaryRole: "employee" });
    execute.mockResolvedValueOnce([[{ id: "emp-self" }], []]);

    const res = await request(appAs("employee")).get("/api/qa/audits?from=2026-07-01&to=2026-07-31");

    expect(res.status).toBe(200);
    expect(listAuditsForEmployee).toHaveBeenCalledWith("emp-self", "2026-07-01", "2026-07-31");
  });

  it("refuses plainly when they ask for somebody else", async () => {
    // Silently swapping the id would be worse: a caller who asked for another
    // person should know they were refused.
    getUserRoleContext.mockResolvedValue({ primaryRole: "employee" });
    execute.mockResolvedValueOnce([[{ id: "emp-self" }], []]);

    const res = await request(appAs("employee"))
      .get("/api/qa/audits?from=2026-07-01&to=2026-07-31&employeeId=emp-other");

    expect(res.status).toBe(403);
    expect(listAuditsForEmployee).not.toHaveBeenCalled();
  });

  it("says so when the login is not linked to an employee", async () => {
    getUserRoleContext.mockResolvedValue({ primaryRole: "employee" });
    execute.mockResolvedValueOnce([[], []]);

    const res = await request(appAs("employee")).get("/api/qa/audits?from=2026-07-01&to=2026-07-31");
    expect(res.status).toBe(200);
    expect(res.body.reason).toBe("no_employee_profile_linked");
  });
});

describe("a privileged reader is still bounded by scope", () => {
  it("refuses an employee outside their scope", async () => {
    getUserRoleContext.mockResolvedValue({ primaryRole: "qa" });
    execute
      .mockResolvedValueOnce([[{ id: "emp-self" }], []])  // selfEmployeeId
      .mockResolvedValueOnce([[], []]);                    // scope check finds nobody

    const res = await request(appAs("qa"))
      .get("/api/qa/audits?from=2026-07-01&to=2026-07-31&employeeId=emp-elsewhere");

    expect(res.status).toBe(403);
    expect(listAuditsForEmployee).not.toHaveBeenCalled();
  });

  it("reads an employee inside their scope", async () => {
    getUserRoleContext.mockResolvedValue({ primaryRole: "qa" });
    execute
      .mockResolvedValueOnce([[{ id: "emp-self" }], []])
      .mockResolvedValueOnce([[{ id: "emp-in-scope" }], []]);

    const res = await request(appAs("qa"))
      .get("/api/qa/audits?from=2026-07-01&to=2026-07-31&employeeId=emp-in-scope");

    expect(res.status).toBe(200);
    expect(listAuditsForEmployee).toHaveBeenCalledWith("emp-in-scope", "2026-07-01", "2026-07-31");
  });
});

describe("scoring is a QA function", () => {
  it("refuses a manager trying to file an audit", async () => {
    const res = await request(appAs("manager")).post("/api/qa/audits").send({});
    expect(res.status).toBe(403);
  });

  it("takes the auditor from the session, never the body", async () => {
    // Otherwise an auditor could file an audit under somebody else's name.
    submitQaAudit.mockResolvedValue({ id: "a1", status: "submitted" });
    const res = await request(appAs("qa")).post("/api/qa/audits").send({
      formId: "f1", employeeId: "e1", auditDate: "2026-07-15", scores: [],
      auditorUserId: "somebody-else",
    });

    expect(res.status).toBe(201);
    expect(submitQaAudit.mock.calls[0][0].auditorUserId).toBe("user-1");
  });

  it("rejects a payload with no scores array", async () => {
    const res = await request(appAs("qa")).post("/api/qa/audits")
      .send({ formId: "f1", employeeId: "e1", auditDate: "2026-07-15" });
    expect(res.status).toBe(400);
  });
});

describe("form lookup", () => {
  it("distinguishes 'no form configured' from an empty result", async () => {
    // An empty list reads as either. The reason code says which.
    execute.mockResolvedValueOnce([[], []]);
    const res = await request(appAs("qa")).get("/api/qa/audit-forms?processId=p1");
    expect(res.status).toBe(200);
    expect(res.body.reason).toBe("no_active_form_for_process");
  });

  it("requires a processId", async () => {
    const res = await request(appAs("qa")).get("/api/qa/audit-forms");
    expect(res.status).toBe(400);
  });
});
