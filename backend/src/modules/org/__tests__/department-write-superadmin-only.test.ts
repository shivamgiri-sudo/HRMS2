import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * department_master sat on the org-masters default gate — requireRole("admin","hr") to create
 * or rename, requireRole("admin") to delete — which on live data (2026-08-27) meant 17 accounts
 * could rename a department and 3 could delete one, 16 of the 17 being branch HR. A department
 * is org structure: every employee record, payroll cost mapping, requisition and report filter
 * resolves through it, and there is no undo. It is now super_admin-only.
 *
 * The single carve-out is EmployeeEditDialog, which PUTs `{ manager_id }` to this same endpoint
 * when HR ticks "department head" on an employee. That is an employee edit, so admin/hr keep it
 * — but only when manager_id is the entire body, so a rename cannot ride along inside a
 * head-assignment call.
 *
 * These cases fail against the old gate: every 403 below was a 200/201 before the change, and
 * the head-assignment 200 would have been a 403 had the lock been applied without the carve-out.
 */

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

vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn().mockResolvedValue([[], []]) } }));

const { orgRouter } = await import("../org.routes.js");

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api/org", orgRouter);
  return a;
}

beforeEach(() => { roles = []; });

describe("department_master writes are super_admin-only", () => {
  it("refuses a create from hr", async () => {
    roles = ["hr"];
    const res = await request(app())
      .post("/api/org/departments")
      .send({ dept_name: "Engineering", dept_code: "ENG" });
    expect(res.status).toBe(403);
  });

  it("refuses a create from admin", async () => {
    roles = ["admin"];
    const res = await request(app())
      .post("/api/org/departments")
      .send({ dept_name: "Engineering", dept_code: "ENG" });
    expect(res.status).toBe(403);
  });

  it("refuses a rename from hr", async () => {
    roles = ["hr"];
    const res = await request(app())
      .put("/api/org/departments/d1")
      .send({ dept_name: "Renamed" });
    expect(res.status).toBe(403);
  });

  it("refuses a delete from admin", async () => {
    roles = ["admin"];
    const res = await request(app()).delete("/api/org/departments/d1");
    expect(res.status).toBe(403);
  });

  it("refuses a deactivate from hr", async () => {
    roles = ["hr"];
    const res = await request(app())
      .patch("/api/org/departments/d1/status")
      .send({ active_status: 0 });
    expect(res.status).toBe(403);
  });

  it("allows super_admin to create", async () => {
    roles = ["super_admin"];
    const res = await request(app())
      .post("/api/org/departments")
      .send({ dept_name: "Engineering", dept_code: "ENG" });
    expect(res.status).toBe(201);
  });

  it("allows super_admin to delete", async () => {
    roles = ["super_admin"];
    const res = await request(app()).delete("/api/org/departments/d1");
    expect(res.status).toBe(200);
  });
});

describe("the EmployeeEditDialog head-assignment carve-out", () => {
  it("lets hr set a department head, because manager_id is the whole body", async () => {
    roles = ["hr"];
    const res = await request(app())
      .put("/api/org/departments/d1")
      .send({ manager_id: "emp-1" });
    expect(res.status).toBe(200);
  });

  it("lets hr clear a department head", async () => {
    roles = ["hr"];
    const res = await request(app())
      .put("/api/org/departments/d1")
      .send({ manager_id: null });
    expect(res.status).toBe(200);
  });

  it("refuses a rename smuggled alongside manager_id", async () => {
    roles = ["hr"];
    const res = await request(app())
      .put("/api/org/departments/d1")
      .send({ manager_id: "emp-1", dept_name: "Renamed" });
    expect(res.status).toBe(403);
  });

  it("refuses an empty body from hr rather than treating it as a head assignment", async () => {
    roles = ["hr"];
    const res = await request(app()).put("/api/org/departments/d1").send({});
    expect(res.status).toBe(403);
  });
});

describe("the other org masters keep the existing admin/hr gate", () => {
  it("still lets hr create a designation", async () => {
    roles = ["hr"];
    const res = await request(app())
      .post("/api/org/designations")
      .send({ designation_name: "Analyst", designation_code: "ANL" });
    expect(res.status).toBe(201);
  });

  it("still lets hr rename a campaign", async () => {
    roles = ["hr"];
    const res = await request(app())
      .put("/api/org/campaigns/c1")
      .send({ campaign_name: "Renamed" });
    expect(res.status).toBe(200);
  });

  it("still lets admin delete a lob", async () => {
    roles = ["admin"];
    const res = await request(app()).delete("/api/org/lobs/l1");
    expect(res.status).toBe(200);
  });
});

describe("reads stay open, because every dropdown in the app resolves through them", () => {
  it("lets a plain employee list departments", async () => {
    roles = ["employee"];
    const res = await request(app()).get("/api/org/departments");
    expect(res.status).toBe(200);
  });
});
