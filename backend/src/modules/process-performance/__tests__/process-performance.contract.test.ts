import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Process Performance report card — the properties that make it safe and honest.
 *
 * Two things are being protected here.
 *
 * 1. Scope. A manager must see only their own scope at EVERY drill level, not
 *    just in the top filter. The ids for the manager and agent levels arrive in
 *    the query string, so if scoping were applied only at the top a caller could
 *    read another manager's team by editing the URL. Every grain therefore
 *    re-derives the caller's predicate through buildScopeWhereClause and applies
 *    it in SQL.
 *
 * 2. Honesty. Live, only 13 of 93 configured metrics carry any data, and
 *    `employees` has no categorised exit reason at all. The page must say so
 *    rather than render a plausible number, so "not tracked" and "no data" are
 *    first-class states and root-cause breakdowns exist only where the schema
 *    genuinely categorises the cause.
 */
const { execute, buildScopeWhereClause, hasAnyRole } = vi.hoisted(() => ({
  execute: vi.fn(),
  buildScopeWhereClause: vi.fn(),
  hasAnyRole: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../shared/scopeAccess.js", () => ({ buildScopeWhereClause, hasAnyRole }));

const svc = await import("../process-performance.service.js");

const FILTERS = { from: "2026-07-01", to: "2026-07-31" };
const sqlOf = (i = 0) => String(execute.mock.calls[i][0]);
const paramsOf = (i = 0) => execute.mock.calls[i][1] as unknown[];

beforeEach(() => {
  execute.mockReset().mockResolvedValue([[]]);
  buildScopeWhereClause.mockReset().mockResolvedValue({ sql: "1=1", params: [] });
});

describe("scope is enforced in SQL at every grain", () => {
  it.each(["process", "manager", "agent"] as const)("applies the scope predicate for the %s grain", async (grain) => {
    buildScopeWhereClause.mockResolvedValue({ sql: "e.process_id = ?", params: ["proc-owned"] });
    const fn = grain === "process" ? svc.getProcessRows : grain === "manager" ? svc.getManagerRows : svc.getAgentRows;
    await fn("user-1", FILTERS);
    expect(sqlOf()).toContain("e.process_id = ?");
    expect(paramsOf()).toContain("proc-owned");
  });

  it("scopes by the caller, never by the id supplied in the request", async () => {
    // The manager id is a filter ON TOP of the caller's scope, not a substitute
    // for it: asking for someone else's team still runs inside your own predicate.
    buildScopeWhereClause.mockResolvedValue({ sql: "e.reporting_manager_id = ?", params: ["me"] });
    await svc.getAgentRows("user-1", { ...FILTERS, managerId: "someone-else" });
    const sql = sqlOf();
    expect(sql).toContain("e.reporting_manager_id = ?");
    const params = paramsOf();
    expect(params).toContain("me");          // caller's own scope survives
    expect(params).toContain("someone-else"); // and the request narrows within it
  });

  it("returns nothing when the caller has no resolvable scope", async () => {
    // buildScopeWhereClause answers 1=0 for a user with no scope rows. That must
    // reach the query rather than being treated as "no filter".
    buildScopeWhereClause.mockResolvedValue({ sql: "1=0", params: [] });
    await svc.getProcessRows("stranger", FILTERS);
    expect(sqlOf()).toContain("1=0");
  });

  it("scopes the metric detail view too, not just the table", async () => {
    buildScopeWhereClause.mockResolvedValue({ sql: "e.process_id = ?", params: ["proc-owned"] });
    await svc.getMetricDetail("user-1", "late_comers", FILTERS);
    for (let i = 0; i < execute.mock.calls.length; i++) {
      expect(sqlOf(i)).toContain("e.process_id = ?");
    }
  });
});

describe("a value is either real or explicitly absent", () => {
  const rowWith = (over: Record<string, unknown> = {}) => ([[{
    group_id: "p1", group_name: "Onfido", group_subtitle: "ONF",
    headcount: 10, manager_count: 2,
    present_days: 100, late_days: 30, absent_days: 5, half_days: 4, leave_days: 1, total_days: 120,
    exits: 1, quality_score: null, aht: null, ...over,
  }]]);

  it("computes late comers % from real numerator and denominator", async () => {
    execute.mockResolvedValue(rowWith());
    const [row] = await svc.getProcessRows("u", FILTERS);
    const late = row.sections.find((s) => s.key === "late_comers")!;
    expect(late.availability).toBe("ok");
    expect(late.value).toBe(30); // 30 late of 100 present
  });

  it("never reports a late percentage above 100", async () => {
    // The bug this guards: late_mark is also set on absent/half_day rows, so an
    // unrestricted numerator over present days alone produced 232% live.
    execute.mockResolvedValue(rowWith());
    const sql = String((await svc.getProcessRows("u", FILTERS), sqlOf()));
    expect(sql).toMatch(/SUM\(a\.attendance_status = 'present' AND a\.late_mark = 1\)/);
  });

  it("marks a metric with no rows as no_data rather than zero", async () => {
    execute.mockResolvedValue(rowWith({ quality_score: null }));
    const [row] = await svc.getProcessRows("u", FILTERS);
    const quality = row.sections.find((s) => s.key === "quality")!;
    expect(quality.availability).toBe("no_data");
    expect(quality.value).toBeNull();
    expect(quality.note).toBeTruthy();
  });

  it.each(["mandate", "buffer", "hygiene"] as const)("marks %s as not_tracked, distinct from a bad score", async (key) => {
    execute.mockResolvedValue(rowWith());
    const [row] = await svc.getProcessRows("u", FILTERS);
    const s = row.sections.find((x) => x.key === key)!;
    expect(s.availability).toBe("not_tracked");
    expect(s.value).toBeNull();
    // The note must say WHY it is absent, not just be present.
    expect(s.note).toMatch(/no .*(source|metric).*(exists|captured)/i);
  });

  it("offers a root cause only where the schema categorises one", async () => {
    execute.mockResolvedValue(rowWith());
    const [row] = await svc.getProcessRows("u", FILTERS);
    const by = Object.fromEntries(row.sections.map((s) => [s.key, s.hasRootCause]));
    expect(by.late_comers).toBe(true);
    expect(by.shrinkage).toBe(true);
    // No categorised exit reason exists on `employees`, so a breakdown would be invented.
    expect(by.attrition).toBe(false);
    expect(by.quality).toBe(false);
  });
});

describe("metric detail refuses to invent a breakdown", () => {
  it("returns rootCause null with a reason for attrition", async () => {
    execute.mockResolvedValue([[]]);
    const d = await svc.getMetricDetail("u", "attrition", FILTERS);
    expect(d.rootCause).toBeNull();
    expect(d.rootCauseNote).toMatch(/not categorised/i);
  });

  it("returns a real breakdown for shrinkage, summing to 100%", async () => {
    execute.mockResolvedValue([[
      { label: "present", value: 60 },
      { label: "absent", value: 30 },
      { label: "half_day", value: 10 },
    ]]);
    const d = await svc.getMetricDetail("u", "shrinkage", FILTERS);
    expect(d.rootCause).not.toBeNull();
    const total = d.rootCause!.reduce((a, r) => a + r.share, 0);
    expect(Math.round(total)).toBe(100);
  });

  it("short-circuits an untracked section without querying at all", async () => {
    const d = await svc.getMetricDetail("u", "mandate", FILTERS);
    expect(d.availability).toBe("not_tracked");
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("route registration", () => {
  const ROUTES = readFileSync(
    resolve(process.cwd(), "src/modules/process-performance/process-performance.routes.ts"),
    "utf8",
  );

  it("declares every literal route before any :id-style route", () => {
    // Express matches in registration order. /detail/:section is the only
    // parameterised route and must come last, for the same reason
    // /my-processes needed to sit above /:id.
    const literals = ["/processes", "/managers", "/agents"].map((p) => ROUTES.indexOf(`"${p}"`));
    const param = ROUTES.indexOf('"/detail/:section"');
    expect(Math.min(...literals)).toBeGreaterThan(-1);
    expect(param).toBeGreaterThan(Math.max(...literals));
  });

  it("guards every route with auth and a role check", () => {
    const handlers = [...ROUTES.matchAll(/router\.get\(/g)];
    expect(handlers.length).toBe(4);
    const guarded = [...ROUTES.matchAll(/router\.get\([^)]*requireAuth, requireRole\(\.\.\.VIEWER_ROLES\)/g)];
    expect(guarded.length).toBe(4);
  });

  it("does not list super_admin, which requireRole already short-circuits", () => {
    const block = ROUTES.slice(ROUTES.indexOf("const VIEWER_ROLES"), ROUTES.indexOf("] as const;"));
    expect(block).not.toContain("super_admin");
  });

  it("rejects an unknown section rather than passing it into SQL", () => {
    expect(ROUTES).toContain("UNKNOWN_SECTION");
    expect(ROUTES).toMatch(/SECTION_KEYS\.includes\(section\)/);
  });
});
