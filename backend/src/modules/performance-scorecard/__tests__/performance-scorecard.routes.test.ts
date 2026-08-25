import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getUserRoleContext } from "../../../shared/roleResolver.js";
import { resolveDashboardScope, DashboardScopeConfigurationError } from "../../../shared/dashboardScope.js";
import type { DashboardScope } from "../../../shared/dashboardScope.js";

/**
 * Task 7 backlog fix: GET /api/performance-scorecard now uses the shared
 * resolveDashboardScope + buildScopeWhereEmployees pattern (same as
 * performance-scorecard-drilldown.ts) instead of a locally-duplicated
 * direct-reports-only/org-wide-only resolver. This proves real branch/process
 * scoping (not just direct reports vs everyone) and preserves the prior
 * fail-closed 403 contract for an unresolvable scope.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({
  db: { execute, query: execute, getConnection: vi.fn() },
}));

vi.mock("../../../shared/roleResolver.js", () => ({
  getUserRoleContext: vi.fn(async () => ({
    roleKeys: ["manager"],
    primaryRole: "manager",
    isSuperAdmin: false,
    isHO: false,
  })),
}));

vi.mock("../../../shared/dashboardScope.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../shared/dashboardScope.js")>();
  return {
    ...original,
    resolveDashboardScope: vi.fn(),
  };
});

let actorRoles: string[] = ["manager"];
vi.mock("../../../middleware/authMiddleware.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../middleware/authMiddleware.js")>();
  return {
    ...original,
    requireAuth: (req: any, _res: any, next: any) => {
      req.authUser = { id: "u-mgr-1", role: actorRoles[0], roles: actorRoles };
      next();
    },
  };
});

import performanceScorecardRoutes from "../performance-scorecard.routes.js";

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api/performance-scorecard", performanceScorecardRoutes);
  return a;
}

const teamScope: DashboardScope = {
  level: "TEAM_ONLY",
  branchIds: [],
  processIds: [],
  employeeIds: ["emp-report-1"],
  userId: "u-mgr-1",
  role: "manager",
};

const branchScope: DashboardScope = {
  level: "BRANCH_ALL",
  branchIds: ["branch-noida-2"],
  processIds: [],
  employeeIds: [],
  userId: "u-branch-head-1",
  role: "branch_head",
};

const orgScope: DashboardScope = {
  level: "ORG_ALL",
  branchIds: [],
  processIds: [],
  employeeIds: [],
  userId: "u-ceo-1",
  role: "ceo",
};

beforeEach(() => {
  execute.mockReset().mockResolvedValue([[], []]);
  actorRoles = ["manager"];
  vi.mocked(resolveDashboardScope).mockReset().mockResolvedValue(teamScope);
  vi.mocked(getUserRoleContext).mockReset().mockResolvedValue({
    roleKeys: ["manager"],
    primaryRole: "manager",
    isSuperAdmin: false,
    isHO: false,
  });
});

describe("GET /api/performance-scorecard", () => {
  it("returns snapshot rows scoped to the caller's TEAM_ONLY scope", async () => {
    execute.mockResolvedValueOnce([
      [
        {
          employeeId: "emp-1",
          employeeName: "Test Employee",
          employeeCode: "EMP-1",
          snapshotDate: "2026-08-24",
          attendanceStatus: "present",
        },
      ],
      [],
    ]);

    const res = await request(app())
      .get("/api/performance-scorecard")
      .query({ dateFrom: "2026-08-01", dateTo: "2026-08-24" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].employeeId).toBe("emp-1");

    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain("e.id IN");
    expect(params).toContain("emp-report-1");
  });

  it("scopes a branch_head caller by BRANCH_ALL, not their direct reports — proves real branch scoping", async () => {
    actorRoles = ["branch_head"];
    vi.mocked(getUserRoleContext).mockResolvedValue({
      roleKeys: ["branch_head"],
      primaryRole: "branch_head",
      isSuperAdmin: false,
      isHO: false,
    });
    vi.mocked(resolveDashboardScope).mockResolvedValue(branchScope);
    execute.mockResolvedValueOnce([[], []]);

    const res = await request(app())
      .get("/api/performance-scorecard")
      .query({ dateFrom: "2026-08-01", dateTo: "2026-08-24" });

    expect(res.status).toBe(200);
    expect(vi.mocked(resolveDashboardScope)).toHaveBeenCalledWith("u-mgr-1", "branch_head");

    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain("e.branch_id IN");
    expect(sql).not.toContain("e.id IN");
    expect(params).toEqual(["2026-08-01", "2026-08-24", "branch-noida-2"]);
  });

  it("returns 400 when dateFrom or dateTo is missing", async () => {
    const res = await request(app()).get("/api/performance-scorecard");
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("a role with no grant at all gets 403 from requireRole before scope is ever resolved", async () => {
    actorRoles = ["employee"];
    const res = await request(app())
      .get("/api/performance-scorecard")
      .query({ dateFrom: "2026-08-01", dateTo: "2026-08-24" });
    expect(res.status).toBe(403);
    expect(vi.mocked(resolveDashboardScope)).not.toHaveBeenCalled();
  });

  it("fails closed with 403 when resolveDashboardScope cannot resolve any scope", async () => {
    vi.mocked(resolveDashboardScope).mockRejectedValue(
      new DashboardScopeConfigurationError("manager", "reporting hierarchy"),
    );

    const res = await request(app())
      .get("/api/performance-scorecard")
      .query({ dateFrom: "2026-08-01", dateTo: "2026-08-24" });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it("returns 200 with an empty array when the caller's team scope has no resolved employees", async () => {
    vi.mocked(resolveDashboardScope).mockResolvedValue({ ...teamScope, employeeIds: [] });

    const res = await request(app())
      .get("/api/performance-scorecard")
      .query({ dateFrom: "2026-08-01", dateTo: "2026-08-24" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: [] });
    expect(execute).not.toHaveBeenCalled();
  });

  it("an ORG_ALL scope (ceo/coo/management/super_admin) applies no employee filter", async () => {
    actorRoles = ["ceo"];
    vi.mocked(getUserRoleContext).mockResolvedValue({
      roleKeys: ["ceo"],
      primaryRole: "ceo",
      isSuperAdmin: false,
      isHO: true,
    });
    vi.mocked(resolveDashboardScope).mockResolvedValue(orgScope);
    execute.mockResolvedValueOnce([[], []]);

    const res = await request(app())
      .get("/api/performance-scorecard")
      .query({ dateFrom: "2026-08-01", dateTo: "2026-08-24" });

    expect(res.status).toBe(200);
    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain("1=1");
    expect(params).toEqual(["2026-08-01", "2026-08-24"]);
  });
});
