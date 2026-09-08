import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The realistic-shape companion to payrollHrCostCentreTransfer.contract.test.ts.
 *
 * That test mocks requireRole and scopeMiddleware away entirely and injects
 * `req.authUser.roles = ["hr", "payroll_hr"]` directly — which is NOT what a real payroll_hr
 * user's roles array ever looks like. `authMiddleware.ts` populates it from
 * `roleResolver.ts`'s `getUserRoleContext()`, which runs every role through
 * `normalizeDashboardRole()` (shared/dashboardAccessRegistry.ts). That map has
 * `payroll_hr: "payroll"`, so a real payroll_hr user's `req.authUser.roles` contains
 * "payroll" and NEVER "payroll_hr".
 *
 * The 2026-09-08 gate shipped naming "payroll_hr" in requireRole's allow-list and in the
 * actorRoles.includes() destination check — both of which read this exact, already-collapsed
 * array. Both checks could never be true for any real payroll_hr user, so the feature was dead
 * on arrival for one deploy despite 9 passing tests, because every one of those tests supplied
 * the uncollapsed shape by hand. See hrms2-payroll-hr-role-alias-breaks-rbac.
 *
 * This test uses the REAL requireRole middleware and injects the realistic, ALREADY-COLLAPSED
 * roles array a live payroll_hr user actually carries — proving the fix works against the
 * shape production produces, not the shape a test author assumes it produces.
 *
 * requireScopedRole is left real too. It calls hasScopedAccess() from shared/scopeAccess.ts,
 * which has its OWN unaliased role lookup straight off user_roles — so the scope rows here are
 * seeded with the literal 'payroll_hr' role_key production actually stores.
 */

const USER_ID = "11111111-1111-1111-1111-111111111111";
const EMP_ID = "22222222-2222-2222-2222-222222222222";
const OWN_BRANCH = "branch-noida";
const OTHER_BRANCH = "branch-ahmedabad";

const { dbExecute } = vi.hoisted(() => ({ dbExecute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));

// The realistic post-alias-collapse shape: "payroll", never "payroll_hr". This is the array
// authMiddleware.ts actually attaches for a live payroll_hr user (verified against
// shared/roleResolver.ts + shared/dashboardAccessRegistry.ts's DASHBOARD_ROLE_ALIASES).
const REALISTIC_PAYROLL_HR_ROLES = ["employee", "hr", "payroll"];

vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { authUser: { id: string; role: string; roles: string[] } }).authUser = {
      id: USER_ID, role: "payroll", roles: REALISTIC_PAYROLL_HR_ROLES,
    };
    next();
  },
}));

const { updateEmployee } = vi.hoisted(() => ({ updateEmployee: vi.fn() }));
vi.mock("../employee.controller.js", async (importOriginal) => {
  const actual = await importOriginal<{ employeeController: Record<string, unknown> }>();
  return { employeeController: { ...actual.employeeController, updateEmployee } };
});

const { employeeRouter } = await import("../employee.routes.js");

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api/employees", employeeRouter);
  return a;
}

beforeEach(() => {
  dbExecute.mockReset();
  updateEmployee.mockReset();
  updateEmployee.mockImplementation(async (_req: express.Request, res: express.Response) => {
    res.json({ success: true });
  });

  dbExecute.mockImplementation(async (sql: unknown, params: unknown[]) => {
    const text = String(sql);

    // The employee being edited. Both requireScopedRole's target resolver and the transfer
    // gate query this. Checked BEFORE the role-key pattern below, which would otherwise also
    // match "SELECT branch_id ... FROM employees" if it were broadened carelessly.
    if (/FROM employees WHERE id = \?/i.test(text)) {
      return [[{ branch_id: OWN_BRANCH, process_id: null, department_id: null }], []];
    }

    // shared/scopeAccess.ts's OWN unaliased role lookup — the literal role_key a real
    // payroll_hr user's user_roles row carries. This is deliberately the ONLY branch matching
    // "user_roles": an earlier draft of this mock had a second, broader pattern ahead of this
    // one ("requireRole's DB fallback, unreachable here") that intercepted this exact query
    // too and returned an empty role set, which made hasScopedAccess see zero roles and 403 —
    // the mock recreating the same silent-collapse failure mode this test exists to catch.
    if (/FROM user_roles WHERE user_id = \?/i.test(text)) {
      return [[{ role_key: "hr" }, { role_key: "payroll_hr" }], []];
    }

    // The actor's branch scope grant, keyed exactly as production stores it.
    if (/FROM user_assignment_scope/i.test(text)) {
      return [[{ id: "scope-1", role_key: "payroll_hr", scope_type: "branch",
                 branch_id: OWN_BRANCH, process_id: null, lob_id: null,
                 department_id: null, manager_employee_id: null }], []];
    }

    if (/FROM cost_centre_master WHERE id = \?/i.test(text)) {
      return [[{ branch_id: OWN_BRANCH }], []];
    }

    return [[], []];
  });
});

const patch = (body: Record<string, unknown>) =>
  request(app()).patch(`/api/employees/${EMP_ID}`).send(body);

describe("a real payroll_hr user, with roles already collapsed to 'payroll' by the alias table", () => {
  it("is admitted by requireRole — this is the check that shipped broken", async () => {
    const res = await patch({ cost_centre_code: "unused" }); // no branch/CC field: skips the transfer gate
    expect(res.status).toBe(200);
    expect(updateEmployee).toHaveBeenCalled();
  });

  it("passes the transfer gate for a cost centre inside their own branch", async () => {
    const res = await patch({ costCentreId: "cc-1" });
    expect(res.status).toBe(200);
    expect(updateEmployee).toHaveBeenCalled();
  });

  it("is refused for a destination outside their branch scope", async () => {
    const res = await patch({ branchId: OTHER_BRANCH });
    expect(res.status).toBe(403);
    expect(updateEmployee).not.toHaveBeenCalled();
  });
});
