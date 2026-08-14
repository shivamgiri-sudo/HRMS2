import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardScope } from "../../../shared/dashboardScope.js";

/**
 * HRMS2 delta-audit, 2026-08-14 (P1, quality cluster): the level-5 drill
 * (GET /analyst/:employeeId/calls) route only checked scope for SELF_ONLY/
 * TEAM_ONLY, its own special case — a BRANCH_ALL, PROCESS_ALL or
 * CUSTOM_SCOPE caller could pass any employeeId and read that employee's
 * individually audited calls (including areasForImprovement — performance
 * feedback text) regardless of branch/process membership. Fixed by moving
 * the scope check into analystCalls itself, reusing the exact same
 * isEmployeeInScope logic scopedUserRows already uses for the other 4 drill
 * levels, so this and the aggregate levels can never define "in scope"
 * differently again.
 */

const { dbExecute } = vi.hoisted(() => ({
  dbExecute: vi.fn(async (sql: string) => {
    if (/FROM employees WHERE id = \?/i.test(sql)) {
      return [[{
        id: "emp-target-1", full_name: "Target Employee", employee_code: "E-TARGET",
        branch_id: "branch-B", process_id: "process-X", active_status: 1,
      }], []];
    }
    return [[], []];
  }),
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));

const { querySource } = vi.hoisted(() => ({
  querySource: vi.fn(async () => [
    { id: 1, ClientId: "c1", CallDate: "2026-08-01", quality_percentage: "90", total_score: 9, max_score: 10, areas_for_improvement: "none" },
  ]),
}));
vi.mock("../../../db/sourceDb.js", () => ({ querySource }));

vi.mock("../../../logger.js", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import { qualityDashboardV2Service } from "../quality-dashboard-v2.service.js";

function scope(overrides: Partial<DashboardScope>): DashboardScope {
  return { level: "BRANCH_ALL", branchIds: [], processIds: [], employeeIds: [], userId: "u-1", role: "branch_head", ...overrides };
}

beforeEach(() => {
  dbExecute.mockClear();
  querySource.mockClear();
});

describe("analystCalls — scope enforced for every level, not just SELF_ONLY/TEAM_ONLY", () => {
  it("BRANCH_ALL caller whose branch does NOT include the target employee gets employee:null, no call data", async () => {
    const result = await qualityDashboardV2Service.analystCalls(
      "emp-target-1", 30, scope({ level: "BRANCH_ALL", branchIds: ["branch-OTHER"] })
    );
    expect(result.employee).toBeNull();
    expect(result.calls).toEqual([]);
    expect(querySource).not.toHaveBeenCalled();
  });

  it("BRANCH_ALL caller whose branch DOES include the target employee gets real data", async () => {
    const result = await qualityDashboardV2Service.analystCalls(
      "emp-target-1", 30, scope({ level: "BRANCH_ALL", branchIds: ["branch-B"] })
    );
    expect(result.employee?.id).toBe("emp-target-1");
    expect(result.calls.length).toBe(1);
  });

  it("PROCESS_ALL caller outside the target's process is refused (was previously unchecked entirely)", async () => {
    const result = await qualityDashboardV2Service.analystCalls(
      "emp-target-1", 30, scope({ level: "PROCESS_ALL", processIds: ["process-OTHER"] })
    );
    expect(result.employee).toBeNull();
    expect(querySource).not.toHaveBeenCalled();
  });

  it("CUSTOM_SCOPE caller outside both configured branch and process is refused", async () => {
    const result = await qualityDashboardV2Service.analystCalls(
      "emp-target-1", 30, scope({ level: "CUSTOM_SCOPE", branchIds: ["branch-OTHER"], processIds: ["process-OTHER"] })
    );
    expect(result.employee).toBeNull();
  });

  it("ORG_ALL caller always sees the target regardless of branch/process", async () => {
    const result = await qualityDashboardV2Service.analystCalls("emp-target-1", 30, scope({ level: "ORG_ALL" }));
    expect(result.employee?.id).toBe("emp-target-1");
  });

  it("SELF_ONLY/TEAM_ONLY behaviour (the route's original check) still works via the shared path", async () => {
    const denied = await qualityDashboardV2Service.analystCalls(
      "emp-target-1", 30, scope({ level: "TEAM_ONLY", employeeIds: ["some-other-emp"] })
    );
    expect(denied.employee).toBeNull();

    const allowed = await qualityDashboardV2Service.analystCalls(
      "emp-target-1", 30, scope({ level: "TEAM_ONLY", employeeIds: ["emp-target-1"] })
    );
    expect(allowed.employee?.id).toBe("emp-target-1");
  });
});
