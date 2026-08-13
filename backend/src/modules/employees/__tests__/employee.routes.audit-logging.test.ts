/**
 * Audit-logging coverage for the five write routes that previously had none
 * (self-service) or none beyond a bare field-name list (HR entry):
 *
 *   PATCH /me                       (Personal tab self-service)
 *   PUT   /me/emergency-contact
 *   PUT   /me/nominee
 *   PUT   /:employeeId/emergency-contact  (HR entry)
 *   PUT   /:employeeId/nominee            (HR entry)
 *
 * DOB/gender/address/contact/emergency-contact/nominee changes wrote silently
 * before this fix — the dead employee.profile.service.ts had audit calls wired
 * into every one of these; the version that actually runs (employee.routes.ts)
 * didn't. This mounts the real router with a mocked db and asserts each route
 * now writes a sensitive_action_log row with real before/after values.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "11111111-1111-1111-1111-111111111111";
const EMP_ID = "22222222-2222-2222-2222-222222222222";

const { dbExecute } = vi.hoisted(() => ({ dbExecute: vi.fn() }));

vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { authUser: { id: string } }).authUser = { id: USER_ID };
    next();
  },
}));
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));
vi.mock("../../../middleware/scopeMiddleware.js", () => ({
  requireScopedRole: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));
vi.mock("../../../shared/accessGuard.js", () => ({
  getEmployeeForUser: vi.fn().mockResolvedValue({ id: EMP_ID, employee_code: "MAS0001" }),
  hasRole: vi.fn().mockResolvedValue(true),
}));

const { employeeRouter } = await import("../employee.routes.js");

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api/employees", employeeRouter);
  return a;
}

function auditInserts() {
  return dbExecute.mock.calls.filter(([sql]) => /INSERT INTO sensitive_action_log/i.test(String(sql)));
}

beforeEach(() => {
  dbExecute.mockReset();
  // Default: "who is the caller's own employee record" lookup used by every /me route.
  dbExecute.mockImplementation(async (sql: unknown) => {
    const text = String(sql);
    if (/FROM employees WHERE user_id = \?/i.test(text)) return [[{ id: EMP_ID }], []];
    return [[], []];
  });
});

describe("PATCH /api/employees/me", () => {
  it("logs a before/after audit entry when a field actually changes", async () => {
    dbExecute.mockImplementation(async (sql: unknown) => {
      const text = String(sql);
      if (/FROM employees WHERE user_id = \?/i.test(text)) return [[{ id: EMP_ID }], []];
      if (/^SELECT `mobile` FROM employees/i.test(text)) return [[{ mobile: "9999999999" }], []];
      return [{ affectedRows: 1 }, []];
    });

    const res = await request(app()).patch("/api/employees/me").send({ mobile: "8888888888" });

    expect(res.status).toBe(200);
    const [inserts] = [auditInserts()];
    expect(inserts).toHaveLength(1);
    const paramsStr = JSON.stringify(inserts[0][1]);
    expect(paramsStr).toContain("EMPLOYEE_SELF_PROFILE_UPDATED");
    expect(paramsStr).toContain("8888888888");
    expect(paramsStr).toContain("9999999999");
  });

  it("still 403s official_email with no audit log written (unchanged behaviour)", async () => {
    const res = await request(app()).patch("/api/employees/me").send({ official_email: "x@y.com" });
    expect(res.status).toBe(403);
    expect(auditInserts()).toHaveLength(0);
  });
});

describe("PUT /api/employees/me/emergency-contact", () => {
  it("logs before/after when replacing an existing contact", async () => {
    dbExecute.mockImplementation(async (sql: unknown) => {
      const text = String(sql);
      if (/FROM employees WHERE user_id = \?/i.test(text)) return [[{ id: EMP_ID }], []];
      if (/FROM employee_emergency_contact/i.test(text)) {
        return [[{ name: "Old Name", relationship: "Father", mobile: "1111111111", address: "Old Addr" }], []];
      }
      return [{ affectedRows: 1 }, []];
    });

    const res = await request(app()).put("/api/employees/me/emergency-contact").send({
      name: "New Name", relationship: "Mother", mobile: "2222222222", address: "New Addr",
    });

    expect(res.status).toBe(200);
    const inserts = auditInserts();
    expect(inserts).toHaveLength(1);
    const paramsStr = JSON.stringify(inserts[0][1]);
    expect(paramsStr).toContain("EMPLOYEE_SELF_EMERGENCY_CONTACT_UPDATED");
    expect(paramsStr).toContain("New Name");
    expect(paramsStr).toContain("Old Name");
  });
});

describe("PUT /api/employees/me/nominee", () => {
  it("logs before/after when updating an existing nominee", async () => {
    dbExecute.mockImplementation(async (sql: unknown) => {
      const text = String(sql);
      if (/FROM employees WHERE user_id = \?/i.test(text)) return [[{ id: EMP_ID }], []];
      if (/SELECT id, nominee_name, relationship.*FROM employee_nominee/is.test(text)) {
        return [[{ id: "nom-1", nominee_name: "Old Nominee", relationship: "Spouse", date_of_birth: null, mobile: null, address: null }], []];
      }
      return [{ affectedRows: 1 }, []];
    });

    const res = await request(app()).put("/api/employees/me/nominee").send({
      nominee_name: "New Nominee", relationship: "Child",
    });

    expect(res.status).toBe(200);
    const inserts = auditInserts();
    expect(inserts).toHaveLength(1);
    const paramsStr = JSON.stringify(inserts[0][1]);
    expect(paramsStr).toContain("EMPLOYEE_SELF_NOMINEE_UPDATED");
    expect(paramsStr).toContain("New Nominee");
    expect(paramsStr).toContain("Old Nominee");
  });
});

describe("PUT /api/employees/:employeeId/emergency-contact — HR entry", () => {
  it("logs before/after with actor = the HR user, not the target employee", async () => {
    dbExecute.mockImplementation(async (sql: unknown) => {
      const text = String(sql);
      if (/FROM employee_emergency_contact/i.test(text)) {
        return [[{ name: "Old Name", relationship: "Father", mobile: "1111111111", address: null }], []];
      }
      return [{ affectedRows: 1 }, []];
    });

    const res = await request(app()).put(`/api/employees/${EMP_ID}/emergency-contact`).send({
      name: "HR Entered Name", relationship: "Mother", mobile: "3333333333",
    });

    expect(res.status).toBe(200);
    const inserts = auditInserts();
    expect(inserts).toHaveLength(1);
    const params = inserts[0][1] as unknown[];
    expect(params).toContain(USER_ID); // actor_user_id is the HR caller
    expect(JSON.stringify(params)).toContain("EMERGENCY_CONTACT_HR_ENTRY");
  });
});

describe("PUT /api/employees/:employeeId/nominee — HR entry", () => {
  it("logs before/after for an HR-entered nominee change", async () => {
    dbExecute.mockImplementation(async (sql: unknown) => {
      const text = String(sql);
      if (/SELECT id, nominee_name, relationship.*FROM employee_nominee/is.test(text)) {
        return [[{ id: "nom-1", nominee_name: "Old Nominee", relationship: "Spouse", date_of_birth: null, mobile: null, address: null }], []];
      }
      return [{ affectedRows: 1 }, []];
    });

    const res = await request(app()).put(`/api/employees/${EMP_ID}/nominee`).send({
      nominee_name: "HR Entered Nominee", relationship: "Child",
    });

    expect(res.status).toBe(200);
    const inserts = auditInserts();
    expect(inserts).toHaveLength(1);
    const paramsStr = JSON.stringify(inserts[0][1]);
    expect(paramsStr).toContain("NOMINEE_HR_ENTRY");
    expect(paramsStr).toContain("HR Entered Nominee");
  });
});
