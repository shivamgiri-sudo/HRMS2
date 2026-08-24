import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Task 7: GET /api/performance-scorecard — RBAC-scoped route over
 * employee_performance_daily_snapshot (Task 1's table).
 *
 * Role list is security-sensitive: matches dashboardAccessRegistry.ts's
 * PERFORMANCE_SCORECARD.allowedRoleKeys exactly. Deliberately excludes
 * "admin" and "wfm" — see Task 5's 2026-08-22 production-incident fix
 * (dashboard-access-registry.test.ts) restricting admin to
 * EMPLOYEE_SELF_DASHBOARD only, and PERFORMANCE_SCORECARD's registry entry
 * not including wfm.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({
  db: { execute, query: execute, getConnection: vi.fn() },
}));

vi.mock("../../../shared/accessGuard.js", () => ({
  hasRole: vi.fn(async (_userId: string, ...roles: string[]) =>
    roles.some((r) => ["manager"].includes(r))
  ),
  getEmployeeForUser: vi.fn(async () => ({ id: "emp-mgr-1" })),
}));

vi.mock("../../management/management.service.js", () => ({
  managementService: {
    getDirectReportIds: vi.fn(async () => ["emp-report-1"]),
  },
}));

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

beforeEach(() => {
  execute.mockReset().mockResolvedValue([[], []]);
  actorRoles = ["manager"];
});

describe("GET /api/performance-scorecard", () => {
  it("returns snapshot rows scoped to the caller's manager chain", async () => {
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
  });

  it("returns 400 when dateFrom or dateTo is missing", async () => {
    const res = await request(app()).get("/api/performance-scorecard");
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("a role with no grant at all gets 403", async () => {
    actorRoles = ["employee"];
    const res = await request(app())
      .get("/api/performance-scorecard")
      .query({ dateFrom: "2026-08-01", dateTo: "2026-08-24" });
    expect(res.status).toBe(403);
  });
});
