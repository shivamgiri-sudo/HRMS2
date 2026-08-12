import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Five of the signals feeding the engagement health score queried columns and
 * tables that do not exist, and every failure was invisible.
 *
 * scalar() in shared/dbHelpers.ts ends in a bare `catch { return fallback }`, so
 * an ER_BAD_FIELD_ERROR is indistinguishable from "no data for this employee".
 * Each broken query silently contributed its fallback instead of its signal:
 *
 *   attendance_daily_record was queried on attendance_date and status. The
 *   columns are record_date and attendance_status. Both scalars threw, so
 *   workedDays came back 0 and the function returned the flat 65 default - for
 *   every employee, against 125,125 rows of real attendance.
 *
 *   performance_feedback_response was queried for AVG(overall_rating) WHERE
 *   reviewee_id. It has neither: one row per (request_id, competency_id) holding
 *   a 1-5 rating, with the employee on performance_feedback_request.
 *
 *   pulse_check was queried for employee_id, mood_score and submitted_at. It is
 *   the question master - 8 rows, one per pulse question. Answers are in
 *   pulse_response.
 *
 *   survey_response was queried on submitted_at; the column is response_date.
 *
 *   getFilterOptions selected department_name from department_master, where the
 *   column is dept_name. That one is not wrapped in scalar(), so it returned a
 *   500 rather than a wrong number.
 *
 * Verified against production 8.0.42 by PREPAREing every query in the file,
 * which resolves table and column names without executing: 20 of 31 passed
 * before, 28 after. The three that still fail are two tables that genuinely do
 * not exist (guarded by tableExists, so those signals are simply unavailable)
 * and one WHERE-clause fragment that is not a standalone statement.
 */
const SERVICE = path.resolve(__dirname, "../engagement-health.service.ts");

/**
 * The phantom column names are named in this file's own comments, explaining
 * what they used to be. Matching against raw source would flag those and make
 * the guard unfixable, so comments come out first.
 */
function liveCode(): string {
  return fs
    .readFileSync(SERVICE, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
}

describe("engagement health signals query columns that exist", () => {
  it("reads attendance by record_date, not attendance_date", () => {
    const code = liveCode();
    expect(code).not.toMatch(/attendance_date/);
    expect(code).toMatch(/FROM attendance_daily_record WHERE employee_id = \? AND record_date/);
  });

  it("filters attendance on attendance_status, the real enum column", () => {
    const code = liveCode();
    expect(code).toContain("attendance_status = 'absent'");
    // the old list named a bare `status` column and values this enum never had.
    // Scoped to the attendance query: line 134 filters a different table whose
    // `status` column is real.
    expect(code).not.toMatch(/attendance_daily_record[\s\S]{0,200}AND status IN \(/);
    expect(code).not.toContain("'absent','Absent','A','LWP'");
  });

  it("averages the real feedback rating through the request join", () => {
    const code = liveCode();
    expect(code).not.toMatch(/overall_rating/);
    expect(code).not.toMatch(/reviewee_id/);
    expect(code).toMatch(/AVG\(resp\.rating\)/);
    expect(code).toMatch(/JOIN performance_feedback_request req/);
  });

  it("counts pulse answers from pulse_response, not the question master", () => {
    const code = liveCode();
    expect(code).not.toMatch(/FROM pulse_check\b/);
    expect(code).not.toMatch(/mood_score/);
    expect(code).toMatch(/FROM pulse_response/);
  });

  it("dates survey responses by response_date", () => {
    const code = liveCode();
    expect(code).toMatch(/FROM survey_response WHERE employee_id = \? AND response_date/);
  });

  it("selects dept_name in the filter options, which is not wrapped in scalar()", () => {
    const code = liveCode();
    // department_name survives only as an output alias of the real dept_name
    expect(code).not.toMatch(/department_name AS name/);
    expect(code).not.toMatch(/ORDER BY department_name/);
    expect(code).toMatch(/dept_name AS name FROM department_master/);
  });

  it("does not put LIMIT inside an IN subquery, which MySQL 8 rejects", () => {
    // ER_NOT_SUPPORTED_YET: 'LIMIT & IN/ALL/ANY/SOME subquery'
    expect(liveCode()).not.toMatch(/IN \(\s*SELECT[\s\S]{0,120}LIMIT/);
  });
});
