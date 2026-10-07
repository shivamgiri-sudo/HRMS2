import express from "express";
import request from "supertest";
import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * GET /api/wfm/attendance/apr-bulk-upload/batches — the Upload_Batch history screen
 * (requirements.md criterion 17.13) that the evidence-attribution work made possible but
 * never surfaced: every batch createAprBulkUploadBatch() writes was, until this route,
 * only ever readable by querying the database directly.
 */
const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.authUser = { id: "u1" };
    next();
  },
}));
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole:
    (...roles: string[]) =>
    (req: any, res: any, next: any) => {
      const role = String(req.headers["x-test-role"] ?? "wfm");
      if (!roles.includes(role))
        return res.status(403).json({ success: false, message: "Forbidden" });
      next();
    },
}));
vi.mock("../attendance-engine.service.js", () => ({
  isOperationsExecutiveByRegex: () => true,
  classifyOperationsNetLogin: () => ({ status: "present", lwpValue: 0 }),
  resolveHalfDayFloorMinutes: async () => 240,
}));

const { attendanceAprBulkRouter } =
  await import("../attendance-apr-bulk.routes.js");

function app() {
  const a = express();
  a.use("/api/wfm/attendance", attendanceAprBulkRouter);
  return a;
}

const SAMPLE_ROW = {
  id: "batch-1",
  batch_reference: "batch-1",
  file_name: "july-apr.csv",
  date_from: "2026-07-01",
  date_to: "2026-07-31",
  submitted_at: "2026-07-01 10:00:00",
  submitted_row_count: 100,
  accepted_row_count: 95,
  rejected_row_count: 5,
  status: "accepted",
  supersedes_batch_id: null,
  superseded_by_batch_id: null,
  dialler_source_name: "APR Bulk (Manual)",
  branch_name: "Noida",
  process_name: "Onfido",
  uploaded_by_name: "Priya Sharma",
};

beforeEach(() => {
  execute.mockReset();
});

describe("GET /api/wfm/attendance/apr-bulk-upload/batches", () => {
  it("returns the batch history for a wfm/hr/payroll_head/super_admin/admin caller", async () => {
    execute.mockResolvedValueOnce([[SAMPLE_ROW]]);

    const res = await request(app()).get(
      "/api/wfm/attendance/apr-bulk-upload/batches",
    );

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([SAMPLE_ROW]);
  });

  it("rejects a caller outside the upload roles", async () => {
    const res = await request(app())
      .get("/api/wfm/attendance/apr-bulk-upload/batches")
      .set("x-test-role", "employee");

    expect(res.status).toBe(403);
    expect(execute).not.toHaveBeenCalled();
  });

  it("filters by branchId, processId and status when given", async () => {
    execute.mockResolvedValueOnce([[]]);

    await request(app()).get(
      "/api/wfm/attendance/apr-bulk-upload/batches?branchId=branch-1&processId=process-1&status=accepted",
    );

    const [sql, params] = execute.mock.calls[0];
    expect(String(sql)).toContain("pub.branch_id = ?");
    expect(String(sql)).toContain("pub.process_id = ?");
    expect(String(sql)).toContain("pub.status = ?");
    expect(params).toEqual(["branch-1", "process-1", "accepted"]);
  });

  it("orders newest first and caps the limit at 500", async () => {
    execute.mockResolvedValueOnce([[]]);

    await request(app()).get(
      "/api/wfm/attendance/apr-bulk-upload/batches?limit=9999",
    );

    const [sql] = execute.mock.calls[0];
    expect(String(sql)).toContain("ORDER BY pub.submitted_at DESC");
    expect(String(sql)).toContain("LIMIT 500");
  });

  it("answers 500 with a plain message rather than leaking a driver error, on a DB failure", async () => {
    execute.mockRejectedValueOnce(new Error("connection reset"));

    const res = await request(app()).get(
      "/api/wfm/attendance/apr-bulk-upload/batches",
    );

    expect(res.status).toBe(500);
    expect(res.body.message).not.toContain("connection reset");
  });
});
