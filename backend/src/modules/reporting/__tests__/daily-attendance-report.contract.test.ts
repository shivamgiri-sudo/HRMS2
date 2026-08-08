import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

/**
 * The Daily Attendance Report had no test at all. It was rewritten on 31-Jul to drive from
 * `employees LEFT JOIN attendance_daily_record` so that employees with no attendance row
 * would still appear — the report's declared grain — and the commit reported "65/65
 * reporting tests" passing, which was true and meaningless: none of them touch this report.
 *
 * The rewrite left the wfm_attendance_session subquery with no date predicate, so every
 * request grouped the whole table (34,398 rows) instead of the day being asked for (792).
 * Measured on production: 11,671ms median before, 3,149ms after, identical 1,125 rows.
 * queryRowsWithCount runs the statement twice, so that was ~23s of database time per load.
 */
describe("daily attendance report", () => {
  const routes = read("src/modules/reporting/report-suite.routes.ts");

  /**
   * The attendance-daily branch only.
   *
   * Anchored on the case label, not on `params.unshift(from, to`. That string was unique when
   * this test was written and stopped being so once other blocks were corrected to unshift
   * their leading params too — the slice then began at an earlier report and ran through into
   * this one, counting both reports' placeholders against one report's arguments. The label is
   * unique by construction; the idiom is not.
   */
  const block = (() => {
    const start = routes.indexOf('case "attendance-daily"');
    expect(start, "attendance-daily branch not found").toBeGreaterThan(-1);
    const end = routes.indexOf("ORDER BY adr.record_date DESC", start);
    expect(end, "attendance-daily branch has no terminating ORDER BY").toBeGreaterThan(start);
    return routes.slice(start, end);
  })();

  it("restricts the session subquery to the requested range", () => {
    // Without this the subquery materialises every session row ever recorded, and because
    // it hangs off the nullable side of a LEFT JOIN nothing downstream can narrow it.
    const subquery = block.slice(block.indexOf("FROM wfm_attendance_session"));
    expect(subquery).toContain("WHERE session_date BETWEEN ? AND ?");
  });

  it("binds exactly as many leading params as there are placeholders before the WHERE", () => {
    // mysql2 binds positionally. Every placeholder added to a JOIN ahead of the WHERE has
    // to be unshifted, and a miscount silently shifts every subsequent value by one rather
    // than raising — the report would return wrong data, not an error.
    const sql = block.slice(block.indexOf("sql = `"));
    const beforeWhere = sql.slice(0, sql.indexOf("WHERE ${clauses"));
    const placeholders = (beforeWhere.match(/\?/g) ?? []).length;

    const unshift = block.slice(block.indexOf("params.unshift("));
    const args = unshift.slice(unshift.indexOf("(") + 1, unshift.indexOf(")")).split(",").filter((a) => a.trim());

    expect(args.length).toBe(placeholders);
  });

  it("joins roster and sessions off the non-nullable employee id", () => {
    // adr is the nullable side. Joining through adr.employee_id means the employees the
    // rewrite was written to surface — those with no attendance row — can never pick up a
    // shift or a punch time even when both exist.
    expect(block).toContain("wra.employee_id = e.id");
    expect(block).toContain("agg_ses.employee_id = e.id");
    expect(block).not.toContain("wra.employee_id = adr.employee_id");
    expect(block).not.toContain("agg_ses.employee_id = adr.employee_id");
  });

  it("keeps the date predicate in the JOIN, not the WHERE", () => {
    // Moving it to WHERE would filter out the NULL side and silently collapse the LEFT
    // JOIN back to an inner join, reintroducing the original defect.
    expect(block).toContain("AND adr.record_date BETWEEN ? AND ?");
  });
});
