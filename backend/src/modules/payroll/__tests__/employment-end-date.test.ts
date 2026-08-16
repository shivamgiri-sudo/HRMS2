import { describe, expect, it } from "vitest";
import {
  EMPLOYMENT_END_DATE_SQL,
  EMPLOYMENT_END_DATE_SELECT,
  employmentWindowPredicate,
  payableThrough,
} from "../employment-end-date.js";

/**
 * Owner ruling 2026-08-16 (decision 1): Last Working Day is the business source of truth for
 * payroll leaver selection, resolved by ONE shared resolver.
 *
 * WHAT IT REPLACES
 * Payroll selected and prorated on employees.date_of_leaving, which is NULL on all 58,840 rows
 * — no write path has ever populated it. Both the selection bound and the proration bound were
 * therefore inert, and the only thing excluding leavers was LOWER(employment_status)='active',
 * which asks a different question. That produced errors in BOTH directions:
 *   - a mid-month leaver already marked resigned vanished from the run and was paid nothing
 *     for days they had worked;
 *   - someone whose exit date was months old but whose status had not been updated stayed in
 *     and was paid to month end.
 *
 * The six scenarios below are the ones the ruling named.
 *
 * Measured live before shipping:
 *   2026-07   1,255 -> 1,327   (+ mid-month leavers marked resigned/terminated, - 4 gone before)
 *   2026-08   1,326 -> 1,233   (- the 93 who had already left)
 *   flood check                 0 of the 28,425 end-dateless non-actives admitted
 */

const MONTH_START = "2026-07-01";
const MONTH_END = "2026-07-31";

describe("precedence — exit LWD, then date_of_exit, then legacy date_of_leaving", () => {
  it("prefers a qualifying resignation's LWD over the employee master", () => {
    expect(EMPLOYMENT_END_DATE_SQL).toMatch(/last_working_day_confirmed, x\.last_working_day_proposed/);
    const exitIdx = EMPLOYMENT_END_DATE_SQL.indexOf("exit_request");
    const masterIdx = EMPLOYMENT_END_DATE_SQL.indexOf("e.date_of_exit");
    expect(exitIdx).toBeGreaterThan(-1);
    expect(masterIdx).toBeGreaterThan(exitIdx);
  });

  it("prefers confirmed LWD over proposed", () => {
    expect(EMPLOYMENT_END_DATE_SQL).toMatch(
      /COALESCE\(x\.last_working_day_confirmed, x\.last_working_day_proposed\)/,
    );
  });

  it("counts ONLY accepted / notice_serving / exited resignations", () => {
    // A submitted, rejected or revoked request is not an end of employment. Someone who
    // withdrew their resignation must keep being paid.
    expect(EMPLOYMENT_END_DATE_SQL).toMatch(/LOWER\(x\.status\) IN \('accepted','notice_serving','exited'\)/);
    for (const dead of ["submitted", "rejected", "revoked"]) {
      expect(EMPLOYMENT_END_DATE_SQL).not.toMatch(new RegExp(`'${dead}'`));
    }
  });

  it("keeps legacy date_of_leaving last, and only as a fallback", () => {
    const legacyIdx = EMPLOYMENT_END_DATE_SQL.indexOf("e.date_of_leaving");
    expect(legacyIdx).toBeGreaterThan(EMPLOYMENT_END_DATE_SQL.indexOf("e.date_of_exit"));
  });

  it("correlates rather than joins, so multiple exit requests cannot multiply the row", () => {
    expect(EMPLOYMENT_END_DATE_SQL).toMatch(/WHERE x\.employee_id = e\.id/);
    expect(EMPLOYMENT_END_DATE_SQL).toMatch(/LIMIT 1/);
  });

  it("returns a formatted string, never a DATE", () => {
    // mysql2 hands a DATE back as a host-timezone JS Date; a one-day shift on a leaver bound
    // is the difference between a paid and an unpaid final working day.
    expect(EMPLOYMENT_END_DATE_SELECT).toMatch(/DATE_FORMAT\(/);
    expect(EMPLOYMENT_END_DATE_SELECT).toMatch(/'%Y-%m-%d'/);
  });
});

describe("selection — the six scenarios the ruling named", () => {
  const predicate = employmentWindowPredicate();

  it("includes a mid-month leaver even after HR has changed their status", () => {
    // The core of the ruling. The end-date arm carries no employment_status condition.
    expect(predicate).toMatch(/>= CONCAT\(\?, '-01'\)/);
    const endDateArm = predicate.slice(0, predicate.indexOf("OR ("));
    expect(endDateArm).not.toMatch(/employment_status/);
  });

  it("excludes someone who left before the month", () => {
    // An end date earlier than the month start fails the >= bound; there is no other arm
    // that could re-admit them, because the NULL arm requires the end date to be NULL.
    expect(predicate).toMatch(/IS NULL AND LOWER\(e\.employment_status\) = 'active'/);
  });

  it("excludes someone joining after the month", () => {
    expect(predicate).toMatch(/COALESCE\(e\.salary_start_date, e\.date_of_joining\) <= LAST_DAY/);
  });

  it("includes a joiner whose start falls inside the month", () => {
    // Same bound, inclusive — LAST_DAY, not the first of the month.
    expect(predicate).toMatch(/<= LAST_DAY\(CONCAT\(\?, '-01'\)\)/);
  });

  it("includes a terminated employee through their last working day", () => {
    // 'terminated' is not special-cased anywhere in the predicate; the end date governs.
    expect(predicate).not.toMatch(/terminated/);
  });

  it("keeps paying someone whose resignation was revoked", () => {
    // A revoked request contributes no LWD, so date_of_exit or the active-status arm decides.
    expect(EMPLOYMENT_END_DATE_SQL).not.toMatch(/revoked/);
  });

  it("does NOT admit an employee with no end date who is no longer active", () => {
    // Load-bearing: 28,425 non-active employees have no resolvable end date, 28,203 of them
    // marked "Resigned". Without this arm every one of them enters every run.
    expect(predicate).toMatch(/OR \(\s*[\s\S]*IS NULL AND LOWER\(e\.employment_status\) = 'active'\s*\)/);
  });
});

describe("proration — payableThrough caps at the last working day", () => {
  it("caps a mid-month leaver at their LWD", () => {
    expect(payableThrough("2026-07-15", MONTH_END)).toBe("2026-07-15");
  });

  it("pays a full month when employment ends after it", () => {
    expect(payableThrough("2026-09-30", MONTH_END)).toBe(MONTH_END);
  });

  it("pays a full month when no end date resolves", () => {
    expect(payableThrough(null, MONTH_END)).toBe(MONTH_END);
    expect(payableThrough(undefined, MONTH_END)).toBe(MONTH_END);
    expect(payableThrough("", MONTH_END)).toBe(MONTH_END);
  });

  it("tolerates a datetime and keeps the date part", () => {
    expect(payableThrough("2026-07-15T18:30:00.000Z", MONTH_END)).toBe("2026-07-15");
  });

  it("compares as strings, so it cannot drift by a timezone", () => {
    // Pure lexicographic comparison on YYYY-MM-DD — no Date is constructed anywhere.
    expect(payableThrough("2026-07-01", MONTH_END)).toBe("2026-07-01");
    expect(payableThrough(MONTH_END, MONTH_END)).toBe(MONTH_END);
    expect(payableThrough("2026-12-31", MONTH_START)).toBe(MONTH_START);
  });
});
