import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

/**
 * An APR bulk upload that multer refuses must say why.
 *
 * multer raises its rejections — wrong file type, file over the size limit — as plain
 * Errors with no statusCode, and the production error handler masks every statusless
 * throw as "An unexpected server error occurred. Please quote reference <hex>". So the
 * one uploader-facing sentence that would have fixed the upload ("save it as CSV") was
 * replaced by a reference number, and a wrong file format looked like a server outage.
 * Reported live against reference 55a05236.
 *
 * These assertions are on the route's own response, so they hold regardless of what the
 * error handler downstream would have done with an unanswered error.
 */
vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn() } }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u1" }; next(); },
}));
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../attendance-engine.service.js", () => ({
  isOperationsExecutiveByRegex: () => true,
  classifyOperationsNetLogin: () => ({ status: "present", lwpValue: 0 }),
  resolveHalfDayFloorMinutes: async () => 240,
}));

const { attendanceAprBulkRouter } = await import("../attendance-apr-bulk.routes.js");

function app() {
  const a = express();
  a.use("/api/wfm/attendance", attendanceAprBulkRouter);
  // The masking branch of the real production error handler. Anything the route fails
  // to answer itself lands here and loses its message.
  a.use((_err: any, _req: any, res: any, _next: any) => {
    res.status(500).json({
      success: false,
      message: "An unexpected server error occurred. Please quote reference deadbeef if you contact HR.",
    });
  });
  return a;
}

describe("APR bulk upload rejects bad files with a reason", () => {
  it("tells an Excel uploader to save the file as CSV", async () => {
    const res = await request(app())
      .post("/api/wfm/attendance/apr-bulk-upload")
      .attach("file", Buffer.from("PK"), {
        filename: "apr.xlsx",
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/CSV/i);
    expect(res.body.message).toMatch(/Save As/i);
    expect(res.body.message).not.toMatch(/quote reference/i);
  });

  it("names the size limit instead of masking an oversized file", async () => {
    const res = await request(app())
      .post("/api/wfm/attendance/apr-bulk-upload")
      .attach("file", Buffer.alloc(3 * 1024 * 1024, 97), {
        filename: "apr.csv",
        contentType: "text/csv",
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/larger than 2 MB/i);
    expect(res.body.message).not.toMatch(/quote reference/i);
  });

  it("still answers a missing file with the existing 400", async () => {
    const res = await request(app()).post("/api/wfm/attendance/apr-bulk-upload");
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/No CSV file uploaded/i);
  });
});
