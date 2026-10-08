import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

/**
 * scopedAttendanceDailyHandler was dead code until the fix in wfm.routes.ts
 * made it the actual delegate for the no-employeeId ("my team, one date")
 * query shape — previously unreachable because wfm.routes.ts's own
 * colliding "/attendance/daily" always won the exact overlapping path. Now
 * that it's genuinely load-bearing, it needs real coverage, not just the
 * delegation-wiring test in attendance-daily-delegation.routes.test.ts.
 */
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (
    req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ) => {
    (req as express.Request & { authUser: { id: string } }).authUser = {
      id: "test-user-id",
    };
    next();
  },
}));

vi.mock("../../../shared/accessGuard.js", () => ({
  hasRole: vi.fn(),
  getEmployeeForUser: vi.fn(),
}));

const mocks = vi.hoisted(() => ({ execute: vi.fn(), getScope: vi.fn() }));
vi.mock('../../../db/mysql.js', () => ({ db: { execute: mocks.execute } }));

// Branch scoping (owner ruling 2026-10-01): only the caller's resolved business scope is faked; isOrgWide /
// scopePredicate stay the real implementations.
vi.mock('../branch-scope.js', async (orig) => ({ ...(await orig<typeof import('../branch-scope.js')>()), getScope: mocks.getScope }));
const scopeOf = (roles: string[], over: Record<string, unknown> = {}) => ({
  userId: 'test-user-id', roles, employeeId: 'emp-x', employeeCode: 'C', branchId: 'branch-a', processId: null, lobId: null,
  departmentId: null, isSuperAdmin: roles.includes('super_admin'), isAdmin: roles.includes('admin'), isHr: roles.includes('hr'),
  isPayroll: false, isFinance: false, assignments: [], ...over,
});

vi.mock('../../../shared/timezone.js', () => ({ toIST: (v: unknown) => v ?? null }));
vi.mock('../apr-attendance.service.js', () => ({ composeIstDateTime: () => null }));

import { hasRole, getEmployeeForUser } from "../../../shared/accessGuard.js";

// Any SQL containing INFORMATION_SCHEMA is the one-time APR-table probe;
// route it to "table absent" so the rest of the query behaves the same
// regardless of which test runs first within this file (aprTableExists is
// a module-level cache, populated once per test-file run).
function mockExecuteByQuery(handlers: {
  countTotal?: number;
  mainRows?: unknown[];
}) {
  mocks.execute.mockImplementation(async (sql: string) => {
    if (sql.includes("INFORMATION_SCHEMA")) return [[{ c: 0 }]];
    if (sql.trim().startsWith("SELECT COUNT(*) AS total"))
      return [[{ total: handlers.countTotal ?? 0 }]];
    return [handlers.mainRows ?? []];
  });
}

describe("scopedAttendanceDailyHandler", () => {
  let app: express.Application;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { attendanceDailyScopedRouter } =
      await import("../attendance-daily-scoped.routes.js");
    app = express();
    app.use("/api/wfm/attendance", attendanceDailyScopedRouter);
  });

  it("scopes a plain (non-manager, non-privileged) employee to only their own record_id", async () => {
    vi.mocked(hasRole).mockResolvedValue(false);
    vi.mocked(getEmployeeForUser).mockResolvedValue({ id: "emp-self" } as any);
    mockExecuteByQuery({
      countTotal: 1,
      mainRows: [{ employee_id: "emp-self", record_date: "2026-08-06" }],
    });

    const res = await request(app).get(
      "/api/wfm/attendance/daily?date=2026-08-06",
    );
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const mainCall = mocks.execute.mock.calls.find(
      ([sql]) =>
        !sql.includes("INFORMATION_SCHEMA") &&
        !sql.trim().startsWith("SELECT COUNT"),
    );
    expect(mainCall![0]).toContain("adr.employee_id = ?");
    expect(mainCall![1]).toContain("emp-self");
  });

  it("denies a non-privileged caller with no employee record at all", async () => {
    vi.mocked(hasRole).mockResolvedValue(false);
    vi.mocked(getEmployeeForUser).mockResolvedValue(null as any);

    const res = await request(app).get("/api/wfm/attendance/daily");
    expect(res.status).toBe(403);
  });

  it("scopes a manager to their reporting-line team, not just themselves", async () => {
    // First hasRole check (admin/hr/wfm/ceo) -> false, second (manager/assistant_manager/tl) -> true
    vi.mocked(hasRole).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    vi.mocked(getEmployeeForUser).mockResolvedValue({ id: "mgr-1" } as any);
    mockExecuteByQuery({ countTotal: 3, mainRows: [] });

    const res = await request(app).get(
      "/api/wfm/attendance/daily?date=2026-08-06",
    );
    expect(res.status).toBe(200);

    const mainCall = mocks.execute.mock.calls.find(
      ([sql]) =>
        !sql.includes("INFORMATION_SCHEMA") &&
        !sql.trim().startsWith("SELECT COUNT"),
    );
    expect(mainCall![0]).toContain("e.reporting_manager_id = ?");
    expect(mainCall![0]).toContain("e.manager_id = ?");
  });

  it("lets a privileged caller (admin/hr/wfm/ceo) filter by an explicit employeeId", async () => {
    vi.mocked(hasRole).mockResolvedValue(true);
    mocks.getScope.mockResolvedValue(scopeOf(['super_admin']));
    vi.mocked(getEmployeeForUser).mockResolvedValue({ id: 'admin-emp' } as any);
    mockExecuteByQuery({ countTotal: 1, mainRows: [] });

    const res = await request(app).get(
      "/api/wfm/attendance/daily?employeeId=target-emp&date=2026-08-06",
    );
    expect(res.status).toBe(200);

    const mainCall = mocks.execute.mock.calls.find(
      ([sql]) =>
        !sql.includes("INFORMATION_SCHEMA") &&
        !sql.trim().startsWith("SELECT COUNT"),
    );
    expect(mainCall![0]).toContain("adr.employee_id = ?");
    expect(mainCall![1]).toContain("target-emp");
  });

  it('lets an org-wide caller with no employeeId see every branch (no employee / branch filter)', async () => {
    vi.mocked(hasRole).mockResolvedValue(true);
    mocks.getScope.mockResolvedValue(scopeOf(['super_admin']));
    vi.mocked(getEmployeeForUser).mockResolvedValue({ id: 'admin-emp' } as any);
    mockExecuteByQuery({ countTotal: 500, mainRows: [] });

    const res = await request(app).get(
      "/api/wfm/attendance/daily?date=2026-08-06",
    );
    expect(res.status).toBe(200);

    const mainCall = mocks.execute.mock.calls.find(([sql]) => !sql.includes('INFORMATION_SCHEMA') && !sql.trim().startsWith('SELECT COUNT'));
    expect(mainCall![0]).not.toContain('adr.employee_id = ?');
    expect(mainCall![0]).not.toContain('COALESCE(adr.branch_id, e.branch_id) = ?');
  });

  it('admin is branch-scoped like hr: the query is limited to their own branch', async () => {
    vi.mocked(hasRole).mockResolvedValue(true);
    vi.mocked(getEmployeeForUser).mockResolvedValue({ id: 'admin-emp' } as any);
    mocks.getScope.mockResolvedValue(scopeOf(['admin'], {
      assignments: [{ roleKey: 'admin', scopeType: 'branch', branchId: 'branch-a', processId: null, lobId: null, departmentId: null, managerEmployeeId: null, clientId: null }],
    }));
    mockExecuteByQuery({ countTotal: 1, mainRows: [] });

    const res = await request(app).get('/api/wfm/attendance/daily?date=2026-08-06');
    expect(res.status).toBe(200);
    const mainCall = mocks.execute.mock.calls.find(([sql]) => !sql.includes('INFORMATION_SCHEMA') && !sql.trim().startsWith('SELECT COUNT'));
    expect(mainCall![0]).toContain('COALESCE(adr.branch_id, e.branch_id) = ?');
    expect(mainCall![1]).toContain('branch-a');
  });

  it('an admin with no branch (no resolvable scope) sees nothing', async () => {
    vi.mocked(hasRole).mockResolvedValue(true);
    vi.mocked(getEmployeeForUser).mockResolvedValue({ id: 'admin-emp' } as any);
    mocks.getScope.mockResolvedValue(scopeOf(['admin'], { branchId: null, employeeId: null }));
    mockExecuteByQuery({ countTotal: 0, mainRows: [] });

    const res = await request(app).get('/api/wfm/attendance/daily?date=2026-08-06');
    expect(res.status).toBe(200);
    const mainCall = mocks.execute.mock.calls.find(([sql]) => !sql.includes('INFORMATION_SCHEMA') && !sql.trim().startsWith('SELECT COUNT'));
    expect(mainCall![0]).toContain('(1=0)');
  });

  it('hr is limited to their own branch too, and a foreign ?branchId= can only narrow (ANDed)', async () => {
    vi.mocked(hasRole).mockResolvedValue(true);
    vi.mocked(getEmployeeForUser).mockResolvedValue({ id: 'hr-emp' } as any);
    mocks.getScope.mockResolvedValue(scopeOf(['hr']));
    mockExecuteByQuery({ countTotal: 0, mainRows: [] });

    const res = await request(app).get('/api/wfm/attendance/daily?branchId=branch-z');
    expect(res.status).toBe(200);
    const mainCall = mocks.execute.mock.calls.find(([sql]) => !sql.includes('INFORMATION_SCHEMA') && !sql.trim().startsWith('SELECT COUNT'));
    expect(mainCall![1]).toEqual(expect.arrayContaining(['branch-a', 'branch-z']));
    expect(mainCall![0]).toContain('COALESCE(adr.branch_id, e.branch_id) = ?');
  });

  it("returns pagination fields (page, limit, total)", async () => {
    vi.mocked(hasRole).mockResolvedValue(false);
    vi.mocked(getEmployeeForUser).mockResolvedValue({ id: "emp-self" } as any);
    mockExecuteByQuery({ countTotal: 42, mainRows: [] });

    const res = await request(app).get(
      "/api/wfm/attendance/daily?page=2&limit=10",
    );
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(42);
    expect(res.body.page).toBe(2);
    expect(res.body.limit).toBe(10);
  });

  it("rejects a malformed branchId/processId query param rather than passing it through to SQL", async () => {
    vi.mocked(hasRole).mockResolvedValue(true);
    mocks.getScope.mockResolvedValue(scopeOf(['super_admin']));
    vi.mocked(getEmployeeForUser).mockResolvedValue({ id: 'admin-emp' } as any);

    const res = await request(app).get(
      `/api/wfm/attendance/daily?branchId=${encodeURIComponent("'; DROP TABLE x --")}`,
    );
    expect(res.status).toBe(400);
  });

  it("issues the count and page queries concurrently (count started before page resolves)", async () => {
    vi.mocked(hasRole).mockResolvedValue(false);
    vi.mocked(getEmployeeForUser).mockResolvedValue({ id: "emp-self" } as any);
    const started: string[] = [];
    mocks.execute.mockImplementation(async (sql: string) => {
      if (sql.includes("INFORMATION_SCHEMA")) return [[{ c: 0 }]];
      if (sql.trim().startsWith("SELECT COUNT(*) AS total")) {
        started.push("count");
        await new Promise((r) => setTimeout(r, 15));
        return [[{ total: 3 }]];
      }
      started.push("page");
      expect(started).toContain("count");
      return [[{ employee_id: "emp-self", record_date: "2026-08-06" }]];
    });
    const res = await request(app).get(
      "/api/wfm/attendance/daily?date=2026-08-06",
    );
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(started).toEqual(["count", "page"]);
  });
});
