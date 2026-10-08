import { describe, expect, it, vi } from "vitest";

/**
 * narrowDashboardScope() previously cleared whichever scope dimension the caller did
 * NOT supply, instead of carrying the resolved scope's own value forward. A
 * PROCESS_ALL-scoped role (e.g. a Process Manager assigned to one process) filtering
 * their dashboard down to a single branch via ?branchId=... got back
 * { branchIds: [branchId], processIds: [] } — the process restriction silently dropped,
 * so buildScopeWhere's CUSTOM_SCOPE branch skips the process clause entirely and the
 * user sees every process at that branch, not just their own. The same widening ran in
 * the opposite direction for a BRANCH_ALL role narrowing by process alone.
 *
 * Verified exploitable against real production grants: 5 users hold role
 * `process_manager` scoped to process "BACK OFFICE" only, and branches such as Delhi
 * Office and NOIDA run 10-20 other processes alongside BACK OFFICE.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

import { narrowDashboardScope, type DashboardScope } from "../../../shared/dashboardScope.js";

function scope(overrides: Partial<DashboardScope>): DashboardScope {
  return {
    level: "ORG_ALL",
    branchIds: [],
    processIds: [],
    employeeIds: [],
    userId: "user-1",
    role: "employee",
    ...overrides,
  };
}

/** Every existence/membership check narrowDashboardScope runs answers "valid". */
function wireAllValid() {
  execute.mockReset();
  execute.mockResolvedValue([[{ id: "ok" }], []]);
}

describe("narrowDashboardScope", () => {
  it("keeps a PROCESS_ALL scope's process restriction when narrowing by branch alone", async () => {
    wireAllValid();
    const base = scope({
      level: "PROCESS_ALL",
      branchIds: ["branch-delhi", "branch-noida"],
      processIds: ["process-back-office"],
      role: "process_manager",
    });

    const narrowed = await narrowDashboardScope(base, "branch-delhi", null);

    expect(narrowed.branchIds).toEqual(["branch-delhi"]);
    // The regression: this used to be [], which widened visibility to every process
    // running at branch-delhi instead of just this user's own process.
    expect(narrowed.processIds).toEqual(["process-back-office"]);
  });

  it("keeps a BRANCH_ALL scope's branch restriction when narrowing by process alone", async () => {
    wireAllValid();
    const base = scope({
      level: "BRANCH_ALL",
      branchIds: ["branch-mohali"],
      processIds: [],
      role: "branch_head",
    });

    const narrowed = await narrowDashboardScope(base, null, "process-back-office");

    // The regression: this used to be [], which widened visibility to every branch
    // running that process instead of just this branch head's own branch.
    expect(narrowed.branchIds).toEqual(["branch-mohali"]);
    expect(narrowed.processIds).toEqual(["process-back-office"]);
  });

  it("still narrows to exactly what was requested when both branch and process are supplied", async () => {
    wireAllValid();
    const base = scope({
      level: "PROCESS_ALL",
      branchIds: ["branch-delhi", "branch-noida"],
      processIds: ["process-a", "process-b"],
      role: "process_manager",
    });

    const narrowed = await narrowDashboardScope(base, "branch-delhi", "process-a");

    expect(narrowed.branchIds).toEqual(["branch-delhi"]);
    expect(narrowed.processIds).toEqual(["process-a"]);
  });

  it("does not narrow a TEAM_ONLY or SELF_ONLY scope at all", async () => {
    wireAllValid();
    const team = scope({ level: "TEAM_ONLY", employeeIds: ["emp-2", "emp-3"] });
    const self = scope({ level: "SELF_ONLY", employeeIds: ["emp-1"] });

    expect(await narrowDashboardScope(team, "any-branch", "any-process")).toBe(team);
    expect(await narrowDashboardScope(self, "any-branch", "any-process")).toBe(self);
  });

  it("still denies a branch outside a BRANCH_ALL scope's own grant", async () => {
    wireAllValid();
    const base = scope({ level: "BRANCH_ALL", branchIds: ["branch-mohali"], role: "branch_head" });

    const narrowed = await narrowDashboardScope(base, "branch-not-mine", null);

    expect(narrowed.level).toBe("CUSTOM_SCOPE");
    expect(narrowed.branchIds).toEqual([]);
    expect(narrowed.processIds).toEqual([]);
  });

  it("still denies a process outside a PROCESS_ALL scope's own grant", async () => {
    wireAllValid();
    const base = scope({ level: "PROCESS_ALL", processIds: ["process-mine"], role: "process_manager" });

    const narrowed = await narrowDashboardScope(base, null, "process-not-mine");

    expect(narrowed.level).toBe("CUSTOM_SCOPE");
    expect(narrowed.branchIds).toEqual([]);
    expect(narrowed.processIds).toEqual([]);
  });

  it("returns the org-wide scope unchanged when no branch/process is requested", async () => {
    wireAllValid();
    const base = scope({ level: "ORG_ALL" });
    expect(await narrowDashboardScope(base, null, null)).toBe(base);
  });
});
