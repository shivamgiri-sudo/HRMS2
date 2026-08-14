import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * HRMS2 delta-audit, 2026-08-14 (P0, quality_perf_peopleexp_workinbox cluster):
 * GET /api/career/pip had no server-side scope check for non-privileged callers.
 * The route trusted the `employee_id` query param outright — any authenticated
 * user could read any other employee's PIP (reason/outcome/review_notes) by
 * supplying an arbitrary employee_id, regardless of whether they actually
 * managed that employee. UI-level roles={['admin','hr','super_admin','manager']}
 * on /pip-management is not enforced server-side, so it provided no real
 * protection (backend authorization is mandatory per CLAUDE.md rule #6).
 *
 * Fix approved same session (Section H, P0 #3). This pins the real fix: a
 * non-privileged caller only gets PIP data back when they are the target
 * employee's actual reporting_manager_id — verified server-side against
 * `employees`, not merely "an employee_id was supplied".
 */

const { hasRole, getEmployeeForUser } = vi.hoisted(() => ({
  hasRole: vi.fn(async () => false),
  getEmployeeForUser: vi.fn(async () => ({ id: "emp-caller-1", employee_code: "E-CALLER" })),
}));
vi.mock("../../../shared/accessGuard.js", () => ({ hasRole, getEmployeeForUser }));

const { dbExecute } = vi.hoisted(() => ({
  dbExecute: vi.fn(async (sql: string, params: unknown[]) => {
    // isManagerOf()'s lookup: does the target employee report to this caller?
    if (/SELECT 1\s+FROM employees\s+WHERE id = \?\s+AND reporting_manager_id = \?/i.test(sql)) {
      const [targetId, managerId] = params as [string, string];
      if (targetId === "emp-my-report" && managerId === "emp-caller-1") {
        return [[{ 1: 1 }], []];
      }
      return [[], []];
    }
    return [[], []];
  }),
}));
vi.mock("../../../db/mysql.js", () => ({
  db: { execute: dbExecute, query: dbExecute, getConnection: vi.fn() },
}));

const { listPips, isManagerOf } = vi.hoisted(() => ({
  listPips: vi.fn(async () => [{ id: "pip-1", employee_id: "target", reason: "confidential" }]),
  isManagerOf: vi.fn(async (managerId: string, targetId: string) =>
    managerId === "emp-caller-1" && targetId === "emp-my-report"
  ),
}));
vi.mock("../career.service.js", () => ({
  careerService: {
    listPips,
    isManagerOf,
    getCareerPath: vi.fn(),
    upsertCareerPath: vi.fn(),
    listAllCareerPaths: vi.fn(),
  },
}));

const actor = { id: "u-caller-1", role: "employee", roles: ["employee"] };
vi.mock("../../../middleware/authMiddleware.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../middleware/authMiddleware.js")>();
  return {
    ...original,
    requireAuth: (req: any, _res: any, next: any) => { req.authUser = actor; next(); },
  };
});

import { careerRouter } from "../career.routes.js";

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api/career", careerRouter);
  return a;
}

beforeEach(() => {
  hasRole.mockClear().mockResolvedValue(false);
  getEmployeeForUser.mockClear().mockResolvedValue({ id: "emp-caller-1", employee_code: "E-CALLER" });
  dbExecute.mockClear();
  listPips.mockClear().mockResolvedValue([{ id: "pip-1", employee_id: "target", reason: "confidential" }]);
  isManagerOf.mockClear().mockImplementation(
    async (managerId: string, targetId: string) => managerId === "emp-caller-1" && targetId === "emp-my-report"
  );
});

describe("GET /api/career/pip — row scope for non-privileged callers", () => {
  it("refuses an arbitrary employee_id that is not the caller's report", async () => {
    const res = await request(app()).get("/api/career/pip?employee_id=some-other-employee");
    expect(res.status).toBe(403);
    expect(listPips).not.toHaveBeenCalled();
  });

  it("allows a manager to see PIPs for their own actual report", async () => {
    const res = await request(app()).get("/api/career/pip?employee_id=emp-my-report");
    expect(res.status).toBe(200);
    expect(listPips).toHaveBeenCalledWith(
      expect.objectContaining({ employeeId: "emp-my-report" })
    );
  });

  it("still returns [] rather than 403 when no employee_id is supplied at all (unchanged behaviour)", async () => {
    const res = await request(app()).get("/api/career/pip");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(listPips).not.toHaveBeenCalled();
  });

  it("admin/hr still see everything regardless of employee_id", async () => {
    hasRole.mockResolvedValueOnce(true);
    const res = await request(app()).get("/api/career/pip?employee_id=anyone-at-all");
    expect(res.status).toBe(200);
    expect(listPips).toHaveBeenCalledWith(
      expect.objectContaining({ employeeId: "anyone-at-all" })
    );
  });
});
