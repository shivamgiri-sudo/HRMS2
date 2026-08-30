import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * attendance-apr-bulk.routes.ts hardening (production defect, reproduced live 2026-08-27).
 *
 * A 4,941-row upload drove 4,941 sequential single-row `INSERT ... ON DUPLICATE KEY
 * UPDATE` statements against a remote DB with no try/catch around the `await`. One row
 * hit `ER_LOCK_WAIT_TIMEOUT`, escaped as an unhandled promise rejection, and killed the
 * Node process — after 2,881 of the 4,941 rows had already committed with no way for the
 * caller to know. This file proves the three fixes:
 *
 *  1. A DB error during the insert phase is caught and reported in the JSON response,
 *     never thrown/unhandled — the request completes with `success: true` and the
 *     affected rows named in `errors`, not a 500 or a dropped connection.
 *  2. Rows are written as chunked multi-row INSERTs, not one statement per row — proven
 *     by counting how many times db.execute is called for a multi-row file, and by
 *     asserting the VALUES clause of that call actually holds every row's data.
 *  3. A small, well-formed file still classifies and reports identically to the
 *     row-at-a-time implementation (same skip reasons, same counts).
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../db/mysql.js", () => ({
  db: { execute, query: execute, getConnection: vi.fn() },
}));

let actor: { id: string; role: string; roles: string[] };
vi.mock("../middleware/authMiddleware.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../middleware/authMiddleware.js")>();
  return {
    ...original,
    requireAuth: (req: any, _res: any, next: any) => {
      req.authUser = actor;
      next();
    },
  };
});

// requireRole.ts is NOT mocked — exercises the real role gate on this route.
import { attendanceAprBulkRouter } from "../modules/wfm/attendance-apr-bulk.routes.js";

function appFor(role: string) {
  actor = { id: `u-${role}`, role, roles: [role] };
  const app = express();
  app.use(express.json());
  app.use("/api/wfm/attendance", attendanceAprBulkRouter);
  return app;
}

const EMP = { employee_id: "emp-1", employee_code: "E001", dept_name: "operations", designation_name: "executive", branch_id: "b-1", process_id: "p-1" };

function baseStub(opts: { insertShouldThrow?: boolean; insertError?: Error } = {}) {
  execute.mockReset();
  execute.mockImplementation(async (sql: string, _params: unknown[] = []) => {
    if (/FROM employees e/.test(sql)) {
      return [[EMP], []];
    }
    if (/FROM attendance_daily_record adr/.test(sql) && /LEFT JOIN attendance_regularization/.test(sql)) {
      return [[], []]; // nothing locked
    }
    if (/FROM apr\s+WHERE \(UserID, ReportDate\)/.test(sql)) {
      return [[], []]; // nothing already synced
    }
    if (/attendance_feature_config/i.test(sql)) {
      return [[], []]; // half-day floor falls back to default
    }
    // Phase 3's evidence write is attributed (requirements.md criterion 17.10): it resolves a
    // registered Dialler_Source and its campaign, then opens a productivity_upload_batch row per
    // (branch, process) before writing any apr row. Answered as "already registered" so this file
    // keeps exercising the fully working path it was written for - the attribution behaviour itself
    // is covered by src/modules/wfm/__tests__/attendance-apr-bulk-attribution.routes.test.ts.
    if (/FROM dialler_source WHERE source_key/.test(sql)) {
      return [[{ id: "ds-apr-bulk" }], []];
    }
    if (/FROM campaign_master WHERE campaign_code/.test(sql)) {
      return [[{ id: "camp-apr-bulk" }], []];
    }
    if (/INSERT INTO productivity_upload_batch/.test(sql) || /UPDATE productivity_upload_batch/.test(sql)) {
      return [{ affectedRows: 1 }, []];
    }
    if (/INSERT INTO attendance_daily_record/.test(sql)) {
      if (opts.insertShouldThrow) {
        throw opts.insertError ?? Object.assign(new Error("Lock wait timeout exceeded; try restarting transaction"), { code: "ER_LOCK_WAIT_TIMEOUT" });
      }
      return [{ affectedRows: 1 }, []];
    }
    if (/INSERT INTO apr /.test(sql)) {
      return [{ affectedRows: 1 }, []];
    }
    return [[], []];
  });
}

function csvOf(rows: Array<{ code: string; date: string; mins: number }>): string {
  const header = "employee_code,attendance_date,net_login_minutes";
  const lines = rows.map(r => `${r.code},${r.date},${r.mins}`);
  return [header, ...lines].join("\n");
}

beforeEach(() => {
  baseStub();
});

describe("defect 1 — DB error during the insert loop is caught and reported, never thrown", () => {
  it("an insert-chunk failure returns a 200 JSON report naming the failed rows, not a 500 or a crash", async () => {
    baseStub({ insertShouldThrow: true });

    const csv = csvOf([
      { code: "E001", date: "01-08-2026", mins: 500 },
      { code: "E001", date: "02-08-2026", mins: 500 },
    ]);

    const res = await request(appFor("wfm"))
      .post("/api/wfm/attendance/apr-bulk-upload")
      .attach("file", Buffer.from(csv), "apr.csv");

    // The request itself must complete normally — this is the core of the fix. Before
    // it, the equivalent DB error escaped as an unhandled promise rejection and there
    // was no response at all (the process died mid-request).
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.uploaded).toBe(0);
    expect(res.body.failed).toBe(2);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ row: 2, employee_code: "E001", reason: expect.stringMatching(/ER_LOCK_WAIT_TIMEOUT|Lock wait timeout/) }),
        expect.objectContaining({ row: 3, employee_code: "E001", reason: expect.stringMatching(/ER_LOCK_WAIT_TIMEOUT|Lock wait timeout/) }),
      ]),
    );
  });

  it("a failed insert chunk does not write evidence rows for the rows that never saved", async () => {
    baseStub({ insertShouldThrow: true });
    const csv = csvOf([{ code: "E001", date: "01-08-2026", mins: 500 }]);

    const res = await request(appFor("wfm"))
      .post("/api/wfm/attendance/apr-bulk-upload")
      .attach("file", Buffer.from(csv), "apr.csv");

    expect(res.status).toBe(200);
    expect(res.body.evidence_recorded).toBe(0);
    const evidenceCalls = execute.mock.calls.filter(([sql]) => /INSERT INTO apr /.test(sql));
    expect(evidenceCalls.length).toBe(0);
  });
});

describe("defect 2 — rows are batched into chunked multi-row INSERTs, not one round trip per row", () => {
  it("a 5-row file issues one multi-row INSERT for attendance_daily_record, not five", async () => {
    const csv = csvOf(Array.from({ length: 5 }, (_, i) => ({ code: "E001", date: `0${i + 1}-08-2026`, mins: 500 })));

    const res = await request(appFor("wfm"))
      .post("/api/wfm/attendance/apr-bulk-upload")
      .attach("file", Buffer.from(csv), "apr.csv");

    expect(res.status).toBe(200);
    expect(res.body.uploaded).toBe(5);

    const insertCalls = execute.mock.calls.filter(([sql]) => /INSERT INTO attendance_daily_record/.test(sql));
    expect(insertCalls.length).toBe(1);
    const [sql, params] = insertCalls[0]!;
    // Five VALUES groups in the one statement.
    expect((sql.match(/UUID\(\)/g) ?? []).length).toBe(5);
    // 9 bound params per row (employee_id, record_date, branch_id, process_id,
    // dialler_minutes, raw_minutes, status, lwp_value, created_by) x 5 rows.
    expect(params.length).toBe(45);
  });
});

describe("defect 3 — a small well-formed file still succeeds and classifies identically", () => {
  it("present (>=480 min) classifies as present with lwp_value 0", async () => {
    const csv = csvOf([{ code: "E001", date: "01-08-2026", mins: 500 }]);
    const res = await request(appFor("wfm")).post("/api/wfm/attendance/apr-bulk-upload").attach("file", Buffer.from(csv), "apr.csv");
    expect(res.status).toBe(200);
    expect(res.body.uploaded).toBe(1);
    expect(res.body.failed).toBe(0);
    const insertCall = execute.mock.calls.find(([sql]) => /INSERT INTO attendance_daily_record/.test(sql))!;
    expect(insertCall[1]).toEqual(expect.arrayContaining(["present", 0]));
  });

  it("absent (< half-day floor) classifies as absent with lwp_value 1", async () => {
    const csv = csvOf([{ code: "E001", date: "01-08-2026", mins: 10 }]);
    const res = await request(appFor("wfm")).post("/api/wfm/attendance/apr-bulk-upload").attach("file", Buffer.from(csv), "apr.csv");
    expect(res.status).toBe(200);
    expect(res.body.uploaded).toBe(1);
    const insertCall = execute.mock.calls.find(([sql]) => /INSERT INTO attendance_daily_record/.test(sql))!;
    expect(insertCall[1]).toEqual(expect.arrayContaining(["absent", 1]));
  });

  it("an employee not found or inactive is still skipped with the unchanged reason", async () => {
    const csv = csvOf([{ code: "UNKNOWN", date: "01-08-2026", mins: 500 }]);
    const res = await request(appFor("wfm")).post("/api/wfm/attendance/apr-bulk-upload").attach("file", Buffer.from(csv), "apr.csv");
    expect(res.status).toBe(200);
    expect(res.body.uploaded).toBe(0);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ employee_code: "UNKNOWN", reason: "Employee not found or inactive" })]),
    );
  });

  it("a non-Operations-Executive employee is still skipped with the unchanged reason", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (/FROM employees e/.test(sql)) {
        return [[{ ...EMP, dept_name: "finance", designation_name: "manager" }], []];
      }
      if (/FROM attendance_daily_record adr/.test(sql) && /LEFT JOIN attendance_regularization/.test(sql)) return [[], []];
      if (/FROM apr\s+WHERE/.test(sql)) return [[], []];
      if (/attendance_feature_config/i.test(sql)) return [[], []];
      return [[], []];
    });
    const csv = csvOf([{ code: "E001", date: "01-08-2026", mins: 500 }]);
    const res = await request(appFor("wfm")).post("/api/wfm/attendance/apr-bulk-upload").attach("file", Buffer.from(csv), "apr.csv");
    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ employee_code: "E001", reason: "Employee is not an APR/Operations Executive" })]),
    );
  });
});

describe("defect 4 (review finding) — the employee-lookup query, upstream of the fixed insert phases, is unguarded", () => {
  it("a DB error on the employee-lookup query produces a clean failed response, not a thrown/unhandled error", async () => {
    execute.mockReset();
    execute.mockImplementation(async (sql: string) => {
      if (/FROM employees e/.test(sql)) {
        throw Object.assign(new Error("Connection lost"), { code: "PROTOCOL_CONNECTION_LOST" });
      }
      return [[], []];
    });

    const csv = csvOf([{ code: "E001", date: "01-08-2026", mins: 500 }]);
    const res = await request(appFor("wfm"))
      .post("/api/wfm/attendance/apr-bulk-upload")
      .attach("file", Buffer.from(csv), "apr.csv");

    // Must not crash the process (supertest getting any response at all proves
    // this) and must not misreport as a partial success — the whole request
    // failed cleanly, and the caller is told to retry.
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(res.status).toBeLessThan(600);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/retry/i);
    // Never silently continued with an empty employee map — that would report
    // "Employee not found or inactive" for every row instead of the real cause.
    expect(res.body.message).not.toMatch(/Employee not found or inactive/);
  });
});

describe("defect 5 (review finding) — the lock-check chunk loop is unguarded and must fail closed", () => {
  it("a DB error on a lock-check chunk reports its rows as uncertain-safety skips, does not insert them, and does not crash", async () => {
    execute.mockReset();
    execute.mockImplementation(async (sql: string) => {
      if (/FROM employees e/.test(sql)) {
        return [[EMP], []];
      }
      if (/FROM attendance_daily_record adr/.test(sql) && /LEFT JOIN attendance_regularization/.test(sql)) {
        throw Object.assign(new Error("Lock wait timeout exceeded; try restarting transaction"), { code: "ER_LOCK_WAIT_TIMEOUT" });
      }
      if (/FROM apr\s+WHERE \(UserID, ReportDate\)/.test(sql)) {
        return [[], []];
      }
      if (/attendance_feature_config/i.test(sql)) {
        return [[], []];
      }
      if (/INSERT INTO attendance_daily_record/.test(sql)) {
        return [{ affectedRows: 1 }, []];
      }
      if (/INSERT INTO apr /.test(sql)) {
        return [{ affectedRows: 1 }, []];
      }
      return [[], []];
    });

    const csv = csvOf([
      { code: "E001", date: "01-08-2026", mins: 500 },
      { code: "E001", date: "02-08-2026", mins: 500 },
    ]);

    const res = await request(appFor("wfm"))
      .post("/api/wfm/attendance/apr-bulk-upload")
      .attach("file", Buffer.from(csv), "apr.csv");

    // Request completes normally — no crash.
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Fail closed: neither row was inserted.
    expect(res.body.uploaded).toBe(0);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          row: 2,
          employee_code: "E001",
          reason: expect.stringMatching(/could not be verified/i),
        }),
        expect.objectContaining({
          row: 3,
          employee_code: "E001",
          reason: expect.stringMatching(/could not be verified/i),
        }),
      ]),
    );
    // Distinguishable from a confirmed lock reason.
    for (const e of res.body.errors) {
      expect(e.reason).not.toBe("Attendance record is locked for payroll");
    }
    // Never actually inserted into attendance_daily_record.
    const insertCalls = execute.mock.calls.filter(([sql]) => /INSERT INTO attendance_daily_record/.test(sql));
    expect(insertCalls.length).toBe(0);
  });
});
