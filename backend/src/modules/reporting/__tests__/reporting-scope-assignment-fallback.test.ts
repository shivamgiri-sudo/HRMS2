import { describe, it, expect, vi, beforeEach } from "vitest";

const { dbExecute } = vi.hoisted(() => ({ dbExecute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));

const { resolveFullScope } = await import("../reporting.scope.js");

const USER_ID = "d98a0a9d-6d7b-4b1d-98a1-cc948fb09eea";
const EMPLOYEE_ID = "0cf00cf6-5e8b-11f1-adb1-00155d0ab410";
const BRANCH_ID = "77769026-5e88-11f1-adb1-00155d0ab410";
const PROCESS_ID = "7889a7ac-5e88-11f1-adb1-00155d0ab410";

/**
 * Routes by SQL text — resolveFullScope issues user_roles, then employees, then
 * user_assignment_scope, in that order, but text-matching is the stable thing to assert
 * on rather than call order.
 */
function mockScope(opts: {
  roleKey: string;
  assignmentRows: Array<{ scope_type: string; branch_id: string | null; process_id: string | null; department_id?: string | null; cost_centre_id?: string | null }>;
  hasEmployee?: boolean;
}) {
  dbExecute.mockImplementation(async (sql?: string) => {
    if (typeof sql !== "string") return [[]];
    if (sql.includes("FROM user_roles")) return [[{ role_key: opts.roleKey }]];
    if (sql.includes("FROM employees")) {
      return opts.hasEmployee === false
        ? [[]]
        : [[{ id: EMPLOYEE_ID, branch_id: BRANCH_ID, process_id: PROCESS_ID }]];
    }
    if (sql.includes("FROM user_assignment_scope")) {
      return [opts.assignmentRows.map((r) => ({
        scope_type: r.scope_type,
        branch_id: r.branch_id,
        process_id: r.process_id,
        department_id: r.department_id ?? null,
        cost_centre_id: r.cost_centre_id ?? null,
      }))];
    }
    return [[]];
  });
}

/**
 * A branch-only assignment (scope_type 'branch', process_id NULL) is a grant to every
 * process within that branch. buildDim() used to fall through past "no assignment
 * specifies a process" straight to the caller's own employees.process_id, silently
 * re-narrowing an explicit branch-wide grant down to one person's process.
 *
 * Confirmed live on 2026-08-28: a branch_head with exactly this assignment shape
 * (scope_type 'branch', branch_id set, process_id NULL) plus an employee record in
 * "Virtual Account Management" saw AON & Attrition report 1 employee instead of the
 * branch's 441 — while HR_DASHBOARD and every other surface, which apply branch scope
 * only, correctly showed all 441. The mirror case (scope_type 'process', branch_id NULL)
 * has the same bug for branchScope, live for 20 active process-manager accounts.
 */
describe("resolveFullScope: an assignment grant on one dimension does not narrow another", () => {
  beforeEach(() => dbExecute.mockReset());

  it("a branch-only grant does not narrow processScope to the caller's own process", async () => {
    mockScope({
      roleKey: "branch_head",
      assignmentRows: [{ scope_type: "branch", branch_id: BRANCH_ID, process_id: null }],
    });
    const scope = await resolveFullScope(USER_ID);
    expect(scope.branchScope).toEqual({ mode: "restricted", ids: [BRANCH_ID] });
    expect(scope.processScope).toEqual({ mode: "all", ids: [] });
  });

  it("a process-only grant does not narrow branchScope to the caller's own branch", async () => {
    mockScope({
      roleKey: "process_manager",
      assignmentRows: [{ scope_type: "process", branch_id: null, process_id: PROCESS_ID }],
    });
    const scope = await resolveFullScope(USER_ID);
    expect(scope.processScope).toEqual({ mode: "restricted", ids: [PROCESS_ID] });
    expect(scope.branchScope).toEqual({ mode: "all", ids: [] });
  });

  it("an explicit grant on both dimensions still restricts both (unchanged behaviour)", async () => {
    mockScope({
      roleKey: "branch_head",
      assignmentRows: [{ scope_type: "branch", branch_id: BRANCH_ID, process_id: PROCESS_ID }],
    });
    const scope = await resolveFullScope(USER_ID);
    expect(scope.branchScope).toEqual({ mode: "restricted", ids: [BRANCH_ID] });
    expect(scope.processScope).toEqual({ mode: "restricted", ids: [PROCESS_ID] });
  });

  it("no assignment row at all still falls back to the caller's own employee record", async () => {
    mockScope({ roleKey: "employee", assignmentRows: [] });
    const scope = await resolveFullScope(USER_ID);
    expect(scope.branchScope).toEqual({ mode: "restricted", ids: [BRANCH_ID] });
    expect(scope.processScope).toEqual({ mode: "restricted", ids: [PROCESS_ID] });
  });

  it("no assignment row and no employee record fails closed, never dimAll()", async () => {
    mockScope({ roleKey: "employee", assignmentRows: [], hasEmployee: false });
    const scope = await resolveFullScope(USER_ID);
    expect(scope.branchScope.mode).toBe("restricted");
    expect(scope.branchScope.ids).toEqual(["__NO_BRANCH_SCOPE__"]);
  });
});
