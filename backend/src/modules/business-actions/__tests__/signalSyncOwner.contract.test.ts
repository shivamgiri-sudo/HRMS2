import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Two defects in business-actions.signal-sync, both proven against production.
 *
 * The attendance-gap query did `GROUP BY ... e.reporting_manager_user_id` - the
 * SELECT alias, but qualified with the table alias, so MySQL resolved it as a
 * real column of employees and raised ER_BAD_FIELD_ERROR. Column resolution
 * happens before any row is matched, so it threw on every run regardless of
 * data, and that sync has never created a single action.
 *
 * Both queries also aliased e.reporting_manager_id as reporting_manager_user_id
 * and fed it to owner_user_id, which business-actions.service joins to auth_user
 * in three places. Measured: 500 of 500 reporting_manager_id values match
 * employees.id and 0 match auth_user.id, so the owner could never resolve.
 */
const SRC = path.resolve(__dirname, "../business-actions.signal-sync.ts");

describe("business action signal sync", () => {
  const code = () => fs.readFileSync(SRC, "utf8");

  /** Source with `//` comment lines removed — the file explains the old bug in
   *  prose, and a guard that matches its own documentation is worthless. */
  const liveCode = () =>
    code()
      .split("\n")
      .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*"))
      .join("\n");

  it("never groups by a table-qualified select alias", () => {
    // `e.` + an alias that exists only in the SELECT list is the exact shape
    // that threw. Any GROUP BY term must name a real column.
    expect(liveCode()).not.toMatch(/GROUP BY[^`]*e\.reporting_manager_user_id/);
  });

  it("takes the manager's user id, not the manager's employee id", () => {
    const src = code();
    // owner_user_id is joined to auth_user, so it must be populated from
    // employees.user_id of the manager row.
    expect(src).toContain("mgr.user_id AS reporting_manager_user_id");
    expect(src).not.toContain("e.reporting_manager_id AS reporting_manager_user_id");
  });

  it("joins the manager row in both queries that need it", () => {
    const src = code();
    const joins = src.match(/LEFT JOIN employees mgr ON mgr\.id = e\.reporting_manager_id/g) ?? [];
    // people-risk and attendance-gap
    expect(joins.length).toBeGreaterThanOrEqual(2);
  });

  it("still falls back to HR when the manager has no login", () => {
    // 121 of 1,115 active employees have no auth_user, so mgr.user_id is NULL
    // for them and the action must not end up ownerless.
    expect(code()).toMatch(/owner_role:\s*\w+\.reporting_manager_user_id\s*\?\s*null\s*:\s*['"]hr['"]/);
  });

  /**
   * Payroll readiness sync: proven live against production mas_hrms.
   *
   * There is no table named payroll_run in mas_hrms (confirmed via
   * information_schema.tables) — the real payroll-run table is
   * salary_prep_run. tableExists("payroll_run") therefore always returned
   * false and syncPayrollReadiness short-circuited on every scheduled run,
   * even though payrollGovernanceService.readiness() itself reads
   * salary_prep_run directly and works.
   */
  it("reads the real payroll run table, not the nonexistent payroll_run", () => {
    const src = liveCode();
    expect(src).toContain('tableExists("salary_prep_run")');
    expect(src).not.toMatch(/tableExists\(["']payroll_run["']\)/);
    expect(src).toMatch(/FROM\s+salary_prep_run/);
    expect(src).not.toMatch(/FROM\s+payroll_run\b/);
  });

  it("filters open payroll runs using the shared closed-status definition", () => {
    // run-status.ts is the single source of truth for "settled; do not
    // recompute" (FINALIZED/locked/disbursed) — reuse it here rather than
    // guessing at status strings salary_prep_run doesn't actually use
    // ('pending_approval' never appears live; 'draft'/'processing'/'approved' do).
    const src = code();
    expect(src).toContain("CLOSED_RUN_STATUSES_SQL");
    expect(src).not.toMatch(/status\s+IN\s*\(\s*'draft'\s*,\s*'pending_approval'\s*\)/);
  });

  /**
   * business_action_queue.source_id is char(36). run.id is already a 36-char
   * UUID, so `${run.id}_${issue.code}` always overflowed and every INSERT for
   * a payroll-readiness issue failed with ER_DATA_TOO_LONG (proven live:
   * 10/10 scanned issues, 0 created, before this fix). The per-run try/catch
   * only console.error'd it — a silent failure identical in shape to others
   * already found in this codebase.
   */
  it("hashes the payroll issue source_id instead of concatenating past the column limit", () => {
    const src = code();
    expect(src).toMatch(/createHash\(['"]md5['"]\)\.update\(`\$\{run\.id\}_\$\{issue\.code\}`\)\.digest\(['"]hex['"]\)/);
    expect(src).not.toContain("source_id: `${run.id}_${issue.code}`");
  });

  /**
   * ensureAction's dedup SELECT and its INSERT must clamp source_id/title the
   * same way and reuse the same clamped value — clamping only inside the
   * INSERT tuple would look up the row by the raw (unclamped) value, never
   * find what a prior run actually stored, and re-insert a duplicate action
   * every sync cycle instead of deduping against it.
   */
  it("clamps title/source_id once and reuses the clamped value for both the lookup and the insert", () => {
    const src = code();
    const ensureActionBody = src.slice(src.indexOf("async function ensureAction"));
    expect(ensureActionBody).toMatch(/const sourceId = clamp\(input\.source_id, 36\)/);
    expect(ensureActionBody).toMatch(/const title = clamp\(input\.title, 500\)/);
    // The SELECT (dedup lookup) must bind the clamped variable, not input.source_id directly.
    const selectClause = ensureActionBody.slice(0, ensureActionBody.indexOf("INSERT INTO business_action_queue"));
    expect(selectClause).toContain("[input.source_module, sourceId, input.risk_type]");
  });
});
