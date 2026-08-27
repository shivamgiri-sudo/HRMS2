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
 *
 * 3. Arithmetic that live data has already broken once. Attrition counted exits
 *    inside `WHERE e.active_status = 1`, which scored every process at 0% for
 *    every month because a leaver is inactive; shrinkage ignored missing_punch
 *    (13% of all attendance rows) and counted week offs as scheduled time. Both
 *    are guarded below.
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
/** The aggregate is call 0; exits and mandate follow it. */
const anySqlMatches = (re: RegExp) =>
  execute.mock.calls.some((c: unknown[]) => re.test(String(c[0])));

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
    execute.mockResolvedValue([[{ late_marks: 1, issues: 1, exits: 1 }]]);
    await svc.getMetricDetail("user-1", "late_comers", FILTERS);
    const queries = execute.mock.calls.map((c) => String(c[0]));
    // The coverage probe is the ONE deliberate exception: it answers "did the
    // producing engine write anything in this window" -- a property of the
    // period, not of anyone's data. Everything else must carry the predicate.
    const dataQueries = queries.filter((q) => !q.includes("AS late_marks"));
    expect(dataQueries.length).toBeGreaterThan(0);
    for (const q of dataQueries) expect(q).toContain("e.process_id = ?");
    // It stays unscoped only because it returns pure aggregates -- counts and a
    // MAX date. The moment it selects a row-level column it starts leaking, so
    // that is what is guarded rather than which tables it touches.
    const probe = queries.find((q) => q.includes("AS late_marks"))!;
    expect(probe).not.toMatch(/(full_name|employee_code|e\.id|\*\s*FROM)/);
    expect(probe.match(/SELECT/g)!.length).toBe(probe.match(/COUNT\(\*\)|MAX\(/g)!.length + 1);
  });
});

describe("a value is either real or explicitly absent", () => {
  // The same shape answers every call in these tests: the aggregate, the exits
  // and mandate lookups, and the coverage probe (late_marks / issues non-zero,
  // i.e. both producing engines ran in the window).
  const rowWith = (over: Record<string, unknown> = {}) => ([[{
    group_id: "p1", group_name: "Onfido", group_subtitle: "ONF",
    headcount: 10, manager_count: 2,
    present_days: 100, late_days: 30, absent_days: 5, half_days: 4, leave_days: 1,
    missing_punch_days: 0, off_days: 0, total_days: 120,
    issue_days: 0, missing_adr_days: 0, people_cost: null,
    exits: 1, quality_score: null, aht: null,
    late_marks: 1, issues: 1, ...over,
  }]]);

  it("computes late comers % from real numerator and denominator", async () => {
    execute.mockResolvedValue(rowWith());
    const [row] = await svc.getProcessRows("u", FILTERS);
    const late = row.sections.find((s) => s.key === "late_comers")!;
    expect(late.availability).toBe("ok");
    expect(late.value).toBe(30); // 30 late of 100 present
  });

  it("refuses to score a metric whose producing engine never ran", async () => {
    // Live, late_mark is set on ZERO of April's 18,159 attendance rows and
    // attendance_reconciliation_issue holds nothing before July. "0% late" and
    // "100% hygiene" there are flattering fictions, not clean months.
    execute.mockReset();
    execute.mockResolvedValueOnce(rowWith());                          // aggregate
    execute.mockResolvedValueOnce([[{ group_id: "p1", exits: 1 }]]);   // exits
    execute.mockResolvedValueOnce([[{ late_marks: 0, issues: 0, exits: 0 }]]); // coverage
    execute.mockResolvedValueOnce([[]]);                              // mandate
    const [row] = await svc.getProcessRows("u", FILTERS);
    for (const key of ["late_comers", "hygiene"] as const) {
      const s = row.sections.find((x) => x.key === key)!;
      expect(s.availability).toBe("no_data");
      expect(s.value).toBeNull();
      expect(s.note).toMatch(/did not run|was not applied/i);
    }
    // Same trap, different feed: zero exits system-wide for a month is a stale
    // exit record, and 0% attrition across every process reads as perfect
    // retention. Live, exit dates stop on 29 July while July recorded 163.
    const attr = row.sections.find((x) => x.key === "attrition")!;
    expect(attr.availability).toBe("no_data");
    expect(attr.note).toMatch(/gap in the exit records/i);
  });

  it("counts an unresolved missing punch as lost capacity", async () => {
    // 5 absent + 1 leave + 8 missing_punch + 4/2 half = 16 lost over
    // (140 total - 20 week off/holiday) = 120 scheduled days.
    execute.mockResolvedValue(rowWith({ missing_punch_days: 8, off_days: 20, total_days: 140 }));
    const [row] = await svc.getProcessRows("u", FILTERS);
    const shrink = row.sections.find((s) => s.key === "shrinkage")!;
    expect(shrink.value).toBeCloseTo(13.33, 2);
  });

  it("keeps week offs and holidays out of the shrinkage denominator", async () => {
    // Same lost time, but every day is scheduled: the rate must be lower when
    // unscheduled days inflate the denominator, so they are excluded.
    execute.mockResolvedValue(rowWith({ missing_punch_days: 8, off_days: 0, total_days: 140 }));
    const [row] = await svc.getProcessRows("u", FILTERS);
    expect(row.sections.find((s) => s.key === "shrinkage")!.value).toBeCloseTo(11.43, 2);
  });

  it("counts exits OUTSIDE the active-employee filter", async () => {
    // The bug this guards: a leaver has active_status = 0, so counting exits in
    // the main aggregate returned 0 for every process in every month live.
    execute.mockReset().mockResolvedValue([[{}]]);
    await svc.getProcessRows("u", FILTERS);
    const exitSql = execute.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .find((q: string) => q.includes("AS exits"));
    expect(exitSql).toBeTruthy();
    expect(exitSql).not.toContain("e.active_status = 1");
    expect(exitSql).toContain("COALESCE(e.date_of_exit, e.resignation_date)");
  });

  it("reports attrition against the population that was there, not the survivors", async () => {
    execute.mockReset();
    execute.mockResolvedValueOnce(rowWith({ headcount: 90 }));         // aggregate
    execute.mockResolvedValueOnce([[{ group_id: "p1", exits: 10 }]]);  // exits
    execute.mockResolvedValueOnce([[{ late_marks: 1, issues: 1, exits: 10 }]]); // coverage
    execute.mockResolvedValueOnce([[]]);                               // mandate
    const [row] = await svc.getProcessRows("u", FILTERS);
    // 10 exits out of the 100 people who were in the group, not 10 of 90.
    expect(row.sections.find((s) => s.key === "attrition")!.value).toBe(10);
  });

  it("sums contracted seats once per cost centre, not once per employee", async () => {
    execute.mockReset().mockResolvedValue([[{}]]);
    await svc.getProcessRows("u", FILTERS);
    const mandateSql = execute.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .find((q: string) => q.includes("AS mandate"));
    expect(mandateSql).toBeTruthy();
    // The DISTINCT is the whole guard: without it the mandate is multiplied by
    // the headcount sitting in the cost centre.
    expect(mandateSql).toMatch(/SELECT DISTINCT e\.process_id AS group_id, e\.cost_centre_id/);
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

  it.each(["mandate", "buffer"] as const)(
    "reports %s at process grain only, and says so below it",
    async (key) => {
      execute.mockReset().mockResolvedValue(rowWith());
      const [row] = await svc.getManagerRows("u", FILTERS);
      const s = row.sections.find((x) => x.key === key)!;
      // Contracted seats belong to a cost centre. Splitting them across managers
      // would be an allocation nobody agreed, so it is declared, not invented.
      expect(s.availability).toBe("not_tracked");
      expect(s.value).toBeNull();
      expect(s.note).toMatch(/cost centre/i);
    },
  );

  it("computes hygiene from unresolved reconciliation issues", async () => {
    // 120 attendance days + 10 missing_adr day-slots = 130 slots, 30 of which
    // still carry an unresolved issue -> 100 clean.
    execute.mockResolvedValue(rowWith({ total_days: 120, issue_days: 30, missing_adr_days: 10 }));
    const [row] = await svc.getProcessRows("u", FILTERS);
    const hyg = row.sections.find((s) => s.key === "hygiene")!;
    expect(hyg.availability).toBe("ok");
    expect(hyg.value).toBeCloseTo(76.92, 2);
  });

  it("weights quality and AHT by volume rather than averaging per-person means", async () => {
    // An agent audited on 4 calls must not move the process score as far as one
    // audited on 400 -- and the cell must agree with the drill-down behind it,
    // which averages the underlying rows directly.
    execute.mockReset().mockResolvedValue([[{}]]);
    await svc.getProcessRows("u", FILTERS);
    const agg = sqlOf();
    expect(agg).toContain("SUM(q.quality_sum) / NULLIF(SUM(q.audited_calls), 0)");
    expect(agg).toContain("SUM(o.aht_sum) / NULLIF(SUM(o.aht_days), 0)");
    expect(agg).not.toMatch(/AVG\(q\.quality_score\)|AVG\(o\.aht\)/);
  });

  it("reports people cost from the salary snapshot when one exists", async () => {
    execute.mockResolvedValue(rowWith({ people_cost: "123456.78" }));
    const [row] = await svc.getProcessRows("u", FILTERS);
    const pnl = row.sections.find((s) => s.key === "pnl")!;
    expect(pnl.availability).toBe("ok");
    expect(pnl.value).toBe(123457);
  });

  it("says which period has no snapshot rather than showing zero cost", async () => {
    execute.mockResolvedValue(rowWith({ people_cost: null }));
    const [row] = await svc.getProcessRows("u", FILTERS);
    const pnl = row.sections.find((s) => s.key === "pnl")!;
    expect(pnl.availability).toBe("no_data");
    expect(pnl.value).toBeNull();
    expect(pnl.note).toMatch(/snapshot/i);
  });

  it("offers a root cause only where the schema categorises one", async () => {
    execute.mockResolvedValue(rowWith({ quality_score: 81.5, aht: 42 }));
    const [row] = await svc.getProcessRows("u", FILTERS);
    const by = Object.fromEntries(row.sections.map((s) => [s.key, s.hasRootCause]));
    expect(by.late_comers).toBe(true);
    expect(by.shrinkage).toBe(true);
    // No categorised exit reason exists on `employees`, so a breakdown would be invented.
    expect(by.attrition).toBe(false);
    // The call audit scores 20 named parameters separately, so "which parameter
    // is failing" is recorded data rather than an inference.
    expect(by.quality).toBe(true);
    expect(by.operations).toBe(false);
  });
});

describe("metric detail refuses to invent a breakdown", () => {
  it("returns rootCause null with a reason for attrition", async () => {
    execute.mockResolvedValue([[{ exits: 1, late_marks: 1, issues: 1 }]]);
    const d = await svc.getMetricDetail("u", "attrition", FILTERS);
    expect(d.rootCause).toBeNull();
    expect(d.rootCauseNote).toMatch(/not categorised/i);
  });

  it("reads each section from its OWN source, not from attendance", async () => {
    // The bug this guards: the record list was hard-wired to
    // attendance_daily_record for all ten sections, so a Quality cell listed
    // each person's attendance-day count under a Quality heading.
    execute.mockReset().mockResolvedValue([[]]);
    await svc.getMetricDetail("u", "quality", FILTERS);
    const sql = execute.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    // Quality is the call audit warehouse. mas_hrms.qa_audit is empty and the
    // QUALITY_SCORE rows in kpi_daily_actual reach two processes; this table
    // holds 13,513 assessed August calls, all matching an employee_code.
    expect(sql).toContain("db_audit.call_quality_assessment");
    expect(sql).not.toContain("attendance_daily_record");
    // CallDate is a DATETIME, so BETWEEN would silently drop the last day.
    expect(sql).toContain("DATE_ADD(?, INTERVAL 1 DAY)");
    expect(sql).not.toMatch(/CallDate BETWEEN/);

    execute.mockReset().mockResolvedValue([[]]);
    await svc.getMetricDetail("u", "operations", FILTERS);
    expect(execute.mock.calls.map((c: unknown[]) => String(c[0])).join("\n"))
      .toContain("kpi_daily_actual");

    execute.mockReset().mockResolvedValue([[]]);
    await svc.getMetricDetail("u", "pnl", FILTERS);
    expect(execute.mock.calls.map((c: unknown[]) => String(c[0])).join("\n"))
      .toContain("pnl_running_salary_snapshot");

    execute.mockReset().mockResolvedValue([[{ late_marks: 1, issues: 1, exits: 1 }]]);
    await svc.getMetricDetail("u", "hygiene", FILTERS);
    expect(execute.mock.calls.map((c: unknown[]) => String(c[0])).join("\n"))
      .toContain("attendance_reconciliation_issue");
  });

  it("marks a record as drillable only where its id is a filter one level down", async () => {
    // A leaver is not a manager: pushing their id as managerId opened an empty
    // level that read as "no data".
    execute.mockReset().mockResolvedValue([[{ id: "e1", name: "A", subtitle: "E1", value: 12, exits: 1 }]]);
    const leavers = await svc.getMetricDetail("u", "attrition", FILTERS);
    expect(leavers.records.every((r) => r.drillAs === null)).toBe(true);

    execute.mockReset().mockResolvedValue([[{ id: "m1", name: "M", subtitle: "M1", value: 5 }]]);
    const atProcess = await svc.getMetricDetail("u", "shrinkage", { ...FILTERS, processId: "p1" });
    expect(atProcess.records[0].drillAs).toBe("manager");

    execute.mockReset().mockResolvedValue([[{ id: "a1", name: "A", subtitle: "A1", value: 5 }]]);
    const atAgent = await svc.getMetricDetail("u", "shrinkage", { ...FILTERS, employeeId: "a1" });
    expect(atAgent.records[0].drillAs).toBeNull();
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

  it("reads mandate detail from the cost centre master", async () => {
    execute.mockReset().mockResolvedValue([[]]);
    const d = await svc.getMetricDetail("u", "mandate", FILTERS);
    expect(sqlOf()).toContain("cost_centre_master");
    // mandated_seats is a VARCHAR holding "4", "0", "" and "NA" — anything that
    // is not a plain number is absent data, and must not be read as zero.
    expect(sqlOf()).toContain("REGEXP");
    expect(d.availability).toBe("no_data");
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
    const literals = ["/processes", "/filters", "/managers", "/agents"].map((p) => ROUTES.indexOf(`"${p}"`));
    const param = ROUTES.indexOf('"/detail/:section"');
    expect(Math.min(...literals)).toBeGreaterThan(-1);
    expect(param).toBeGreaterThan(Math.max(...literals));
  });

  it("guards every route with auth and a role check", () => {
    const handlers = [...ROUTES.matchAll(/router\.get\(/g)];
    expect(handlers.length).toBe(5);
    const guarded = [...ROUTES.matchAll(/router\.get\([^)]*requireAuth, requireRole\(\.\.\.VIEWER_ROLES\)/g)];
    expect(guarded.length).toBe(5);
  });

  it("does not list super_admin, which requireRole already short-circuits", () => {
    const block = ROUTES.slice(ROUTES.indexOf("const VIEWER_ROLES"), ROUTES.indexOf("] as const;"));
    expect(block).not.toContain("super_admin");
  });

  it("builds its default window from local calendar fields, not toISOString", () => {
    // The server runs in Asia/Kolkata, where a locally-built midnight Date is
    // 18:30 UTC the DAY BEFORE. toISOString() there silently shifted the whole
    // default window back by a day at both ends.
    expect(ROUTES).not.toMatch(/\.toISOString\(\)/);
    expect(ROUTES).toContain("d.getFullYear()");
  });

  it("rejects an unknown section rather than passing it into SQL", () => {
    expect(ROUTES).toContain("UNKNOWN_SECTION");
    expect(ROUTES).toMatch(/SECTION_KEYS\.includes\(section\)/);
  });
});
