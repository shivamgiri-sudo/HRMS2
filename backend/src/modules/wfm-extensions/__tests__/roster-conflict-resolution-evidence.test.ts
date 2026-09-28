import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * RR12 / RR13 — WFM Roster deep audit, 2026-09-12, validated against deployed commit 9a6bee69.
 *
 * The Roster Requests "Swaps & conflicts" tab requires a manager to type a Resolution Action
 * before it will let them resolve a roster conflict, and POSTs it as
 * { resolution_action, remarks }. The backend discarded all of it:
 *
 *   router.post("/roster/conflicts/:id/resolve", ..., h(async (req, res) => {
 *     await rosterConflictService.resolve(req.params.id, req.authUser!.id, req);   // no req.body
 *     res.json({ success: true, ok: true });                                       // always 200
 *   }));
 *
 *   async resolve(id, resolvedBy, req?) {
 *     await db.execute("UPDATE wfm_roster_conflict_log SET resolved = 1 WHERE id = ?", [id]);
 *     await logSensitiveAction({ ... });   // no change_summary either
 *   }
 *
 * So: the decision was unrecoverable, a nonexistent id returned success, re-resolving an
 * already-resolved conflict silently succeeded twice, and — unlike the GET directly above it —
 * the route applied no employeeScope(), letting any team_leader resolve any branch's conflict.
 *
 * These handlers are inline on a router with no exported service seam and no DB harness in this
 * suite, so as with the sibling coverage-snapshot-scope.test.ts the fix is pinned at source
 * level. That is deliberate: it stops a future refactor quietly reverting to the bare UPDATE.
 */
describe("roster conflict resolution persists its evidence (RR12)", () => {
  const service = readFileSync(resolve(__dirname, "../wfm-ext.service.ts"), "utf-8");

  function resolveFn(): string {
    const start = service.indexOf("async resolve(");
    expect(start, "rosterConflictService.resolve not found").toBeGreaterThan(-1);
    const end = service.indexOf("export const coverageService", start);
    expect(end, "end marker (coverageService) not found").toBeGreaterThan(start);
    return service.slice(start, end);
  }

  it("no longer runs the bare unguarded resolved = 1 update", () => {
    expect(service).not.toContain('UPDATE wfm_roster_conflict_log SET resolved = 1 WHERE id = ?');
  });

  it("writes resolution_action, resolution_remarks, resolved_by and resolved_at", () => {
    const fn = resolveFn();
    expect(fn).toMatch(/resolution_action\s*=\s*\?/);
    expect(fn).toMatch(/resolution_remarks\s*=\s*\?/);
    expect(fn).toMatch(/resolved_by\s*=\s*\?/);
    expect(fn).toMatch(/resolved_at\s*=\s*NOW\(\)/);
  });

  it("guards the update on resolved = 0 and asserts exactly one row changed", () => {
    const fn = resolveFn();
    expect(fn).toMatch(/WHERE id = \? AND resolved = 0/);
    expect(fn).toMatch(/result\.affectedRows !== 1/);
  });

  it("distinguishes not-found from already-resolved instead of reporting success for both", () => {
    const fn = resolveFn();
    expect(fn).toMatch(/statusCode:\s*404/);
    expect(fn).toMatch(/statusCode:\s*409/);
  });

  it("applies the caller's row scope to the existence check, via a join on employees", () => {
    const fn = resolveFn();
    expect(fn).toMatch(/JOIN employees e ON e\.id = c\.employee_id/);
    expect(fn).toMatch(/scope\.sql/);
    expect(fn).toMatch(/scope\.params/);
  });

  it("records a before/after change_summary on the audit entry", () => {
    const fn = resolveFn();
    expect(fn).toMatch(/change_summary/);
    expect(fn).toMatch(/before:/);
    expect(fn).toMatch(/after:/);
  });

  it("stops passing the detection description off as the resolution remarks", () => {
    // The list mapper used to read `resolution_remarks: row.description ?? null`, which made a
    // detection note look like a resolution decision even though none was ever stored.
    expect(service).not.toMatch(/resolution_remarks:\s*row\.description/);
    expect(service).toMatch(/resolution_remarks:\s*row\.resolution_remarks/);
    expect(service).toMatch(/description:\s*row\.description/);
  });
});

describe("the resolve route reads and validates the body it used to discard (RR12/RR13)", () => {
  const routes = readFileSync(resolve(__dirname, "../wfm-ext.routes.ts"), "utf-8");

  function resolveRoute(): string {
    const start = routes.indexOf('router.post("/roster/conflicts/:id/resolve"');
    expect(start, "resolve route not found").toBeGreaterThan(-1);
    const end = routes.indexOf('router.get("/coverage"', start);
    expect(end, "end marker (GET /coverage) not found").toBeGreaterThan(start);
    return routes.slice(start, end);
  }

  it("reads resolution_action off the request body", () => {
    expect(resolveRoute()).toMatch(/req\.body\?\.resolution_action/);
  });

  it("rejects a missing resolution_action with 400 rather than silently resolving", () => {
    const route = resolveRoute();
    expect(route).toMatch(/status\(400\)/);
    expect(route).toMatch(/resolution_action is required/);
  });

  it("computes employeeScope and hands it to the service", () => {
    const route = resolveRoute();
    expect(route).toMatch(/employeeScope\(req\.authUser!\.id\)/);
    expect(route).toMatch(/scope,/);
  });
});

describe("the columns the fix writes to actually exist", () => {
  it("ships a migration adding the four evidence columns", () => {
    const sql = readFileSync(
      resolve(__dirname, "../../../../sql/1759_roster_conflict_resolution_evidence.sql"),
      "utf-8",
    );
    for (const column of ["resolution_action", "resolution_remarks", "resolved_by", "resolved_at"]) {
      expect(sql, `${column} not added`).toContain(`ADD COLUMN ${column}`);
      // Guarded on information_schema so the migration is rerunnable, per the repo convention.
      expect(sql).toContain(`column_name='${column}'`);
    }
    expect(sql).toContain("wfm_roster_conflict_log");
  });

  it("registers that migration in the manifest, so it runs on deploy", () => {
    const manifest = readFileSync(resolve(__dirname, "../../../db/runPendingMigrations.ts"), "utf-8");
    expect(manifest).toContain('"1759_roster_conflict_resolution_evidence.sql"');
  });
});
