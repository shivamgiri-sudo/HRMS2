import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveMock = vi.fn();
const executeMock = vi.fn();

vi.mock("../../../shared/dashboardScope.js", () => {
  class DashboardScopeConfigurationError extends Error {}
  return {
    DashboardScopeConfigurationError,
    resolveDashboardScopeForRequest: (...a: unknown[]) => resolveMock(...a),
  };
});
vi.mock("../../../db/mysql.js", () => ({
  db: { execute: (...a: unknown[]) => executeMock(...a) },
}));

import { DashboardScopeConfigurationError } from "../../../shared/dashboardScope.js";
import { resolveWfmScope } from "../wfm-scope-fallback.js";

describe("resolveWfmScope", () => {
  beforeEach(() => {
    resolveMock.mockReset();
    executeMock.mockReset();
  });

  it("returns the shared scope untouched when it resolves", async () => {
    const scope = {
      level: "PROCESS_ALL",
      branchIds: [],
      processIds: ["p1"],
      employeeIds: [],
      userId: "u",
      role: "wfm",
    };
    resolveMock.mockResolvedValue(scope);
    expect(await resolveWfmScope({ id: "u", role: "wfm" })).toBe(scope);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("falls back to branch scope for a wfm user with only branch rows", async () => {
    resolveMock.mockRejectedValue(new DashboardScopeConfigurationError("no process"));
    executeMock.mockImplementation(async (sql: string) =>
      String(sql).includes("FROM employees") ? [[]] : [[{ branch_id: "b1" }, { branch_id: "b2" }]]);
    const scope = await resolveWfmScope({ id: "u", role: "wfm" });
    expect(scope.level).toBe("BRANCH_ALL");
    expect(scope.branchIds).toEqual(["b1", "b2"]);
  });

  it("is clamped to the branch on the user's own employee record (owner ruling 2026-10-01)", async () => {
    resolveMock.mockRejectedValue(new DashboardScopeConfigurationError("no process"));
    executeMock.mockImplementation(async (sql: string) =>
      String(sql).includes("FROM employees") ? [[{ branch_id: "b2" }]] : [[{ branch_id: "b1" }, { branch_id: "b2" }]]);
    expect((await resolveWfmScope({ id: "u", role: "wfm" })).branchIds).toEqual(["b2"]);
  });

  it("still fails closed when the wfm user has no branch rows", async () => {
    resolveMock.mockRejectedValue(
      new DashboardScopeConfigurationError("no process"),
    );
    executeMock.mockResolvedValue([[]]);
    await expect(
      resolveWfmScope({ id: "u", role: "wfm" }),
    ).rejects.toBeInstanceOf(DashboardScopeConfigurationError);
  });

  it("does not widen scope for roles outside the wfm family", async () => {
    resolveMock.mockRejectedValue(
      new DashboardScopeConfigurationError("no scope"),
    );
    await expect(
      resolveWfmScope({ id: "u", role: "team_leader" }),
    ).rejects.toBeInstanceOf(DashboardScopeConfigurationError);
    expect(executeMock).not.toHaveBeenCalled();
  });
});
