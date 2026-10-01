import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Benefits claims / enrollments (owner ruling 2026-10-01): hr only sees and changes its own branch's employees. */
const { dbExecute, canViewEmployee, listClaims, claimStats } = vi.hoisted(() => ({
  dbExecute: vi.fn(), canViewEmployee: vi.fn(), listClaims: vi.fn(async () => []), claimStats: vi.fn(async () => ({})),
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));
vi.mock("../../../shared/enterpriseScope.js", () => ({
  canViewEmployee,
  resolveUserBusinessScope: async () => ({ roles: ["hr"], assignments: [], branchId: "b1", employeeId: "e-self" }),
  buildEmployeeScopeCondition: () => ({ sql: "e.branch_id = ?", params: ["b1"] }),
}));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u-hr" }; next(); },
}));
vi.mock("../../../middleware/requireRole.js", () => ({ requireRole: () => (_q: any, _s: any, next: any) => next() }));
vi.mock("../../../shared/accessGuard.js", () => ({ getEmployeeForUser: vi.fn(async () => ({ id: "e-self" })), hasRole: vi.fn(async () => true) }));
vi.mock("../../inbox/inbox.service.js", () => ({ inboxService: { createItem: vi.fn() } }));
vi.mock("../benefits.service.js", () => ({
  benefitsService: {
    listClaims, claimStats, enroll: vi.fn(async () => ({})), updateEnrollmentStatus: vi.fn(async () => ({})),
    reviewClaim: vi.fn(async () => ({ employee_id: "x" })), payClaim: vi.fn(async () => ({ employee_id: "x" })),
    listEnrollments: vi.fn(async () => []), submitClaim: vi.fn(async () => ({})),
  },
}));

const { benefitsRouter } = await import("../benefits.routes.js");
const app = () => { const a = express(); a.use(express.json()); a.use("/api/benefits", benefitsRouter); return a; };

beforeEach(() => {
  canViewEmployee.mockReset(); listClaims.mockClear(); claimStats.mockClear(); dbExecute.mockReset();
  dbExecute.mockResolvedValue([[{ employee_id: "emp-b", user_id: null }], []]);
});

describe("benefits branch scoping", () => {
  it("claims list and stats receive the caller's branch scope", async () => {
    const res = await request(app()).get("/api/benefits/claims");
    expect(res.status).toBe(200);
    expect((listClaims.mock.calls[0] as any)[1]).toEqual({ sql: "e.branch_id = ?", params: ["b1"] });
    expect((claimStats.mock.calls[0] as any)[0]).toEqual({ sql: "e.branch_id = ?", params: ["b1"] });
  });
  it("enrollments of an employee outside the branch are 403 (own record still fine)", async () => {
    canViewEmployee.mockResolvedValue(false);
    expect((await request(app()).get("/api/benefits/enrollments/emp-b")).status).toBe(403);
    expect((await request(app()).get("/api/benefits/enrollments/e-self")).status).toBe(200);
  });
  it("enroll / update enrollment / review / pay are refused outside the branch", async () => {
    canViewEmployee.mockResolvedValue(false);
    const a = app();
    expect((await request(a).post("/api/benefits/enrollments").send({ employee_id: "emp-b", plan_id: "p", enrolled_date: "2026-01-01", effective_from: "2026-01-01" })).status).toBe(403);
    expect((await request(a).patch("/api/benefits/enrollments/en1").send({ status: "active" })).status).toBe(403);
    expect((await request(a).patch("/api/benefits/claims/c1/review").send({ action: "approved" })).status).toBe(403);
    expect((await request(a).post("/api/benefits/claims/c1/pay").send({ paymentReference: "R1" })).status).toBe(403);
  });
  it("in-branch review passes", async () => {
    canViewEmployee.mockResolvedValue(true);
    expect((await request(app()).patch("/api/benefits/claims/c1/review").send({ action: "approved" })).status).toBe(200);
  });
});
