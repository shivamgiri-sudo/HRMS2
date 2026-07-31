import { describe, expect, it } from "vitest";
import { CLOSED_RUN_STATUSES, isRunClosed, CLOSED_RUN_STATUSES_SQL } from "../run-status.js";

/**
 * These tests exist because the guards they back were inert for the whole life
 * of the table.
 *
 * Every closed-run check was written `["locked", "disbursed"]`. Production has
 * no run in either status — runs finish as FINALIZED, stored uppercase — so all
 * 67 runs, including 51 finalized ones going back to 2021-03, were open to
 * recalculation. Recalculating one rewrites its lines from today's salary
 * structures, attendance and statutory config, over figures already paid and
 * already filed in a quarterly TDS return.
 *
 * The casing assertions are not pedantry: a case-sensitive check against
 * 'finalized' would still have missed every real row.
 */

describe("closed payroll run statuses", () => {
  it("treats FINALIZED as closed — the case that was missing", () => {
    // The whole defect in one assertion. 51 production runs are in this status.
    expect(isRunClosed("FINALIZED")).toBe(true);
  });

  it("matches regardless of casing, because the lifecycle is written both ways", () => {
    // 'FINALIZED' comes from the payroll UI, 'locked' from older code. A guard
    // that only holds for one casing does not hold.
    for (const s of ["FINALIZED", "finalized", "Finalized", "LOCKED", "locked", "Disbursed"]) {
      expect(isRunClosed(s), `expected ${s} to be closed`).toBe(true);
    }
  });

  it("tolerates surrounding whitespace rather than failing open", () => {
    expect(isRunClosed("  FINALIZED  ")).toBe(true);
  });

  it("leaves genuinely in-flight runs editable", () => {
    // 16 production runs are in these states and must stay recalculable —
    // closing them would break normal payroll work.
    for (const s of ["draft", "processing", "approved", "reviewed", "calculated"]) {
      expect(isRunClosed(s), `expected ${s} to be open`).toBe(false);
    }
  });

  it("treats an absent status as open, not closed", () => {
    // Failing closed here would block every run whose status failed to load,
    // which is a worse outcome than the read being retried.
    expect(isRunClosed(null)).toBe(false);
    expect(isRunClosed(undefined)).toBe(false);
    expect(isRunClosed("")).toBe(false);
  });

  it("keeps the SQL fragment in step with the set", () => {
    // Two spellings of one rule; they drift silently if nothing compares them.
    for (const status of CLOSED_RUN_STATUSES) {
      expect(CLOSED_RUN_STATUSES_SQL).toContain(`'${status}'`);
    }
    const sqlCount = CLOSED_RUN_STATUSES_SQL.split(",").length;
    expect(sqlCount).toBe(CLOSED_RUN_STATUSES.size);
  });

  it("still contains the original two statuses", () => {
    // Widening the set must not quietly drop what it already covered.
    expect(isRunClosed("locked")).toBe(true);
    expect(isRunClosed("disbursed")).toBe(true);
  });
});
