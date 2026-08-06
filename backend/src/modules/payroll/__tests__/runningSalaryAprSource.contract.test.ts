/**
 * The running-month figure must say which evidence it rests on.
 *
 * Operations Executives are configured to be judged on dialler net login, but
 * attendance-engine.service.ts:809-828 falls back to the biometric punch on any
 * day APR has nothing for. That fallback is correct — 626 of 829 active
 * Operations Executives had no APR row at all in 2026-08, and judging them on an
 * empty feed would mark every one of them absent, lwp 1.00. MAS48907 is the
 * shape of it: zero APR rows since June, yet 3 present + 2 half days built from
 * `attendance_source='biometric'`.
 *
 * What was wrong is that none of this reached the screen: computeRunningSalary
 * read only attendance_status and lwp_value, so biometric-derived earnings were
 * presented with nothing distinguishing them from APR-verified ones.
 *
 * The two contracts below are what keep the fix honest:
 *   1. the split is a SUBTRACTION from the existing total, never a second
 *      formula — so verified + fallback always equals what payroll will pay;
 *   2. no fourth Operations-Executive regex. Three already exist in this
 *      codebase and they disagree; eligibility must come from the engine.
 *
 * Source contracts rather than a live call: the arithmetic is verified against
 * production data separately, and what is asserted here is the shape that keeps
 * it from drifting back.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const SERVICE = fs.readFileSync(
  path.resolve(__dirname, "..", "running-salary.service.ts"), "utf8");
const ROUTES = fs.readFileSync(
  path.resolve(__dirname, "..", "running-salary.routes.ts"), "utf8");

describe("running salary reports APR provenance", () => {
  it("reads the source columns it classifies on", () => {
    expect(SERVICE).toMatch(/attendance_source,\s*source_system/);
  });

  it("counts a paid day as unverified only when it was classified on a punch", () => {
    expect(SERVICE).toMatch(/source === "biometric"/);
    expect(SERVICE).toMatch(/apr_no_activity/);
  });

  it("returns the provenance fields", () => {
    for (const field of [
      "apr_eligible",
      "apr_verified_payable_days",
      "apr_verified_salary_till_date",
      "fallback_payable_days",
      "fallback_salary_till_date",
      "apr_no_data_days",
    ]) {
      expect(SERVICE, `${field} missing from the payload`).toContain(field);
    }
  });

  it("derives the verified figure by subtraction, so the split cannot drift from the total", () => {
    // The whole safety property: verified = total - fallback. Any independent
    // recomputation of the verified amount could disagree with what is paid.
    expect(SERVICE).toMatch(/earnedSalaryTillDate\s*-\s*fallbackSalaryTillDate/);
    expect(SERVICE).toMatch(/cappedEarned\s*-\s*fallbackPaidDays/);
  });

  it("resolves eligibility through the engine, not a fourth regex", () => {
    expect(SERVICE).toMatch(/attendanceEngineService\.isAprEligible/);
    // The three existing copies disagree; this file must not add another.
    expect(SERVICE).not.toMatch(/\/\^?executive/i);
    expect(SERVICE).not.toMatch(/isOperationsExecutiveByRegex/);
  });

  it("never fails the salary read when provenance cannot be resolved", () => {
    const at = SERVICE.indexOf("isAprEligible");
    expect(at).toBeGreaterThan(-1);
    const block = SERVICE.slice(Math.max(0, at - 600), at + 600);
    expect(block).toMatch(/catch/);
  });

  it("leaves a finalized month ungated — that money is already decided", () => {
    // Matching the returned VALUE, not the first mention — `apr_eligible` also
    // appears in the helper's declared return type, which says nothing about
    // what the finalized path actually sends.
    expect(ROUTES).toMatch(/apr_eligible:\s*false/);
  });

  it("reports nothing for employees the engine does not judge on APR", () => {
    // Non-Operations employees must keep the exact payload they had before.
    expect(SERVICE).toMatch(/aprEligible\s*\?[\s\S]{0,120}:\s*null/);
  });
});
