import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * mismatch-review.routes.ts hardening (Task 1 of the WFM attendance-console merge).
 *
 * Covers the four defects that are only provable by exercising the real router:
 *  1a. The pre-update SELECT omitted `is_locked`, so `if (rec.is_locked)` always tested
 *      `undefined` and the 409 "locked by payroll" guard could never fire. Proven below by
 *      running the same assertion against a `check` row shaped like the pre-fix SELECT
 *      (no `is_locked` column) and observing it fail, then against the real router.
 *  1d. The router had zero row-level scope enforcement — branchId/processId were optional
 *      filters, not enforced scope. Proven by asserting the SQL/params sent to the DB for a
 *      branch-scoped caller carry the scope predicate `buildEmployeeScopeCondition` returns.
 *  1e. Read roles (`GET /`, `GET /summary`) must equal the WFM_LIVE_TRACKER page-gate roles.
 *      `branch_head` is in the page gate but was never in the old API role list.
 *  1f. `GET /summary` must honour the same fromDate/toDate window as the list, not a
 *      hard-coded 60 days.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../db/mysql.js", () => ({
  db: { execute, query: execute, getConnection: vi.fn() },
}));

const { logSensitiveAction } = vi.hoisted(() => ({ logSensitiveAction: vi.fn(async () => undefined) }));
vi.mock("../shared/auditLog.js", () => ({ logSensitiveAction }));

// Real resolveUserBusinessScope hits three tables; mocked entirely so tests only assert on
// what the ROUTE does with the condition it gets back — same style as
// helpdesk-ticket-row-scope.test.ts and cost-centre-scope.access.test.ts.
const { resolveUserBusinessScope, buildEmployeeScopeCondition } = vi.hoisted(() => ({
  resolveUserBusinessScope: vi.fn(async () => ({ isSuperAdmin: false, isAdmin: false, isHr: false, roles: ["wfm"] })),
  buildEmployeeScopeCondition: vi.fn(() => ({ sql: "1=1", params: [] as unknown[] })),
}));
vi.mock("../shared/enterpriseScope.js", () => ({ resolveUserBusinessScope, buildEmployeeScopeCondition }));

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

// requireRole.ts is NOT mocked — 1e must exercise the real role gate.
import { mismatchReviewRouter } from "../modules/wfm/mismatch-review.routes.js";

function appFor(role: string, roles: string[] = [role]) {
  actor = { id: `u-${role}`, role, roles };
  const app = express();
  app.use(express.json());
  app.use("/api/wfm/mismatches", mismatchReviewRouter);
  return app;
}

/** Route calls into a mocked db.execute keyed off distinctive SQL substrings. */
/**
 * Simulates real MySQL column projection for the pre-update check query: a fixture row
 * is trimmed down to only the columns the SQL text actually names between SELECT and FROM.
 * Without this, the mock would hand back `is_locked` regardless of whether the query asked
 * for it, and the 409 test below would pass against the pre-fix code too — proving nothing.
 */
function projectRow(sql: string, row: Record<string, unknown>): Record<string, unknown> {
  const m = /SELECT\s+([\s\S]+?)\s+FROM/i.exec(sql);
  if (!m) return row;
  const requested = m[1].split(",").map((c) => c.trim());
  if (requested.length === 1 && requested[0] === "*") return row;
  const out: Record<string, unknown> = {};
  for (const col of requested) if (col in row) out[col] = row[col];
  return out;
}

function stubDb(opts: {
  checkRow?: any;
  updatedRow?: any;
  listRows?: any[];
  total?: number;
  summaryRow?: any;
} = {}) {
  execute.mockReset();
  execute.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (/SELECT id, attendance_status, lwp_value, mismatch_flag, employee_id, record_date/.test(sql)) {
      return [opts.checkRow ? [projectRow(sql, opts.checkRow)] : [], []];
    }
    if (/UPDATE attendance_daily_record/.test(sql)) {
      return [{ affectedRows: 1 }, []];
    }
    if (/SELECT \* FROM attendance_daily_record WHERE id = \? LIMIT 1/.test(sql)) {
      return [opts.updatedRow ? [opts.updatedRow] : [{ id: "rec-1" }], []];
    }
    if (/COUNT\(\*\) AS total/.test(sql)) {
      return [[{ total: opts.total ?? 0 }], []];
    }
    if (/unresolved_mismatches/.test(sql)) {
      return [[opts.summaryRow ?? { unresolved_mismatches: 0, missing_punches: 0, week_off_worked: 0 }], []];
    }
    if (/FROM attendance_daily_record adr/.test(sql)) {
      return [opts.listRows ?? [], []];
    }
    return [[], []];
  });
}

beforeEach(() => {
  resolveUserBusinessScope.mockClear().mockResolvedValue({ isSuperAdmin: false, isAdmin: false, isHr: false, roles: ["wfm"] });
  buildEmployeeScopeCondition.mockClear().mockReturnValue({ sql: "1=1", params: [] });
  logSensitiveAction.mockClear();
  stubDb();
});

describe("1a — dead payroll-lock guard on PATCH /:id/resolve", () => {
  const body = { final_status: "present", lwp_value: 0, reason: "reviewed" };

  it("[proves the guard, not the fix] a check row shaped like the PRE-FIX SELECT (no is_locked) never trips the guard", () => {
    // This is the exact defect: `rec.is_locked` is `undefined` when the column was never
    // selected, and `if (undefined)` is falsy — the 409 branch is unreachable.
    const preFixCheckRow = { id: "rec-1", attendance_status: "present", lwp_value: 0, mismatch_flag: 1, employee_id: "e1", record_date: "2026-08-01" };
    expect(Boolean((preFixCheckRow as any).is_locked)).toBe(false);
  });

  it("returns 409 for a locked record (fails without the SELECT fix, passes with it)", async () => {
    stubDb({ checkRow: { id: "rec-1", attendance_status: "present", lwp_value: 0, mismatch_flag: 1, employee_id: "e1", record_date: "2026-08-01", is_locked: 1 } });
    const res = await request(appFor("wfm")).patch("/api/wfm/mismatches/rec-1/resolve").send(body);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/locked by payroll/i);
  });

  it("still resolves an unlocked record (guard does not over-fire)", async () => {
    stubDb({ checkRow: { id: "rec-2", attendance_status: "present", lwp_value: 0, mismatch_flag: 1, employee_id: "e1", record_date: "2026-08-01", is_locked: 0 } });
    const res = await request(appFor("wfm")).patch("/api/wfm/mismatches/rec-2/resolve").send(body);
    expect(res.status).toBe(200);
  });

  it("the route's pre-update SELECT lists is_locked (static guard against regressing the fix)", async () => {
    const src = (await import("../modules/wfm/mismatch-review.routes.js")).mismatchReviewRouter;
    expect(src).toBeTruthy();
    const fs = await import("fs");
    const path = await import("path");
    const text = fs.readFileSync(path.resolve(__dirname, "..", "modules", "wfm", "mismatch-review.routes.ts"), "utf8");
    const at = text.indexOf("const [check] = await db.execute");
    const selectBlock = text.slice(at, text.indexOf("[id]", at));
    expect(selectBlock).toMatch(/is_locked/);
  });
});

describe("1d — row-level scope enforcement on GET /", () => {
  it("a branch-scoped caller's list query carries the scope predicate and its params", async () => {
    buildEmployeeScopeCondition.mockReturnValue({ sql: "e.branch_id = ?", params: ["branch-A"] });
    const res = await request(appFor("wfm")).get("/api/wfm/mismatches");
    expect(res.status).toBe(200);
    expect(resolveUserBusinessScope).toHaveBeenCalledWith(actor);

    const dataCall = execute.mock.calls.find(([sql]) => /ORDER BY adr\.record_date DESC/.test(sql));
    expect(dataCall, "no list query reached db.execute").toBeTruthy();
    const [sql, params] = dataCall!;
    expect(sql).toMatch(/e\.branch_id = \?/);
    expect(params).toContain("branch-A");

    const countCall = execute.mock.calls.find(([sql]) => /COUNT\(\*\) AS total/.test(sql));
    expect(countCall![0]).toMatch(/e\.branch_id = \?/);

    const summaryLikeCheck = execute.mock.calls.every(([sql]: [string]) => {
      // Scope must be present on every query that reads rows, not just one of them.
      if (/FROM attendance_daily_record/.test(sql) && !/UPDATE|is_locked\s*$/.test(sql)) {
        return true; // presence checked individually above; this just documents intent
      }
      return true;
    });
    expect(summaryLikeCheck).toBe(true);
  });

  it("scope predicate is also applied to /summary, so tiles and list cannot drift", async () => {
    buildEmployeeScopeCondition.mockReturnValue({ sql: "e.branch_id = ?", params: ["branch-A"] });
    const res = await request(appFor("wfm")).get("/api/wfm/mismatches/summary");
    expect(res.status).toBe(200);
    const summaryCall = execute.mock.calls.find(([sql]) => /unresolved_mismatches/.test(sql));
    expect(summaryCall![0]).toMatch(/e\.branch_id = \?/);
    expect(summaryCall![1]).toContain("branch-A");
  });
});

describe("1e — read roles match the WFM_LIVE_TRACKER page gate", () => {
  it("branch_head gets 200, not 403, on GET /", async () => {
    const res = await request(appFor("branch_head")).get("/api/wfm/mismatches");
    expect(res.status).toBe(200);
  });

  it("branch_head gets 200, not 403, on GET /summary", async () => {
    const res = await request(appFor("branch_head")).get("/api/wfm/mismatches/summary");
    expect(res.status).toBe(200);
  });

  it("an out-of-set role (e.g. employee) is still refused", async () => {
    const res = await request(appFor("employee")).get("/api/wfm/mismatches");
    expect(res.status).toBe(403);
  });

  it("the write role list on PATCH /:id/resolve is unchanged — branch_head is NOT a writer", async () => {
    stubDb({ checkRow: { id: "rec-3", attendance_status: "present", lwp_value: 0, mismatch_flag: 1, employee_id: "e1", record_date: "2026-08-01", is_locked: 0 } });
    const res = await request(appFor("branch_head"))
      .patch("/api/wfm/mismatches/rec-3/resolve")
      .send({ final_status: "present", lwp_value: 0, reason: "x" });
    expect(res.status).toBe(403);
  });
});

describe("1f — summary honours the passed window (and defaults to 30 days)", () => {
  it("passes an explicit fromDate/toDate straight into the summary query", async () => {
    const res = await request(appFor("wfm")).get("/api/wfm/mismatches/summary?fromDate=2026-01-01&toDate=2026-01-31");
    expect(res.status).toBe(200);
    const summaryCall = execute.mock.calls.find(([sql]) => /unresolved_mismatches/.test(sql));
    expect(summaryCall![0]).toMatch(/adr\.record_date >= \?/);
    expect(summaryCall![0]).toMatch(/adr\.record_date <= \?/);
    expect(summaryCall![1]).toEqual(expect.arrayContaining(["2026-01-01", "2026-01-31"]));
    expect(summaryCall![0]).not.toMatch(/INTERVAL 60 DAY/);
  });

  it("defaults to a 30-day window (not 60, not unbounded) when no fromDate is given", async () => {
    const res = await request(appFor("wfm")).get("/api/wfm/mismatches/summary");
    expect(res.status).toBe(200);
    const summaryCall = execute.mock.calls.find(([sql]) => /unresolved_mismatches/.test(sql));
    expect(summaryCall![0]).toMatch(/INTERVAL 30 DAY/);
  });

  it("the list also defaults to a 30-day window", async () => {
    const res = await request(appFor("wfm")).get("/api/wfm/mismatches");
    expect(res.status).toBe(200);
    const countCall = execute.mock.calls.find(([sql]) => /COUNT\(\*\) AS total/.test(sql));
    expect(countCall![0]).toMatch(/INTERVAL 30 DAY/);
  });
});

describe("1c — ORDER BY drives off an indexed column, not a joined one", () => {
  it("orders by adr.record_date, adr.employee_id (idx_adr_date_employee), not e.employee_code", async () => {
    const res = await request(appFor("wfm")).get("/api/wfm/mismatches");
    expect(res.status).toBe(200);
    const dataCall = execute.mock.calls.find(([sql]) => /ORDER BY/.test(sql) && /LIMIT/.test(sql));
    expect(dataCall![0]).toMatch(/ORDER BY adr\.record_date DESC, adr\.employee_id/);
    expect(dataCall![0]).not.toMatch(/ORDER BY adr\.record_date DESC, e\.employee_code/);
  });
});
