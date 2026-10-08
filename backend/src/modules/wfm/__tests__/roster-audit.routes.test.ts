import { describe, it, expect, vi, beforeEach } from "vitest";
import { callHandler, getHandler, norm } from "./lobTestUtils";

const { calls, respond } = vi.hoisted(() => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const respond = { fn: (_sql: string): unknown[] => [] as unknown[] };
  return { calls, respond };
});
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return [respond.fn(sql), []];
    }),
  },
}));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (_q: any, _s: any, n: any) => n(),
}));
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: () => (_q: any, _s: any, n: any) => n(),
}));

// The by-id handlers check the row's own branch / process (console-scope). Tests call handlers directly, so
// supply the caller's scope here: org-wide by default, switchable per test.
const { scopeRef } = vi.hoisted(() => ({ scopeRef: { roles: ['super_admin'] as string[], branchId: null as string | null } }));
vi.mock('../console-scope.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../console-scope.js')>();
  return {
    ...real,
    getScope: async () => ({ userId: 'u', roles: scopeRef.roles, branchId: scopeRef.branchId, processId: null, assignments: [] }),
  };
});

import { rosterAuditRouter } from '../roster-audit.routes';

const get = (
  path: string,
  query: Record<string, unknown> = {},
  params: Record<string, string> = {},
) => callHandler(getHandler(rosterAuditRouter, "get", path), { query, params });

beforeEach(() => { calls.length = 0; respond.fn = () => []; scopeRef.roles = ['super_admin']; scopeRef.branchId = null; });

describe("GET /trails", () => {
  it("resolves actor names from auth user id (employees.user_id), not employees.id", async () => {
    respond.fn = (sql) => {
      if (
        sql.includes("FROM roster_decision_audit rda") &&
        sql.includes("LIMIT")
      ) {
        return [
          {
            id: "a1",
            date: "2026-09-01",
            changeType: "manual_override",
            reason: "x",
            overrideReason: "cover",
            timestamp: "2026-09-01 10:00:00",
            employeeId: "e1",
            employeeCode: "C1",
            employeeName: "Emp One",
            changedById: "auth-1",
            triggeredById: null,
          },
        ];
      }
      if (sql.includes("COUNT(*) AS total")) return [{ total: 250 }];
      if (sql.includes("FROM employees"))
        return [
          {
            id: "e9",
            user_id: "auth-1",
            full_name: "Manager Mia",
            employee_code: "M9",
          },
        ];
      return [];
    };
    const out = await get("/trails", {
      dateFrom: "2026-09-01",
      dateTo: "2026-09-07",
      limit: "50",
      offset: "50",
    });
    expect(out.status).toBe(200);
    expect(out.body.total).toBe(250);
    expect(out.body.trails[0].changedBy).toBe("Manager Mia");
    expect(out.body.trails[0].isOverride).toBe(true);
    const main = norm(calls[0].sql);
    expect(main).toContain("LEFT JOIN wfm_shift_template st"); // was wfm_shift_master (wrong table for template ids)
    expect(main).toContain("LIMIT 50 OFFSET 50");
    expect(calls.some((c) => c.sql.includes("user_id IN"))).toBe(true);
  });

  it("flags engine error rows and labels them", async () => {
    respond.fn = (sql) =>
      sql.includes("LIMIT") && sql.includes("roster_decision_audit")
        ? [
            {
              id: "a2",
              date: "2026-09-01",
              changeType: "shift_assigned",
              reason: "error:boom",
              overrideReason: null,
              timestamp: "t",
              employeeId: "e1",
              changedById: null,
              triggeredById: null,
            },
          ]
        : [];
    const out = await get("/trails");
    expect(out.body.trails[0]).toMatchObject({
      changeTypeCode: "engine_error",
      changeType: "Engine Error",
      isEngineError: true,
      changedBy: "System",
    });
  });

  it("400s on bad dates and unknown changeType", async () => {
    expect((await get("/trails", { dateFrom: "yesterday" })).status).toBe(400);
    expect((await get("/trails", { changeType: "nope" })).status).toBe(400);
  });

  it("filters by changeType excluding engine error rows, and branch via COALESCE", async () => {
    await get("/trails", { changeType: "shift_assigned", branchId: "b1" });
    const sql = norm(calls[0].sql);
    expect(sql).toContain(
      "rda.decision_type = ? AND (rda.rule_applied IS NULL OR rda.rule_applied NOT LIKE 'error:%')",
    );
    expect(sql).toContain("COALESCE(rda.branch_id, e.branch_id) = ?");
    expect(calls[0].params).toEqual(["b1", "shift_assigned"]);
  });
});

describe("GET /summary", () => {
  it("excludes engine errors from totals, computes decimal rate, deltas and daily series", async () => {
    respond.fn = (sql) => {
      if (sql.includes("GROUP BY rda.decision_type"))
        return [
          {
            decision_type: "shift_assigned",
            is_error: 0,
            count: 990,
            overrides: 3,
          },
          {
            decision_type: "shift_assigned",
            is_error: 1,
            count: 7,
            overrides: 0,
          },
          {
            decision_type: "manual_override",
            is_error: 0,
            count: 10,
            overrides: 10,
          },
        ];
      if (sql.includes("GROUP BY rda.roster_date"))
        return [{ d: "2026-09-01", total: 5, overrides: 1 }];
      if (sql.includes("COUNT(*) AS total, COALESCE(SUM(rda.override_by"))
        return [{ total: 500, overrides: 13 }];
      if (sql.includes("GROUP BY rgr.run_type"))
        return [
          {
            run_type: "auto",
            status: "completed",
            count: 2,
            assignments: 100,
            conflicts: 1,
          },
          {
            run_type: "rerun",
            status: "failed",
            count: 1,
            assignments: 0,
            conflicts: 4,
          },
        ];
      if (sql.includes("COALESCE(SUM(rgr.conflicts_found)"))
        return [{ count: 2, conflicts: 5 }];
      return [];
    };
    const out = await get("/summary", {
      dateFrom: "2026-09-01",
      dateTo: "2026-09-07",
    });
    expect(out.status).toBe(200);
    const b = out.body;
    expect(b.totalChanges).toBe(1000);
    expect(b.engineErrors).toBe(7);
    expect(b.manualOverrides).toBe(13);
    expect(b.overrideRate).toBe(1.3);
    expect(b.previousPeriod).toEqual({ from: "2026-08-25", to: "2026-08-31" });
    expect(b.deltas.totalChanges).toBe(100);
    expect(b.generationRuns).toMatchObject({
      auto: 2,
      manual: 1,
      total: 3,
      failed: 1,
      totalConflicts: 5,
    });
    expect(b.daily).toEqual([{ date: "2026-09-01", total: 5, overrides: 1 }]);
  });

  it("run window is half-open (no next-day midnight double count) and honours branch/process", async () => {
    await get("/summary", {
      dateFrom: "2026-09-01",
      dateTo: "2026-09-07",
      branchId: "b1",
      processId: "p1",
    });
    const run = calls.find((c) => c.sql.includes("GROUP BY rgr.run_type"))!;
    const sql = norm(run.sql);
    expect(sql).toContain(
      "rgr.started_at >= ? AND rgr.started_at < DATE_ADD(?, INTERVAL 1 DAY)",
    );
    expect(sql).toContain("rgr.branch_id = ? AND rgr.process_id = ?");
    expect(run.params).toEqual(["2026-09-01", "2026-09-07", "b1", "p1"]);
    expect(sql).not.toContain("BETWEEN");
  });

  it("400 on reversed range", async () => {
    expect(
      (await get("/summary", { dateFrom: "2026-09-07", dateTo: "2026-09-01" }))
        .status,
    ).toBe(400);
  });
});

describe("GET /generation-runs", () => {
  it('filters, pages, resolves trigger name, and keeps 0s duration (not "running")', async () => {
    respond.fn = (sql) => {
      if (sql.includes("COUNT(*) AS total")) return [{ total: 3 }];
      if (sql.includes("FROM roster_generation_run"))
        return [
          {
            id: "r1",
            cycleId: "c1",
            processName: "P",
            runType: "auto",
            status: "completed",
            employeesProcessed: 4,
            assignmentsCreated: 28,
            weekoffsAllocated: 4,
            conflictsFound: 0,
            startedAt: "s",
            completedAt: "c",
            durationSeconds: 0,
            triggeredById: "auth-1",
          },
        ];
      if (sql.includes("FROM employees"))
        return [
          {
            id: "e1",
            user_id: "auth-1",
            full_name: "Trig",
            employee_code: "T1",
          },
        ];
      return [];
    };
    const out = await get("/generation-runs", {
      branchId: "b1",
      status: "failed",
      dateFrom: "2026-09-01",
    });
    expect(out.body.total).toBe(3);
    expect(out.body.runs[0]).toMatchObject({
      duration: 0,
      triggeredBy: "Trig",
    });
    const sql = norm(calls[0].sql);
    expect(sql).toContain("rgr.branch_id = ?");
    expect(sql).toContain("rgr.status = ?");
    expect((await get("/generation-runs", { status: "bogus" })).status).toBe(
      400,
    );
  });
});

describe("detail endpoints", () => {
  it("trail detail 404s for unknown id", async () => {
    const out = await get("/trails/:id", {}, { id: "missing" });
    expect(out.status).toBe(404);
  });
  it("trail detail returns timeline, engine fields and amendments", async () => {
    respond.fn = (sql) => {
      if (sql.includes("rda.*"))
        return [
          {
            id: "a1",
            roster_date: "2026-09-03",
            decision_type: "manual_override",
            rule_applied: "post_publication_amendment",
            override_reason: "swap",
            override_by: "auth-1",
            override_at: "2026-09-02 09:00:00",
            created_at: "2026-09-02 09:00:00",
            employee_id: "e1",
            cycle_id: "c1",
            run_id: null,
            is_week_off: 0,
            fairness_score: "1.50",
            employeeName: "E",
            employeeCode: "C",
          },
        ];
      if (sql.includes("FROM roster_change_log"))
        return [
          {
            id: "l1",
            changeType: "shift_change",
            reason: "swap",
            changeDate: "2026-09-03",
            changedById: "auth-1",
            timestamp: "t",
            newAssignmentType: "SHIFT",
            isLateChange: 1,
            leadTimeHours: 10,
          },
        ];
      if (sql.includes("FROM employees"))
        return [
          {
            id: "e9",
            user_id: "auth-1",
            full_name: "PM Pat",
            employee_code: "P1",
          },
        ];
      return [];
    };
    const out = await get("/trails/:id", {}, { id: "a1" });
    expect(out.status).toBe(200);
    expect(out.body.engine.fairnessScore).toBe(1.5);
    expect(out.body.changedBy).toBe("PM Pat");
    expect(out.body.timeline.map((t: any) => t.event)).toContain(
      "Manual override",
    );
    expect(out.body.amendments[0]).toMatchObject({
      isLateChange: true,
      changedBy: "PM Pat",
      leadTimeHours: 10,
    });
    expect(out.body.run).toBeNull();
  });
  it('branch scope: a branch head cannot open another branch\'s audit row or generation run by id', async () => {
    scopeRef.roles = ['branch_head']; scopeRef.branchId = 'branch-own';
    respond.fn = (sql) => {
      if (sql.includes('rda.*')) return [{ id: 'a1', roster_date: '2026-09-03', decision_type: 'x', rule_applied: 'y', created_at: 't', employee_id: 'e1', scopeBranchId: 'branch-other', scopeProcessId: null }];
      if (sql.includes('rgr.*')) return [{ id: 'r1', cycle_id: 'c1', branch_id: 'branch-other', process_id: null }];
      return [];
    };
    expect((await get('/trails/:id', {}, { id: 'a1' })).status).toBe(403);
    expect((await get('/generation-runs/:id', {}, { id: 'r1' })).status).toBe(403);
    // ...but their own branch's rows open.
    respond.fn = (sql) => sql.includes('rda.*')
      ? [{ id: 'a1', roster_date: '2026-09-03', decision_type: 'x', rule_applied: 'y', created_at: 't', override_by: null, employee_id: 'e1', cycle_id: null, run_id: null, is_week_off: 0, scopeBranchId: 'branch-own', scopeProcessId: null }]
      : [];
    expect((await get('/trails/:id', {}, { id: 'a1' })).status).toBe(200);
  });
  it('run detail summarises ALL decisions, not just the 100 listed', async () => {
    respond.fn = (sql) => {
      if (sql.includes("rgr.*"))
        return [
          {
            id: "r1",
            cycle_id: "c1",
            run_type: "auto",
            status: "partial",
            triggered_by: "auth-1",
            started_at: "s",
            completed_at: "c",
            error_details: '["x"]',
            parameters_json: '{"a":1}',
          },
        ];
      if (sql.includes("GROUP BY decision_type"))
        return [
          { decision_type: "shift_assigned", is_error: 0, count: 240 },
          { decision_type: "shift_assigned", is_error: 1, count: 2 },
        ];
      return [];
    };
    const out = await get("/generation-runs/:id", {}, { id: "r1" });
    expect(out.body.decisionTotal).toBe(242);
    expect(out.body.engineErrorCount).toBe(2);
    expect(out.body.errorDetails).toEqual(["x"]);
    expect(out.body.decisionSummary[0]).toMatchObject({
      label: "Shift Assigned",
      count: 240,
    });
  });
});
