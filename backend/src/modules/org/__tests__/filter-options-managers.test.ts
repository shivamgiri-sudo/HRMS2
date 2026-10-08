import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

let roles: string[] = [];

vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.authUser = { id: "user-1", roles, isDemo: false };
    next();
  },
}));

const svcStub = () => ({
  list: vi.fn().mockResolvedValue([]),
  getById: vi.fn().mockResolvedValue({ id: "d1" }),
  create: vi.fn().mockResolvedValue({ id: "d1" }),
  update: vi.fn().mockResolvedValue({ id: "d1" }),
  delete: vi.fn().mockResolvedValue(undefined),
  setStatus: vi.fn().mockResolvedValue(undefined),
  countOrphanedRecords: vi.fn().mockResolvedValue({ total: 0, orphaned: 0 }),
  getCallCentreCodeMap: vi.fn().mockResolvedValue({}),
});

vi.mock("../org.service.js", () => ({
  branchService: svcStub(),
  departmentService: svcStub(),
  lobService: svcStub(),
  designationService: svcStub(),
  campaignService: svcStub(),
  costCentreService: svcStub(),
  gradeBandService: svcStub(),
  locationService: svcStub(),
  policyService: svcStub(),
  processService: svcStub(),
}));

const executeMock = vi.fn().mockResolvedValue([[{ id: "m1", employee_code: "MAS1", full_name: "Boss" }], []]);
vi.mock("../../../db/mysql.js", () => ({ db: { execute: (...a: unknown[]) => executeMock(...a) } }));

const { orgRouter } = await import("../org.routes.js");

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api/org", orgRouter);
  return a;
}


describe("GET /api/org/filter-options manager list query", () => {
  it("avoids the cross-column OR EXISTS (full-scan) shape and still returns managers", async () => {
    roles = ["hr"];
    const res = await request(app()).get("/api/org/filter-options");
    expect(res.status).toBe(200);
    expect(res.body.data.managers).toEqual([{ id: "m1", employee_code: "MAS1", full_name: "Boss" }]);
    const sql = String(executeMock.mock.calls[0][0]);
    expect(sql).not.toMatch(/reporting_manager_id\s*=\s*e\.id\s+OR/i);
    expect(sql).toMatch(/GROUP BY reporting_manager_id/);
    expect(sql).toMatch(/UNION/);
    expect(sql).toMatch(/GROUP BY manager_id/);
  });
});
