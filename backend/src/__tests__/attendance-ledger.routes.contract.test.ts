import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * attendance-ledger.routes.ts contract (Branch Ledger tab of the Attendance Integrity console).
 *
 * Pins, by exercising the real router:
 *  1. the role gate is the SAME view-role list as mismatch-review.routes.ts, on every endpoint;
 *  2. row scope: the predicate from buildEmployeeScopeCondition (against employees alias e)
 *     reaches every source query as SQL + params;
 *  3. windows are bounded (<= 92 days, both bounds or neither) and every value is parameterised;
 *  4. each source is tolerant: one failing source -> 200 + a warning, not a 500;
 *  5. a "manual override" excludes regularization-applied rows (they also stamp override_by).
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../db/mysql.js", () => ({ db: { execute, query: execute, getConnection: vi.fn() } }));

vi.mock("../logger.js", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const { resolveUserBusinessScope, buildEmployeeScopeCondition } = vi.hoisted(() => ({
  resolveUserBusinessScope: vi.fn(async () => ({ isSuperAdmin: false, isAdmin: false, isHr: false, roles: ["wfm"], assignments: [] })),
  buildEmployeeScopeCondition: vi.fn((..._args: unknown[]) => ({ sql: "e.branch_id IN (?)", params: ["branch-scope-1"] as unknown[] })),
}));
vi.mock("../shared/enterpriseScope.js", () => ({ resolveUserBusinessScope, buildEmployeeScopeCondition }));

let actor: { id: string; role: string; roles: string[] };
vi.mock("../middleware/authMiddleware.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../middleware/authMiddleware.js")>();
  return { ...original, requireAuth: (req: any, _res: any, next: any) => { req.authUser = actor; next(); } };
});

// requireRole.ts is NOT mocked — the real role gate is under test.
import { attendanceLedgerRouter } from "../modules/wfm/attendance-ledger.routes.js";

const ROUTER_SRC = readFileSync(resolve(__dirname, "../modules/wfm/attendance-ledger.routes.ts"), "utf8");
const MISMATCH_SRC = readFileSync(resolve(__dirname, "../modules/wfm/mismatch-review.routes.ts"), "utf8");
const SOURCES_SRC = readFileSync(resolve(__dirname, "../modules/wfm/attendance-ledger.sources.ts"), "utf8");

function appFor(role: string) {
  actor = { id: `u-${role}`, role, roles: [role] };
  const app = express();
  app.use(express.json());
  app.use("/api/wfm/attendance-ledger", attendanceLedgerRouter);
  return app;
}

function viewRoles(src: string): string[] {
  const m = /const VIEW_ROLES = \[([\s\S]*?)\] as const;/.exec(src);
  return (m?.[1].match(/'([a-z_]+)'/g) ?? []).map((s) => s.replace(/'/g, "")).sort();
}

const seen: Array<{ sql: string; params: unknown[] }> = [];

function stubDb(failOn?: RegExp) {
  execute.mockReset();
  seen.length = 0;
  execute.mockImplementation(async (sql: string, params: unknown[] = []) => {
    seen.push({ sql, params });
    if (failOn && failOn.test(sql)) throw new Error("ER_NO_SUCH_TABLE: boom");
    if (/COUNT\(\*\) AS total/.test(sql)) return [[{ total: 0 }], []];
    return [[], []];
  });
}

const sourceQueries = () => seen.filter((q) => /JOIN employees e ON e\.id/.test(q.sql));

beforeEach(() => {
  buildEmployeeScopeCondition.mockClear();
  resolveUserBusinessScope.mockClear();
  stubDb();
});

describe("role gate", () => {
  it("uses exactly the VIEW_ROLES of mismatch-review.routes.ts", () => {
    expect(viewRoles(ROUTER_SRC).length).toBeGreaterThan(5);
    expect(viewRoles(ROUTER_SRC)).toEqual(viewRoles(MISMATCH_SRC));
  });

  it("applies requireRole(...VIEW_ROLES) to every endpoint", () => {
    const routes = ROUTER_SRC.match(/attendanceLedgerRouter\.get\(/g) ?? [];
    const gated = ROUTER_SRC.match(/requireRole\(\.\.\.VIEW_ROLES\)/g) ?? [];
    expect(routes.length).toBe(3 + 1);
    expect(gated.length).toBe(routes.length);
    expect(ROUTER_SRC).toMatch(/attendanceLedgerRouter\.use\(requireAuth\)/);
    expect(ROUTER_SRC).not.toMatch(/attendanceLedgerRouter\.(post|put|patch|delete)\(/);
  });

  it.each(["/summary", "/branch/b1/entries", "/branch/b1/people", "/entries/regularization/r1"])(
    "rejects a role outside VIEW_ROLES with 403 on %s",
    async (path) => {
      const res = await request(appFor("employee")).get(`/api/wfm/attendance-ledger${path}`);
      expect(res.status).toBe(403);
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it("admits wfm", async () => {
    const res = await request(appFor("wfm")).get("/api/wfm/attendance-ledger/summary");
    expect(res.status).toBe(200);
  });
});

describe("row scope", () => {
  it("scopes against employees alias e and pushes the predicate into every source query", async () => {
    const res = await request(appFor("branch_head")).get("/api/wfm/attendance-ledger/branch/b1/entries");
    expect(res.status).toBe(200);
    expect(buildEmployeeScopeCondition).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ employeeId: "e.id", branchId: "e.branch_id" }),
    );
    const queries = sourceQueries();
    expect(queries.length).toBeGreaterThanOrEqual(10); // count + list for each of 5 sources
    for (const q of queries) {
      expect(q.sql).toContain("(e.branch_id IN (?))");
      expect(q.params).toContain("branch-scope-1");
    }
  });

  it("scopes the drawer detail and answers 404 (not 403) for an out-of-scope row", async () => {
    const res = await request(appFor("branch_head")).get("/api/wfm/attendance-ledger/entries/regularization/r1");
    expect(res.status).toBe(404);
    const detail = sourceQueries()[0];
    expect(detail.sql).toContain("(e.branch_id IN (?))");
    expect(detail.params).toEqual(["r1", "branch-scope-1"]);
  });

  it("rejects an unknown kind and a malformed id", async () => {
    const app = appFor("wfm");
    expect((await request(app).get("/api/wfm/attendance-ledger/entries/nope/r1")).status).toBe(400);
    expect((await request(app).get("/api/wfm/attendance-ledger/entries/dispute/a%20b;drop")).status).toBe(400);
  });
});

describe("bounded window + parameterised SQL", () => {
  const get = (q: string) => request(appFor("wfm")).get(`/api/wfm/attendance-ledger/summary${q}`);

  it("accepts exactly 92 days and rejects 93", async () => {
    expect((await get("?from=2026-01-01&to=2026-04-02")).status).toBe(200);
    expect((await get("?from=2026-01-01&to=2026-04-03")).status).toBe(400);
  });

  it("requires both bounds or neither, real dates, and from <= to", async () => {
    expect((await get("?from=2026-01-01")).status).toBe(400);
    expect((await get("?to=2026-01-01")).status).toBe(400);
    expect((await get("?from=2026-02-30&to=2026-03-01")).status).toBe(400);
    expect((await get("?from=2026-03-02&to=2026-03-01")).status).toBe(400);
    expect((await get("?from=x&to=y")).status).toBe(400);
  });

  it("defaults to the current calendar month when no window is given", async () => {
    const res = await get("");
    expect(res.status).toBe(200);
    expect(res.body.data.window.from).toMatch(/^\d{4}-\d{2}-01$/);
  });

  it("windows every source on its date column and never inlines user input", async () => {
    const evil = "x'; DROP TABLE employees; --";
    await request(appFor("wfm"))
      .get("/api/wfm/attendance-ledger/branch/b1/entries")
      .query({ from: "2026-05-01", to: "2026-05-31", search: evil, actorId: "actor'1", employeeId: "emp'1" });
    for (const q of sourceQueries()) {
      expect(q.sql).toMatch(/(session_date|record_date|issue_date) >= \? AND .* <= \?/);
      expect(q.sql).not.toContain("DROP TABLE");
      expect(q.sql).not.toContain("actor'1");
      expect(q.params).toContain("2026-05-01");
    }
    expect(seen.some((q) => q.params.includes(`%${evil}%`))).toBe(true);
  });

  it("caps the page depth so the in-memory merge stays bounded", async () => {
    const res = await request(appFor("wfm")).get("/api/wfm/attendance-ledger/branch/b1/entries?page=20&limit=200");
    expect(res.status).toBe(400);
  });
});

describe("tolerant sources", () => {
  it("summary: one failing source -> 200 with a warning, other sources still counted", async () => {
    stubDb(/FROM attendance_reconciliation_issue/);
    const res = await request(appFor("wfm")).get("/api/wfm/attendance-ledger/summary");
    expect(res.status).toBe(200);
    expect(res.body.data.warnings).toHaveLength(1);
    expect(res.body.data.warnings[0]).toMatch(/Exception resolution/);
    expect(res.body.data.warnings[0]).not.toMatch(/ER_NO_SUCH_TABLE/);
  });

  it("entries: a failing source yields empty rows plus a warning", async () => {
    stubDb(/FROM attendance_daily_record adr[\s\S]*override_by IS NOT NULL/);
    const res = await request(appFor("wfm")).get("/api/wfm/attendance-ledger/branch/b1/entries");
    expect(res.status).toBe(200);
    expect(res.body.warnings).toHaveLength(1);
    expect(res.body.warnings[0]).toMatch(/Manual override/);
  });

  it("people: every source failing still answers 200", async () => {
    stubDb(/JOIN employees e ON e\.id/);
    const res = await request(appFor("wfm")).get("/api/wfm/attendance-ledger/branch/b1/people");
    expect(res.status).toBe(200);
    expect(res.body.data.warnings).toHaveLength(5);
    expect(res.body.data.rows).toEqual([]);
  });

  it("wraps every source call in tolerant()", () => {
    expect(ROUTER_SRC).toMatch(/async function tolerant</);
    expect(ROUTER_SRC).toMatch(/tolerant\(k, warnings, \(\) => fetchAggregates\(k, filter\)/);
    expect(ROUTER_SRC).toMatch(/tolerant\(kind, warnings, async \(\) => \{/);
  });
});

describe("source definitions", () => {
  it("counts a manual override only when no regularization produced the stamp", () => {
    expect(SOURCES_SRC).toContain("adr.override_by IS NOT NULL AND adr.regularization_id IS NULL");
  });

  it("splits plain regularizations from disputes on dispute_type", () => {
    expect(SOURCES_SRC).toContain("ar.dispute_type IS NULL");
    expect(SOURCES_SRC).toContain("ar.dispute_type IS NOT NULL");
  });

  it("never casts collations in a join", () => {
    expect(SOURCES_SRC).not.toMatch(/COLLATE/i);
  });
});
