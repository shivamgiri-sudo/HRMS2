import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * RR17 and RR16 — WFM Roster deep audit, 2026-09-12, validated against deployed commit 9a6bee69.
 *
 * RR17 (Critical, data exposure). GET /coverage computes the caller's row scope and passes it in:
 *
 *   const scope = await employeeScope(req.authUser!.id);
 *   res.json(await coverageService.summarize({ ...(req.query as any), ...scope }));
 *
 * but summarize() consumed `filters.sql` in ONE of its two branches. The live fallback applied
 * it; the snapshot branch never referenced it. So on any date that happened to have a snapshot,
 * every role the route allows — manager, assistant_manager, team_leader, branch_head,
 * process_manager, operations_manager — got whole-company planned/actual headcount, coverage_pct
 * and shrinkage, plus the raw snapshot rows in `data`. The same caller on a date with no
 * snapshot got correctly scoped numbers, so the exposure was data-dependent and easy to miss.
 *
 * The sibling coverage-snapshot-scope.test.ts pins the snapshot WRITE path (a previously fixed
 * hole in computedCoverageSnapshot's manual-override branch). This file pins the READ path.
 *
 * RR16 (Critical, double counting). The snapshot rows were summed indiscriminately.
 * POST /coverage/snapshot stores process_id/branch_id as NULL when the caller supplies neither,
 * so a whole-scope aggregate row and the per-process component rows for the same date coexist in
 * wfm_coverage_snapshot — and MySQL treats NULLs as distinct in a UNIQUE index, so
 * uq_coverage_date_proc does not stop several NULL/NULL aggregate rows accumulating on one date
 * either. Every one of them landed in the same reduce().
 */
describe("coverage snapshot READ path applies the caller's scope (RR17)", () => {
  const service = readFileSync(resolve(__dirname, "../wfm-ext.service.ts"), "utf-8");

  function snapshotBranch(): string {
    const start = service.indexOf("const snapshotConds = [");
    expect(start, "snapshot branch not found").toBeGreaterThan(-1);
    const end = service.indexOf("const rosterConds = [", start);
    expect(end, "live-fallback marker not found").toBeGreaterThan(start);
    return service.slice(start, end);
  }

  it("references filters.sql inside the snapshot branch, not only in the live fallback", () => {
    expect(snapshotBranch()).toMatch(/filters\.sql/);
  });

  it("authorises each snapshot row against in-scope employees in that process and branch", () => {
    const branch = snapshotBranch();
    expect(branch).toMatch(/EXISTS \(SELECT 1 FROM employees e/);
    expect(branch).toMatch(/e\.process_id = s\.process_id/);
    expect(branch).toMatch(/e\.branch_id = s\.branch_id/);
  });

  it("binds the scope params, so the predicate is not interpolated unbound", () => {
    expect(snapshotBranch()).toMatch(/snapshotParams\.push\(\.\.\.\(filters\.params \?\? \[\]\)\)/);
  });

  it("never hands a scoped caller a coarser-grain row that spans scopes they do not own", () => {
    // A process-wide row (branch_id NULL) covers branches a branch-scoped manager does not own,
    // and a NULL/NULL row is a whole-org aggregate. Both are excluded for scoped callers.
    const branch = snapshotBranch();
    expect(branch).toMatch(/s\.process_id IS NOT NULL/);
    expect(branch).toMatch(/s\.branch_id IS NOT NULL/);
  });

  it("treats only an explicit 1=1 predicate as unscoped", () => {
    // employeeScope() returns { sql: "1=1" } for admin/hr/wfm/ceo; anything else is scoped and
    // must go through the EXISTS check. Defaulting the other way would reopen the hole.
    expect(snapshotBranch()).toMatch(/isUnscoped/);
    expect(snapshotBranch()).toMatch(/"1=1"/);
  });
});

describe("coverage snapshot totals use one grain and cannot double count (RR16)", () => {
  const service = readFileSync(resolve(__dirname, "../wfm-ext.service.ts"), "utf-8");

  function snapshotSum(): string {
    const start = service.indexOf("if (snapshotRows.length) {");
    expect(start, "snapshot sum block not found").toBeGreaterThan(-1);
    const end = service.indexOf("const rosterConds = [", start);
    expect(end, "live-fallback marker not found").toBeGreaterThan(start);
    return service.slice(start, end);
  }

  it("separates component rows from whole-scope aggregate rows", () => {
    const block = snapshotSum();
    expect(block).toMatch(/componentRows/);
    expect(block).toMatch(/aggregateRows/);
  });

  it("sums one grain only, preferring the finer component grain when it exists", () => {
    expect(snapshotSum()).toMatch(/componentRows\.length > 0 \? componentRows : aggregateRows/);
  });

  it("dedupes by grain key so repeated NULL-scope aggregate rows cannot stack", () => {
    const block = snapshotSum();
    expect(block).toMatch(/seenGrain/);
    expect(block).toMatch(/process_id \?\? "\*"/);
  });

  it("computes the totals from the deduped set, not the raw row set", () => {
    const block = snapshotSum();
    expect(block).toMatch(/rowsForSum\.reduce/);
    expect(block).not.toMatch(/snapshotRows\.reduce/);
  });

  it("returns the same rows the totals came from", () => {
    expect(snapshotSum()).toMatch(/data: rowsForSum/);
  });

  it("drops the LIMIT that could silently truncate a SUM", () => {
    // `LIMIT 200` on a query whose rows get added together means a large date quietly reports a
    // partial required_headcount with nothing on screen to say so.
    expect(snapshotSum()).not.toMatch(/LIMIT 200/);
    const branchStart = service.indexOf("FROM wfm_coverage_snapshot s");
    const branchEnd = service.indexOf("snapshotParams,", branchStart);
    expect(service.slice(branchStart, branchEnd)).not.toMatch(/LIMIT/);
  });
});

describe("the coverage response says which path produced it", () => {
  const service = readFileSync(resolve(__dirname, "../wfm-ext.service.ts"), "utf-8");

  it("labels snapshot and live results distinctly", () => {
    // An archived point-in-time figure and a computed-now figure can legitimately disagree; the
    // response previously gave the caller no way to tell which one it held.
    expect(service).toMatch(/source: "snapshot" as const/);
    expect(service).toMatch(/source: "live" as const/);
  });

  it("reports the grain and how many rows were considered vs summed", () => {
    expect(service).toMatch(/snapshot_grain/);
    expect(service).toMatch(/snapshot_rows_considered/);
    expect(service).toMatch(/snapshot_rows_summed/);
  });
});
