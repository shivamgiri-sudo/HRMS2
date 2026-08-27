import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The fifth door onto department_master, and the one that would have made the rest of the lock
 * cosmetic.
 *
 * org.routes.ts restricts department create/rename/delete to super_admin, and all four UI
 * surfaces hide their write controls to match. But import_department_upload_batch runs
 * INSERT ... ON DUPLICATE KEY UPDATE dept_name = VALUES(dept_name) — so a spreadsheet row
 * carrying an existing dept_code RENAMES that department — and the generic bulk-upload guard
 * admits admin, hr, wfm, wfm_analyst, payroll and payroll_hr. Every role just locked out of the
 * Departments page could have renamed a department by uploading a file instead.
 *
 * assertDepartmentStructureUploader closes it. Note it is deliberately stricter than
 * assertGatedUploader, which admits branch WFM alongside Super Admin: that is right for leave
 * and deduction batches and wrong for the org chart.
 */

const BATCH_ID = "batch-1";
let actor = "user-1";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: actor }; next(); },
}));
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

// The real gate under test reads roles through scopeAccess.hasAnyRole.
let roles: string[] = [];
vi.mock("../../../shared/scopeAccess.js", () => ({
  hasAnyRole: async (_userId: string, ...wanted: string[]) =>
    roles.includes("super_admin") || wanted.some((r) => roles.includes(r)),
}));

const { importDepartmentMasterBatch } = vi.hoisted(() => ({ importDepartmentMasterBatch: vi.fn() }));
vi.mock("../department-master-bulk.service.js", () => ({ importDepartmentMasterBatch }));

const { bulkUploadRouter } = await import("../bulk-upload.routes.js");

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api/bulk-upload", bulkUploadRouter);
  // Surface the thrown statusCode the way the app's error handler does.
  a.use((err: any, _req: any, res: any, _next: any) =>
    res.status(err?.statusCode ?? 500).json({ success: false, error: String(err?.message ?? err) }));
  return a;
}

const importDepartments = () =>
  request(app())
    .post(`/api/bulk-upload/batches/${BATCH_ID}/import`)
    .send({ rpc_name: "import_department_upload_batch" });

beforeEach(() => {
  roles = [];
  actor = "user-1";
  execute.mockReset().mockResolvedValue([{ affectedRows: 1 }, []]);
  importDepartmentMasterBatch.mockReset().mockResolvedValue({ importedRows: 3, errorRows: 0, errors: [] });
});

describe("bulk department upload is super_admin-only", () => {
  for (const role of ["hr", "admin", "wfm", "wfm_analyst", "payroll", "payroll_hr"]) {
    it(`refuses a department upload from ${role}`, async () => {
      roles = [role];
      const res = await importDepartments();
      expect(res.status).toBe(403);
      expect(importDepartmentMasterBatch).not.toHaveBeenCalled();
    });
  }

  it("allows a department upload from super_admin", async () => {
    roles = ["super_admin"];
    const res = await importDepartments();
    expect(res.status).toBe(200);
    expect(importDepartmentMasterBatch).toHaveBeenCalledWith(BATCH_ID, "user-1");
  });
});

describe("other bulk imports are unaffected", () => {
  it("still lets hr import an official email batch", async () => {
    roles = ["hr"];
    const res = await request(app())
      .post(`/api/bulk-upload/batches/${BATCH_ID}/import`)
      .send({ rpc_name: "import_official_email_update_batch" });
    expect(res.status).not.toBe(403);
  });
});
