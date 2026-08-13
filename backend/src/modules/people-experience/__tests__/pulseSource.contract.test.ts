import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * People Experience must read pulse answers from `pulse_response`, never from `pulse_check`.
 *
 * `pulse_check` is the QUESTION master: id, pulse_question, pulse_type, response_type,
 * active_status, created_at, updated_at. It carries no employee_id, no submitted_at and no mood
 * column, and never has. Every pulse read in this service used to select those fields from it,
 * which is ER_BAD_FIELD_ERROR on every call — and because `scalar()` swallows the error and
 * returns its fallback, the module reported a mood of 3 and 0 pulses for every employee as though
 * they were measurements. A wrong number that looks plausible is worse than a failure, because
 * nothing surfaces it.
 *
 * The engagement module fixed exactly this and pinned it in
 * engagement/__tests__/engagementHealthColumns.contract.test.ts. People Experience was missed, so
 * the same guard lives here.
 *
 * Source-level assertions rather than a live query: the defect is which table the SQL names, and
 * that is decidable from the text without a database.
 */

const MODULE_PATH = "src/modules/people-experience/people-experience.service.ts";
const source = () => readFileSync(resolve(process.cwd(), MODULE_PATH), "utf8");

describe("people-experience pulse source", () => {
  it("never reads pulse answers from the question master", () => {
    const code = source();
    expect(code).not.toMatch(/FROM pulse_check\b/);
    expect(code).not.toMatch(/JOIN pulse_check\b/);
  });

  it("does not reference columns that pulse_check has never had", () => {
    const code = source();
    // Comments explain the history; SQL must not name them.
    const sqlOnly = code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    // Bare identifiers only. `average_mood_score` is this module's own API field name and is
    // deliberately allowed — the banned thing is the pulse_check COLUMN, mood_score / mood_rating.
    expect(sqlOnly).not.toMatch(/(?<![\w_])mood_score(?![\w_])/);
    expect(sqlOnly).not.toMatch(/(?<![\w_])mood_rating(?![\w_])/);
  });

  it("reads from pulse_response", () => {
    expect(source()).toMatch(/FROM pulse_response/);
  });

  it("windows pulse rows on response_time/response_date, not submitted_at", () => {
    const code = source();
    expect(code).toMatch(/COALESCE\(pr\.response_time, pr\.response_date\)/);
    const sqlOnly = code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(sqlOnly).not.toMatch(/pulse_response[\s\S]{0,200}submitted_at/);
  });

  /**
   * response_value is varchar(50) and holds whatever the question's response_type produced. An
   * implicit coercion would read 'happy' as 0 and drag the mean down without any error, so the
   * numeric filter and the cast both have to be explicit.
   */
  it("parses response_value explicitly before averaging it", () => {
    const code = source();
    expect(code).toMatch(/CAST\(pr\.response_value AS DECIMAL/);
    expect(code).toMatch(/response_value REGEXP/);
  });

  /**
   * The fabricated value is the actual defect. With no pulse data the old code produced a mood of
   * 3, a pulse score of 60, and carried a fifth of every employee's engagement score on it.
   */
  it("does not substitute a fabricated mood when there is no response", () => {
    const code = source();
    expect(code).toMatch(/pulseAverage/);
    // The old shape: scalar(..., 3) supplying a default mood.
    expect(code).not.toMatch(/\[employeeId\],\s*3\s*\)/);
    expect(code).toMatch(/pulseAvg === null/);
  });

  it("renormalises component weights instead of scoring a missing pulse", () => {
    const code = source();
    expect(code).toMatch(/weightTotal/);
    expect(code).toMatch(/value !== null/);
  });
});
