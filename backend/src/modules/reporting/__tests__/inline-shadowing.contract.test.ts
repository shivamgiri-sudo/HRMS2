import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EXECUTOR_MAP } from "../executors/index.js";

/**
 * A report code must not have BOTH an inline `case` block in report-suite.routes.ts and a
 * registered executor. When it does, the inline block wins — the switch returns before the
 * default branch that calls executeReport() — and the executor is dead code at runtime.
 *
 * This is not theoretical. Verified live on 2026-08-07: `headcount` had both. The executor
 * had been corrected to the agreed definition (active_status alone, 1,125 employees) but
 * the inline copy still carried the superseded two-flag filter, so the API served 1,123.
 * Every contract test passed throughout, because they inspect the catalogue and the
 * executor source — neither of which tells you which one actually runs.
 *
 * `employee-master` was the same: its executor emits cost_centre_code and filters to active
 * employees; the inline block emitted neither and returned all 58,627 employee rows.
 *
 * 40 codes were in this state when the check was written. The allowlist below is that
 * backlog, and it may only shrink. Removing an entry means deleting the inline block so the
 * code falls through to its executor — after confirming the executor's output columns match
 * what the catalogue promises, since the response shape changes with it.
 */

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const inlineCodes = (): Set<string> => {
  const src = read("src/modules/reporting/report-suite.routes.ts");
  return new Set([...src.matchAll(/^\s{4}case "([a-z0-9-]+)"/gm)].map(m => m[1]));
};

/**
 * Codes still served by an inline block despite having an executor. Shrink only.
 * Each removal needs the executor's columns checked against the catalogue first.
 */
const SHADOWED_BACKLOG = new Set<string>([
  "anniversary-list", "attendance-daily", "attendance-dispute-summary", "attendance-summary",
  "biometric-reconciliation", "birthday-list", "clearance-status-register",
  "confirmation-due-list", "contract-expiry-list", "cost-centre-headcount", "daily-hc-shift",
  "daily-shrinkage-report", "employee-master", "employee-movement",
  "gratuity-liability-register", "grievance-register", "habitual-absentee-list",
  "holiday-master-list", "identity-source-snapshot", "increment-promotion-history",
  "late-arrival-summary", "leave-allocation-register", "leave-balance-export",
  "leave-encashment-register", "leave-lapse-summary", "leave-lwp-reconciliation",
  "leave-trend-monthly", "lifecycle-events", "manager-mapping", "maternity-paternity-register",
  "monthly-attrition-summary", "monthly-shrinkage-trend", "org-structure-snapshot",
  "overtime-summary", "payroll-register", "payroll-variance", "punch-raw-export",
  "regularization-summary", "shift-adherence-detail",
]);

describe("inline route blocks must not shadow executors", () => {
  const inline = inlineCodes();
  const execs = new Set(Object.keys(EXECUTOR_MAP));

  it("finds both sets", () => {
    expect(inline.size).toBeGreaterThan(50);
    expect(execs.size).toBeGreaterThan(50);
  });

  it("headcount is served by its executor, not an inline copy", () => {
    // The specific regression this test was written for: the inline copy returned 1,123
    // against the executor's 1,125 for months of contract tests passing.
    expect(inline.has("headcount")).toBe(false);
    expect(execs.has("headcount")).toBe(true);
  });

  it("no NEW code shadows an executor", () => {
    const shadowed = [...inline].filter(c => execs.has(c)).sort();
    const unexpected = shadowed.filter(c => !SHADOWED_BACKLOG.has(c));

    expect(
      unexpected,
      `these codes have an inline case AND an executor, so the executor is dead code:\n` +
        `${unexpected.join("\n")}\n` +
        `Delete the inline block so the code falls through to executeReport().`,
    ).toEqual([]);
  });

  it("the shadowing backlog only shrinks", () => {
    const shadowed = new Set([...inline].filter(c => execs.has(c)));
    const fixedButStillListed = [...SHADOWED_BACKLOG].filter(c => !shadowed.has(c)).sort();

    expect(
      fixedButStillListed,
      `these are no longer shadowed — remove them from SHADOWED_BACKLOG:\n${fixedButStillListed.join("\n")}`,
    ).toEqual([]);
  });
});
