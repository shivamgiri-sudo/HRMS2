import express from "express";
import request from "supertest";
import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * The APR bulk upload used to write one row at a time: a 4,941-row file drove 4,941
 * sequential `INSERT ... ON DUPLICATE KEY UPDATE` round trips, live-measured at 69s for
 * just 2 rows, and held row locks open long enough to collide with ordinary concurrent
 * traffic and die with `ER_LOCK_WAIT_TIMEOUT`. That failing `await` sat in a bare loop
 * with no try/catch, so the error escaped as an unhandled promise rejection and killed
 * the Node process outright — after some rows had already committed, silently, with no
 * way for the caller to tell.
 *
 * The fix batches rows into chunked multi-row INSERTs (INSERT_CHUNK_SIZE = 300), each
 * wrapped in its own try/catch so one chunk's failure can never crash the process or
 * roll back a chunk that already committed.
 *
 * These tests exercise that behaviour directly — not just source-text pattern matching
 * — by counting how many `db.execute` calls the attendance-record INSERT actually makes
 * and by simulating a DB failure on one chunk to prove the request still answers 200
 * with the failure named, rather than throwing.
 */
const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
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
  a.use((err: any, _req: any, res: any, _next: any) => {
    // If a chunk failure ever escapes as an unhandled rejection again, it lands
    // here as a masked 500 instead of the route's own 200 — these tests would
    // catch that regression by asserting res.status(200) below.
    res.status(500).json({ success: false, message: "masked", crashed: true });
  });
  return a;
}

function csvWithRows(n: number): string {
  const lines = ["employee_code,attendance_date,net_login_minutes"];
  for (let i = 1; i <= n; i++) {
    lines.push(`MAS${String(i).padStart(4, "0")},01-06-2026,490`);
  }
  return lines.join("\n");
}

function empRowsFor(n: number) {
  const rows = [];
  for (let i = 1; i <= n; i++) {
    rows.push({
      employee_id: `emp-${i}`, employee_code: `MAS${String(i).padStart(4, "0")}`,
      dept_name: "operations", designation_name: "operations executive",
      branch_id: "branch-1", process_id: "process-1",
    });
  }
  return rows;
}

beforeEach(() => {
  execute.mockReset();
});

describe("APR bulk upload batches writes instead of one row per round trip", () => {
  it("issues ONE multi-row INSERT for 500 rows, not 500 separate inserts", async () => {
    const n = 500;
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM employees")) return [empRowsFor(n)];
      if (sql.includes("FROM attendance_daily_record adr")) return [[]];
      if (sql.includes("FROM apr") && sql.includes("campaign_id <>")) return [[]];
      if (sql.startsWith("INSERT INTO attendance_daily_record")) return [{ affectedRows: 1 }];
      if (sql.startsWith("INSERT INTO apr")) return [{ affectedRows: 1 }];
      return [[]];
    });

    const res = await request(app())
      .post("/api/wfm/attendance/apr-bulk-upload")
      .attach("file", Buffer.from(csvWithRows(n)), { filename: "apr.csv", contentType: "text/csv" });

    expect(res.status).toBe(200);
    expect(res.body.uploaded).toBe(n);
    expect(res.body.failed).toBe(0);

    // 500 rows at INSERT_CHUNK_SIZE=300 is 2 chunks, not 500 individual statements.
    const adrInserts = execute.mock.calls.filter(
      ([sql]) => typeof sql === "string" && sql.startsWith("INSERT INTO attendance_daily_record"),
    );
    expect(adrInserts.length).toBe(2);
    // Each chunk's SQL text carries multiple VALUES tuples, proving it is a
    // multi-row statement and not a loop of single-row inserts reusing this mock.
    const firstChunkValueTuples = (adrInserts[0]![0] as string).match(/\(UUID\(\)/g)?.length ?? 0;
    expect(firstChunkValueTuples).toBe(300);
    const secondChunkValueTuples = (adrInserts[1]![0] as string).match(/\(UUID\(\)/g)?.length ?? 0;
    expect(secondChunkValueTuples).toBe(200);
  });

  it("isolates a failed chunk: never crashes the request, names exactly which rows failed, and does not lose the other chunk's rows", async () => {
    const n = 400; // two chunks: rows 1-300, rows 301-400
    let adrInsertCallCount = 0;
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM employees")) return [empRowsFor(n)];
      if (sql.includes("FROM attendance_daily_record adr")) return [[]];
      if (sql.includes("FROM apr") && sql.includes("campaign_id <>")) return [[]];
      if (sql.startsWith("INSERT INTO attendance_daily_record")) {
        adrInsertCallCount++;
        if (adrInsertCallCount === 1) {
          // Simulate exactly the live failure mode this fix targets.
          throw Object.assign(new Error("Lock wait timeout exceeded; try restarting transaction"), {
            code: "ER_LOCK_WAIT_TIMEOUT",
          });
        }
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith("INSERT INTO apr")) return [{ affectedRows: 1 }];
      return [[]];
    });

    const res = await request(app())
      .post("/api/wfm/attendance/apr-bulk-upload")
      .attach("file", Buffer.from(csvWithRows(n)), { filename: "apr.csv", contentType: "text/csv" });

    // The whole point of the fix: a chunk DB failure answers 200 with the failure
    // named, it does not throw past the route and get masked as a 500.
    expect(res.status).toBe(200);
    expect(res.body.crashed).toBeUndefined();

    // Chunk 1 (rows 1-300) failed; chunk 2 (rows 301-400) succeeded independently.
    expect(res.body.uploaded).toBe(100);
    expect(res.body.failed).toBe(300);
    expect(res.body.errors.length).toBeGreaterThanOrEqual(300);

    const firstError = res.body.errors.find((e: any) => e.row === 2); // header is row 1
    expect(firstError).toBeDefined();
    expect(firstError.reason).toMatch(/batch insert failed/i);
    expect(firstError.reason).toMatch(/Lock wait timeout/i);

    // The row that made it into the successful chunk must NOT be reported failed.
    const lastRowError = res.body.errors.find((e: any) => e.employee_code === "MAS0400");
    expect(lastRowError).toBeUndefined();
  });
});
