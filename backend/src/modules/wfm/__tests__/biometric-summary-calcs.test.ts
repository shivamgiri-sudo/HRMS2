import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Pins the calculation fixes in /adherence-summary (found in the WFM dashboard audit). Source-shape
 * assertions, as in the sibling parallel-queries test: the failure mode is a query using the wrong
 * denominator, a copied metric or the wrong day, and there is no live database in this suite.
 */
const source = readFileSync(resolve(__dirname, "../biometric-summary.routes.ts"), "utf-8");
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*(\/\/|--).*$/gm, "");
const handler = (() => {
  const start = code.indexOf('biometricSummaryRouter.get("/adherence-summary"');
  const next = code.indexOf("biometricSummaryRouter.get(", start + 10);
  return code.slice(start, next === -1 ? code.length : next);
})();

describe("adherence-summary calculations", () => {
  it("attendance rate uses the canonical numerator/denominator (half = 0.5, expected-to-work only)", () => {
    expect(source).toContain('attendedDaysSql("adr.attendance_status")');
    expect(source).toContain('expectedToWorkSql("adr.attendance_status")');
    // the old form: half_day counted whole, every row (holidays, week-offs, leave) in the denominator
    expect(handler).not.toMatch(/IN \('present','half_day'\)\) \* 100\.0 \/ NULLIF\(COUNT\(\*\), 0\), 2\) AS adherence_pct/);
  });

  it("shrinkage excludes week-off/holiday from the denominator and includes approved leave", () => {
    expect(handler).toMatch(/attendance_status IN \('absent','leave_approved'\)[\s\S]*?NOT IN \('holiday','week_off'\)[\s\S]*?AS shrinkage_pct/);
    expect(handler).toContain("unplanned_shrinkage_pct");
    expect(handler).toContain("planned_shrinkage_pct");
  });

  it("does not republish the attendance rate under other names", () => {
    expect(handler).toMatch(/NULL AS on_time_out_pct/);
    expect(handler).toMatch(/NULL AS weekly_compliance_pct/);
    expect(handler).toMatch(/NULL AS multiple_punch/);
    expect(handler).toMatch(/NULL AS invalid_punch/);
  });

  it("late-arrival bands are contiguous and match their 0-1h / 1-4h / 4h+ labels", () => {
    expect(handler).toContain("late_by_minutes > 0 AND adr.late_by_minutes <= 60");
    expect(handler).toContain("late_by_minutes > 60 AND adr.late_by_minutes <= 240");
    expect(handler).not.toContain("late_by_minutes > 30 THEN 1 ELSE 0 END) AS variance_0_1");
  });

  it("roster coverage is scoped and anchored on the latest complete day, and keeps null as null", () => {
    expect(handler).toContain("LATEST_COMPLETE_ATTENDANCE_DATE_SQL");
    expect(handler).not.toContain("SELECT MAX(record_date) FROM attendance_daily_record WHERE record_date <= CURDATE()");
    expect(handler).toContain("scopeOnlyParams");
    expect(handler).not.toMatch(/fully_covered: Number\(coverage\.fully_covered \?\? 0\)/);
  });

  it("regularisation summary is scoped, windowed and has no phantom 'cancelled' status", () => {
    expect(handler).toMatch(/FROM attendance_regularization r\s+WHERE r\.status IN \('pending','manager_approved'\)/);
    expect(handler).toContain("INTERVAL 30 DAY");
    expect(handler).not.toMatch(/SUM\(status = 'cancelled'\)/);
    expect(handler).not.toMatch(/FROM attendance_regularization`/);
  });

  it("'today' is the IST date, not the UTC date", () => {
    expect(code).toMatch(/function today\(\): string \{\s*return new Date\(Date\.now\(\) \+ 5\.5 \* 3_600_000\)/);
  });
});
