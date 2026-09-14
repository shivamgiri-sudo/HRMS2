import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GET /pf-creation/employee/:employeeId returns epfo_uan_assigned and
 * epfo_member_id_assigned — UAN and PF member ID, which the charter lists among
 * the fields that must never leak across employees.
 *
 * The route allows the "employee" role so a person can check their own PF
 * creation status. requireRole answers "may you call this" and never "about
 * whom", so without an ownership check any authenticated employee could read a
 * colleague's record by editing the id in the URL.
 *
 * Mounts the router directly rather than importing app.ts, so this stays
 * runnable regardless of the wider application graph.
 */

const SELF_EMPLOYEE_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_EMPLOYEE_ID = "22222222-2222-2222-2222-222222222222";
const AUTH_USER_ID = "33333333-3333-3333-3333-333333333333";

const { hasAnyRole, getEmployeeForUser, getEmployeePfStatus } = vi.hoisted(() => ({
  hasAnyRole: vi.fn(),
  getEmployeeForUser: vi.fn(),
  getEmployeePfStatus: vi.fn(),
}));

vi.mock("../../../shared/scopeAccess.js", () => ({ hasAnyRole }));
vi.mock("../../../shared/accessGuard.js", () => ({ getEmployeeForUser }));
vi.mock("../pf-creation.service.js", () => ({
  pfCreationService: { getEmployeePfStatus },
}));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { authUser: { id: string } }).authUser = { id: AUTH_USER_ID };
    next();
  },
}));
// requireRole is the "may you call this" gate; these tests are about "about
// whom", so it is allowed through and the ownership rule is what gets asserted.
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

import { pfCreationRouter } from "../pf-creation.routes.js";

const PF_RECORD = {
  item_status: "created",
  epfo_uan_assigned: "100200300400",
  epfo_member_id_assigned: "DLCPM00123450000012345",
};

function buildApp() {
  const app = express();
  app.use("/api/pf-creation", pfCreationRouter);
  return app;
}

describe("GET /pf-creation/employee/:employeeId ownership", () => {
  beforeEach(() => {
    hasAnyRole.mockReset();
    getEmployeeForUser.mockReset();
    getEmployeePfStatus.mockReset();
    getEmployeePfStatus.mockResolvedValue(PF_RECORD);
  });

  it("denies an employee reading another employee's PF record", async () => {
    hasAnyRole.mockResolvedValue(false); // plain employee, no privileged role
    getEmployeeForUser.mockResolvedValue({ id: SELF_EMPLOYEE_ID, employee_code: "E001" });

    const res = await request(buildApp()).get(`/api/pf-creation/employee/${OTHER_EMPLOYEE_ID}`);

    expect(res.status).toBe(403);
    // The UAN must not be computed, let alone returned.
    expect(getEmployeePfStatus).not.toHaveBeenCalled();
    expect(JSON.stringify(res.body)).not.toContain(PF_RECORD.epfo_uan_assigned);
  });

  it("allows an employee to read their own PF record", async () => {
    hasAnyRole.mockResolvedValue(false);
    getEmployeeForUser.mockResolvedValue({ id: SELF_EMPLOYEE_ID, employee_code: "E001" });

    const res = await request(buildApp()).get(`/api/pf-creation/employee/${SELF_EMPLOYEE_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(PF_RECORD);
  });

  it("denies a user with no employee record at all", async () => {
    hasAnyRole.mockResolvedValue(false);
    getEmployeeForUser.mockResolvedValue(null);

    const res = await request(buildApp()).get(`/api/pf-creation/employee/${SELF_EMPLOYEE_ID}`);

    expect(res.status).toBe(403);
    expect(getEmployeePfStatus).not.toHaveBeenCalled();
  });

  it("leaves payroll and HR reading any employee, as before", async () => {
    hasAnyRole.mockResolvedValue(true); // payroll / hr / admin
    const res = await request(buildApp()).get(`/api/pf-creation/employee/${OTHER_EMPLOYEE_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(PF_RECORD);
    // Privileged callers short-circuit before the ownership lookup.
    expect(getEmployeeForUser).not.toHaveBeenCalled();
    expect(getEmployeePfStatus).toHaveBeenCalledWith(OTHER_EMPLOYEE_ID);
  });
});
