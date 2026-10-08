import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * HRMS2 delta-audit, 2026-08-14 (P1, leave cluster): GET /leave-balances
 * (reporting.leave-balance.routes.ts — the LIVE handler; reportingLeaveBalanceRouter
 * is mounted before reportingRouter in app.ts, so its /leave-balances shadows
 * reporting.routes.ts's own copy, which is unreachable and left untouched here)
 * does require auth and does apply resolveBranchScope. But resolveBranchScope's
 * own fallback (used by "every scoped report", per its own comment) grants any
 * employee with no real user_assignment_scope row visibility of their entire
 * branch — so a plain individual contributor could see every colleague's
 * individual leave balance, not just their own. User-approved fix, this
 * session: restrict a caller with no real management assignment to their own
 * employee_id, without touching the shared resolveBranchScope utility (other
 * reports' branch-transparency behavior is unaffected).
 */

const { dbExecute } = vi.hoisted(() => ({
  dbExecute: vi.fn(async (sql: string, params: unknown[]) => {
    if (/FROM user_roles WHERE user_id/i.test(sql)) return [[], []];
    // getEmployeeForUser's own query (accessGuard.ts): aliased "e.id, e.employee_code FROM employees e WHERE e.user_id".
    // Checked BEFORE the bare resolveBranchScope fallback query below — both hit "employees" but with different shapes.
    if (/e\.id,\s*e\.employee_code\s+FROM employees e\s+WHERE e\.user_id/i.test(sql)) {
      if (params[0] === "u-plain-employee") return [[{ id: "emp-self-1", employee_code: "E1" }], []];
      return [[{ id: "emp-mgr-1", employee_code: "E2" }], []];
    }
    if (/FROM user_assignment_scope WHERE user_id/i.test(sql)) {
      // no real assignment for the plain-employee test user
      if (params[0] === "u-plain-employee") return [[], []];
      // a real branch assignment for the manager test user
      if (params[0] === "u-branch-head") return [[{ scope_type: "branch", branch_id: "branch-1" }], []];
      return [[], []];
    }
    // resolveBranchScope's own bare fallback query: "SELECT branch_id FROM employees WHERE user_id = ?"
    if (/SELECT branch_id FROM employees WHERE user_id/i.test(sql)) {
      return [[{ branch_id: "branch-1" }], []];
    }
    // the leave-balances SELECT itself — return a marker row so we can assert on params
    return [[{ employee_id: "emp-self-1", employee_code: "E1", full_name: "Self", department_name: "D",
                branch_name: "B", process_name: "P", cost_centre_name: "CC",
                leave_type_id: "lt-1", leave_name: "CL", total_days: 12, used_days: 2 }], []];
  }),
}));
vi.mock("../../../db/mysql.js", () => ({
  db: { execute: dbExecute, query: dbExecute, getConnection: vi.fn() },
}));

const plainEmployeeActor = { id: "u-plain-employee" };
const branchHeadActor = { id: "u-branch-head" };
let currentActor = plainEmployeeActor;
vi.mock("../../../middleware/authMiddleware.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../middleware/authMiddleware.js")>();
  return {
    ...original,
    requireAuth: (req: any, _res: any, next: any) => { req.authUser = currentActor; next(); },
  };
});

import { reportingLeaveBalanceRouter } from "../reporting.leave-balance.routes.js";

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api/reports", reportingLeaveBalanceRouter);
  return a;
}

beforeEach(() => {
  dbExecute.mockClear();
});

describe("GET /api/reports/leave-balances — self-scope for non-managers", () => {
  it("a plain employee (no real user_assignment_scope row) is restricted to their own employee_id", async () => {
    currentActor = plainEmployeeActor;
    await request(app()).get("/api/reports/leave-balances");
    const leaveBalanceCall = dbExecute.mock.calls.find(([sql]) =>
      /FROM employees e/i.test(sql) && /CROSS JOIN leave_type_master/i.test(sql)
    );
    expect(leaveBalanceCall).toBeDefined();
    const [sql, params] = leaveBalanceCall!;
    expect(sql).toMatch(/e\.id\s*=\s*\?/);
    expect(params).toContain("emp-self-1");
  });

  it("a real branch_head (has a user_assignment_scope row) still sees the whole branch, unrestricted to self", async () => {
    currentActor = branchHeadActor;
    await request(app()).get("/api/reports/leave-balances");
    const leaveBalanceCall = dbExecute.mock.calls.find(([sql]) =>
      /FROM employees e/i.test(sql) && /CROSS JOIN leave_type_master/i.test(sql)
    );
    expect(leaveBalanceCall).toBeDefined();
    const [sql] = leaveBalanceCall!;
    expect(sql).not.toMatch(/e\.id\s*=\s*\?/);
  });
});
