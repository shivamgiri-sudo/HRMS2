import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchSheet = vi.fn();
const countSheetEmployees = vi.fn();

vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.authUser = { id: "u1" };
    next();
  },
}));
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../../../shared/enterpriseScope.js", () => ({
  resolveUserBusinessScope: vi.fn(async () => ({})),
  buildEmployeeScopeCondition: vi.fn(() => ({
    sql: "e.branch_id = ?",
    params: ["b1"],
  })),
}));
vi.mock("../attendance-source-sheet.service.js", async (orig) => ({
  ...(await orig<typeof import("../attendance-source-sheet.service.js")>()),
  fetchSheet: (...a: unknown[]) => fetchSheet(...a),
  countSheetEmployees: (...a: unknown[]) => countSheetEmployees(...a),
}));

import { attendanceSourceSheetRouter } from "../attendance-source-sheet.routes.js";

const app = express();
app.use("/sheet", attendanceSourceSheetRouter);

const employee = {
  employeeId: "e1",
  employeeCode: "MAS10000",
  employeeName: "XYZ",
  branch: "Noida",
  costCentre: "CC1",
  process: "P",
  lob: null,
  attendanceSource: "APR",
  days: {
    "2026-09-01": {
      code: "P",
      status: "present",
      cosecMinutes: 540,
      aprMinutes: 485,
      payrollSource: "apr",
    },
  },
};

describe("attendance source sheet routes", () => {
  beforeEach(() => {
    fetchSheet.mockReset();
    countSheetEmployees.mockReset();
    fetchSheet.mockResolvedValue([employee]);
    countSheetEmployees.mockResolvedValue(1);
  });

  it("rejects a missing or malformed month", async () => {
    expect((await request(app).get("/sheet")).status).toBe(400);
    expect((await request(app).get("/sheet?month=Sep-26")).status).toBe(400);
  });

  it("rejects an id filter that is not a plain id", async () => {
    const res = await request(app).get(
      "/sheet?month=2026-09&branchId=x'%20OR%201=1",
    );
    expect(res.status).toBe(400);
    expect(fetchSheet).not.toHaveBeenCalled();
  });

  it("returns the month's days and employees, scoped and paged", async () => {
    const res = await request(app).get(
      "/sheet?month=2026-09&page=2&limit=25&search=xyz",
    );
    expect(res.status).toBe(200);
    expect(res.body.data.days).toHaveLength(30);
    expect(res.body.data.employees[0].employeeCode).toBe("MAS10000");
    expect(res.body.total).toBe(1);
    const [filters, scope, page] = fetchSheet.mock.calls[0];
    expect(filters).toMatchObject({ month: "2026-09", search: "xyz" });
    expect(scope).toEqual({ sql: "e.branch_id = ?", params: ["b1"] });
    expect(page).toEqual({ limit: 25, offset: 25 });
  });

  it("caps the page size", async () => {
    await request(app).get("/sheet?month=2026-09&limit=99999");
    expect(fetchSheet.mock.calls[0][2].limit).toBe(200);
  });

  it("exports an xlsx attachment", async () => {
    const res = await request(app)
      .get("/sheet/export?month=2026-09")
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("spreadsheetml.sheet");
    expect(res.headers["content-disposition"]).toContain(
      "attendance-source-sheet-2026-09.xlsx",
    );
    // xlsx is a zip: "PK"
    expect((res.body as Buffer).subarray(0, 2).toString()).toBe("PK");
  });

  it("refuses an export larger than the cap instead of truncating it", async () => {
    countSheetEmployees.mockResolvedValue(5001);
    const res = await request(app).get("/sheet/export?month=2026-09");
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/limited to 5000/);
    expect(fetchSheet).not.toHaveBeenCalled();
  });
});
