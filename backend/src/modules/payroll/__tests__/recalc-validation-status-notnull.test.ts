import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Recalculating a run cleared its approval stamps with `validation_status = NULL`.
 *
 * salary_prep_run.validation_status is enum('pending','validated','rejected') NOT NULL DEFAULT
 * 'pending', and production runs STRICT_TRANS_TABLES — so that write is ER_BAD_NULL_ERROR, not a
 * silent coercion to ''. It threw inside the transaction, the catch rolled the whole
 * recalculation back, and the run was reset to draft. No payroll was written and nothing was
 * corrupted; the recalculation simply never happened.
 *
 * It stayed invisible because almost nothing exercised the path: the only caller of the recalc
 * queue drain was the tail of a COSEC sync, 200 rows at a time. The moment a scheduled drainer
 * started working the backlog on 2026-08-16, 793 queued recalculations failed against it, every
 * one reading "Column 'validation_status' cannot be null".
 *
 * The four sibling stamp columns cleared in the same statement — validated_by, validated_at,
 * finance_approved_by, ceo_acknowledged_by — are all nullable, which is why only this one bit and
 * why the surrounding code looked correct.
 */

const SOURCE = readFileSync(
  resolve(process.cwd(), "src/modules/payroll/payrollCalculate.service.ts"),
  "utf8",
);

/** The single UPDATE that clears approval stamps. Sliced so an unrelated query cannot satisfy this. */
const RESET = (() => {
  const start = SOURCE.indexOf("`UPDATE salary_prep_run\n        SET status = 'processing'");
  return start === -1 ? "" : SOURCE.slice(start, start + 800);
})();

describe("recalculation clears the validation stamp without violating NOT NULL", () => {
  it("found the stamp-clearing UPDATE — the assertions below are not vacuous", () => {
    expect(RESET).not.toBe("");
    expect(RESET).toMatch(/finance_approved_by = NULL/);
  });

  it("never writes NULL into validation_status", () => {
    expect(RESET).not.toMatch(/validation_status = NULL/);
  });

  it("clears it to 'pending', the enum's own not-yet-validated state", () => {
    expect(RESET).toMatch(/validation_status = 'pending'/);
  });

  it("still clears the stamp columns that ARE nullable", () => {
    // The point of the 2026-08-14 change was that a signature must never describe figures a later
    // recalculation has changed. Fixing the NOT NULL violation must not quietly drop that.
    for (const col of ["validated_by", "validated_at", "finance_approved_by", "ceo_acknowledged_by"]) {
      expect(RESET, `${col} must still be cleared`).toMatch(new RegExp(`${col} = NULL`));
    }
  });

  it("has no other NULL write to validation_status anywhere in the file", () => {
    expect(SOURCE).not.toMatch(/validation_status\s*=\s*NULL/);
  });
});
