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
});
