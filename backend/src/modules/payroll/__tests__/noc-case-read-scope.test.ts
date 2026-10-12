import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * NOC Clearance Chain read access (owner request: visible to employees, managers, WFM, payroll HR).
 *
 *   - staff roles (incl. the new wfm / branch_wfm) keep the existing branch / assignment scope;
 *   - an employee holding no staff role sees ONLY their own case — list, summary, per-employee, detail;
 *   - nobody else gets in.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection: vi.fn() } }));

let held: string[] = [];
vi.mock("../../../shared/scopeAccess.js", () => ({
  hasAnyRole: vi.fn(async (_u: string, ...roles: string[]) => roles.some((r) => held.includes(r))),
  hasScopedAccess: vi.fn(async () => true),
  buildScopeWhereClause: vi.fn(async () => ({ sql: "c.branch_id = ?", params: ["branch-staff"] })),
}));
vi.mock("../../../shared/accessGuard.js", () => ({
  getEmployeeForUser: vi.fn(async () => ({ id: "emp-me" })),
}));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction: vi.fn(async () => undefined) }));
vi.mock("../payroll-branch-scope.js", () => ({
  filterVisibleEmployeeIds: vi.fn(async (_r: unknown, ids: string[]) => new Set(ids)),
  guardEmployee: vi.fn(async () => true),
}));
vi.mock("../noc-release-gate.service.js", () => ({
  overrideNocRelease: vi.fn(),
  nocBlockedEmployeesForRuns: vi.fn(async () => []),
  nocReleaseStatusForEmployee: vi.fn(async () => ({ released: false })),
}));

const { listCases, getCase, getCaseDetail, getCaseByEmployee } = vi.hoisted(() => ({
  listCases: vi.fn(async () => [{ id: "c1" }]),
  getCase: vi.fn(),
  getCaseDetail: vi.fn(async () => ({ id: "c1", signatories: [] })),
  getCaseByEmployee: vi.fn(async () => ({ id: "c1" })),
}));
vi.mock("../noc-case.service.js", () => ({ listCases, getCase, getCaseDetail, getCaseByEmployee }));

vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.authUser = { id: "user-1", role: "employee", roles: held };
    next();
  },
}));

async function app() {
  const { nocCaseRouter } = await import("../noc-case.routes.js");
  const a = express();
  a.use(express.json());
  a.use("/api/payroll/noc-cases", nocCaseRouter);
  return a;
}

beforeEach(() => {
  execute.mockReset();
  execute.mockResolvedValue([[], []]);
  listCases.mockClear();
  getCase.mockReset();
  getCaseByEmployee.mockClear();
});

describe("NOC clearance read access", () => {
  it("employee: list is clamped to their own employee id", async () => {
    held = ["employee"];
    const res = await request(await app()).get("/api/payroll/noc-cases");
    expect(res.status).toBe(200);
    const scope = (listCases.mock.calls[0] as unknown as unknown[])[1] as { sql: string; params: unknown[] };
    expect(scope.sql).toBe("c.employee_id = ?");
    expect(scope.params).toEqual(["emp-me"]);
  });

  it("employee: another person's case detail is refused, their own is returned", async () => {
    held = ["employee"];
    getCase.mockResolvedValueOnce({ id: "c9", employee_id: "emp-other", branch_id: "b1", process_id: null });
    const other = await request(await app()).get("/api/payroll/noc-cases/c9");
    expect(other.status).toBe(403);
    expect(other.body.code).toBe("NOC_OUT_OF_SCOPE");

    getCase.mockResolvedValueOnce({ id: "c1", employee_id: "emp-me", branch_id: "b1", process_id: null });
    const own = await request(await app()).get("/api/payroll/noc-cases/c1");
    expect(own.status).toBe(200);
  });

  it("employee: per-employee release status only for themselves", async () => {
    held = ["employee"];
    const other = await request(await app()).get("/api/payroll/noc-cases/employee/emp-other");
    expect(other.status).toBe(403);
    const own = await request(await app()).get("/api/payroll/noc-cases/employee/emp-me");
    expect(own.status).toBe(200);
  });

  it("wfm and branch_wfm are staff readers: branch-scoped list, not own-only", async () => {
    for (const role of ["wfm", "branch_wfm"]) {
      held = [role];
      listCases.mockClear();
      const res = await request(await app()).get("/api/payroll/noc-cases");
      expect(res.status).toBe(200);
      const scope = (listCases.mock.calls[0] as unknown as unknown[])[1] as { sql: string };
      expect(scope.sql).toBe("c.branch_id = ?");
    }
  });

  it("an employee who ALSO holds a staff role gets the staff scope, not own-only", async () => {
    held = ["employee", "manager"];
    const res = await request(await app()).get("/api/payroll/noc-cases");
    expect(res.status).toBe(200);
    const scope = (listCases.mock.calls[0] as unknown as unknown[])[1] as { sql: string };
    expect(scope.sql).toBe("c.branch_id = ?");
  });

  it("a role with no NOC access is refused", async () => {
    held = ["candidate"];
    const res = await request(await app()).get("/api/payroll/noc-cases");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("NOC_ACCESS_DENIED");
  });
});
