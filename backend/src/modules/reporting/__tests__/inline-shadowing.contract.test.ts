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
 *
 * IMPORTANT: these are NOT a to-do list to be cleared in bulk. All 25 were measured
 * against the live API on 2026-08-07 — captured before, block removed, captured after —
 * and only two survived. The rest FAILED, in three distinct ways:
 *
 *   broke outright     birthday-list and anniversary-list returned 0 rows through their
 *                      executor where the inline block returned 1,114 and 1,125.
 *                      attendance-summary stopped responding inside 45s.
 *   grain collapsed    attendance-dispute-summary went from a 26-row detail register
 *                      (dispute date, type, old/requested punches, payroll impact,
 *                      reviewer, resolution) to a 4-row count-by-status aggregate.
 *                      regularization-summary, daily-shrinkage-report and daily-hc-shift
 *                      did the same.
 *   columns lost       leave-lwp-reconciliation lost lwp_days_attendance,
 *                      lwp_days_payroll and variance — the three columns the report
 *                      exists to show. shift-adherence-detail lost punch times and
 *                      adherence_pct; punch-raw-export lost every biometric column.
 *
 * So for most of these the inline block is the BETTER implementation and deleting it
 * would be a regression, however much it looks like dead-code cleanup. Where cost centre
 * is missing on such a report, the fix is to add it to the inline SQL (or bring the
 * executor up to the inline block's depth first) — not to delete the block.
 *
 * Removing an entry from this list therefore means: capture the live response, remove the
 * block, capture again, and confirm the executor's output is a superset at equal or better
 * row count. Two passed that bar and are already gone (manager-mapping, which gained
 * manager code, branch, process and cost centre at an unchanged 1,125 rows; and
 * habitual-absentee-list, whose inline block timed out at 45s where the executor returns
 * 650 rows with cost centre).
 *
 * Separately, employee-movement / payroll-register / payroll-variance / payslip-status /
 * leave-balance are ALSO claimed by report-suite-highrisk.routes.ts, which mounts first.
 * For those there are three implementations and removing the inline block changes nothing
 * observable — which is exactly what the before/after capture showed.
 */
const SHADOWED_BACKLOG = new Set<string>([
  "anniversary-list", "attendance-daily", "attendance-dispute-summary", "attendance-summary",
  "biometric-reconciliation", "birthday-list", "clearance-status-register",
  "confirmation-due-list", "contract-expiry-list", "cost-centre-headcount", "daily-hc-shift",
  "daily-shrinkage-report", "employee-master", "employee-movement",
  "gratuity-liability-register", "grievance-register",
  "holiday-master-list", "identity-source-snapshot", "increment-promotion-history",
  "late-arrival-summary", "leave-allocation-register", "leave-balance-export",
  "leave-encashment-register", "leave-lapse-summary", "leave-lwp-reconciliation",
  "leave-trend-monthly", "lifecycle-events", "maternity-paternity-register",
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
