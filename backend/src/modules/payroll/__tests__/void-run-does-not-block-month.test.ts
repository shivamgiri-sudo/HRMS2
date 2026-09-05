/**
 * A cancelled payroll run must not block its own replacement.
 *
 * The one-company-run-per-month rule is right, but it was enforced by matching on run_month,
 * branch_filter, process_filter and scope_kind — and on NO status. So ANY existing row occupied
 * the month permanently. Reject a run and the month became unrunnable; the only way back was to
 * delete the row, taking its audit trail with it.
 *
 * That turned a bad row into a dead end on production. salary_prep_run 5035d780 carried status
 * FINALIZED while having computed nobody's pay — total_employees = 0, three salary lines against
 * July's 1,371, no payslips, no bank transfers, validation_status 'pending', no approver, no
 * disburser. It had the label of a finished run and none of the substance, and while it sat
 * there August 2026 could not be run at all.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { VOID_RUN_STATUSES, VOID_RUN_STATUSES_SQL, CLOSED_RUN_STATUSES, isRunClosed } from "../run-status.js";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const service = fs.readFileSync(path.resolve(DIR, "..", "payroll.service.ts"), "utf8");

/** The company-run duplicate check. */
function duplicateCheck(): string {
  const idx = service.indexOf("Payroll run already exists for this month");
  expect(idx, "duplicate check not found").toBeGreaterThan(-1);
  return service.slice(idx - 900, idx + 100);
}

describe("the duplicate check ignores voided runs", () => {
  it("filters on status at all", () => {
    // The whole defect: month + branch + process + scope_kind, and no status.
    expect(duplicateCheck()).toContain("VOID_RUN_STATUSES_SQL");
  });

  it("compares case- and whitespace-insensitively", () => {
    /*
     * This table holds 'FINALIZED' from the payroll UI and 'locked' from older code — the exact
     * casing split run-status.ts's own isRunClosed() exists to paper over. A status guard that
     * matched only one casing would be a guard that does not hold.
     */
    expect(duplicateCheck()).toContain("LOWER(TRIM(COALESCE(status,'')))");
  });

  it("excludes rather than includes, so an unknown status still blocks", () => {
    // NOT IN (void) means anything unrecognised is treated as occupying the month. Getting this
    // backwards would let a status typo silently permit a second live run for one month.
    expect(duplicateCheck()).toMatch(/NOT IN \(\$\{VOID_RUN_STATUSES_SQL\}\)/);
  });
});

describe("what counts as voided", () => {
  it("is cancelled and rejected, and nothing else", () => {
    expect([...VOID_RUN_STATUSES].sort()).toEqual(["cancelled", "rejected"]);
  });

  it("keeps the SQL form in step with the set", () => {
    // Two spellings of one rule is how they drift apart; assert they agree rather than trusting it.
    const fromSql = VOID_RUN_STATUSES_SQL.split(",").map((s) => s.trim().replace(/'/g, "")).sort();
    expect(fromSql).toEqual([...VOID_RUN_STATUSES].sort());
  });

  it("does not overlap with the closed statuses", () => {
    /*
     * A closed run is finished and must not be recomputed. A voided run never happened. Letting
     * the two sets overlap would either let a real finalized run be replaced, or leave a
     * cancelled one still blocking its month.
     */
    for (const s of VOID_RUN_STATUSES) {
      expect(CLOSED_RUN_STATUSES.has(s), `${s} must not be both void and closed`).toBe(false);
    }
  });

  it("leaves a live run blocking, in every casing the table actually stores", () => {
    for (const live of ["finalized", "FINALIZED", "locked", "disbursed", " Finalized "]) {
      expect(VOID_RUN_STATUSES.has(live.trim().toLowerCase())).toBe(false);
      expect(isRunClosed(live), `${live} should still read as closed`).toBe(true);
    }
  });

  it("does not make a cancelled run recomputable", () => {
    // Freeing the month is not the same as reopening the run. Nothing should recompute a run
    // that never happened either.
    for (const s of VOID_RUN_STATUSES) expect(isRunClosed(s)).toBe(false);
  });
});
