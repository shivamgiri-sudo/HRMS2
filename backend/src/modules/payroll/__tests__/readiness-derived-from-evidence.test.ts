/**
 * Readiness flags must be read from evidence, not from what somebody remembered.
 *
 * Five checklist items on payroll_branch_readiness are ticked by hand, and the service's own
 * note admits they "verify nothing — the checklist POST writes the column with no query behind
 * it". So the score ran on attestation, and could be wrong in both directions: a branch could
 * claim work it had not done, or — as happened — do the work and still read as blocked.
 *
 * HEAD OFFICE, AUGUST 2026. All four of its cost centres reached 'ho_approved' on the CC
 * attendance chain (HR finalize -> Branch Head -> HO) on 4 September, and every pending leave
 * and regularization for the month had been cleared. The branch still showed
 * attendance_data_ready = 0, leave_finalized = 0 and regularization_complete = 0, scored 42 of
 * 100, and rendered "Blocked" — because three boxes describing finished, recorded work were
 * never ticked.
 *
 * The derivation READS the sign-off; it does not replace it. The CC chain is a stronger signal
 * than the checkbox it was duplicating, and "nothing pending" IS the finished state for leave
 * and regularizations.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.resolve(DIR, "..", "payroll-branch-readiness.service.ts"), "utf8");

/** The derivation block added to refreshLiveMetrics. */
function derivation(): string {
  const start = src.indexOf("// --- Derive the attestations from evidence");
  expect(start, "derivation block not found").toBeGreaterThan(-1);
  return src.slice(start, src.indexOf("// --- Persist updates when table exists", start));
}

describe("attendance readiness comes from the cost-centre sign-off chain", () => {
  it("reads payroll_cc_attendance_finalization", () => {
    // The chain the branch actually completes. Before this, nothing in branch readiness looked
    // at it at all — two systems recording the same fact, neither aware of the other.
    expect(derivation()).toContain("payroll_cc_attendance_finalization");
  });

  it("requires the HO-approved stage, not merely HR-finalised", () => {
    // hr_finalized and branch_head_approved are earlier stages. Crediting either would call a
    // branch ready before the approval that actually closes it.
    expect(derivation()).toMatch(/LOWER\(f\.status\) = 'ho_approved'/);
  });

  it("requires EVERY staffed cost centre, not just one", () => {
    // A branch with four cost centres and one approved is not ready. `approved >= staffed` is
    // the whole safety of this derivation.
    expect(derivation()).toContain("approved >= staffed");
  });

  it("counts only cost centres that actually have staff", () => {
    /*
     * An empty cost centre has nothing to finalise and will never appear in the finalization
     * table, so counting it would hold the branch permanently short of its own total. Equally,
     * a branch with no staffed cost centres must not be credited on an empty set — hence
     * `staffed > 0` as well.
     */
    const d = derivation();
    expect(d).toContain("e.active_status = 1");
    expect(d).toContain("staffed > 0");
  });

  it("scopes both halves to the same branch and month", () => {
    // Counting one branch's cost centres against another month's approvals would be worse than
    // no derivation at all.
    const d = derivation();
    expect(d).toContain("ccm.branch_id = ?");
    expect(d).toContain("f.branch_id = ? AND f.process_month = ?");
  });
});

describe("leave and regularizations come from the outstanding-work counters", () => {
  it("treats nothing pending as finished", () => {
    const d = derivation();
    expect(d).toMatch(/pending_leave_count \?\? -1\) === 0\) updates\.leave_finalized = 1/);
    expect(d).toMatch(/pending_regularization_count \?\? -1\) === 0\) updates\.regularization_complete = 1/);
  });

  it("does not treat an unknown count as zero", () => {
    /*
     * The counters are wrapped in safeQuery and fall back when the query cannot run. Defaulting
     * a MISSING count to 0 would read "we could not check" as "nothing outstanding" and mark the
     * branch finished on the strength of a failed query — the exact silent-success failure this
     * codebase keeps paying for. `?? -1` makes unknown fail the comparison.
     */
    expect(derivation()).toContain("?? -1");
    expect(derivation()).not.toMatch(/pending_leave_count \?\? 0/);
  });
});

describe("a derivation can correct a false negative but never invent a positive", () => {
  it("only ever raises a flag, never clears one", () => {
    /*
     * Every write here is `= 1` under a condition. Nothing sets a flag to 0, so a tick a human
     * has already made — for something this cannot see evidence of — survives. The derivation
     * can rescue a branch wrongly reading blocked; it cannot silently un-approve one.
     */
    const d = derivation();
    expect(d).not.toMatch(/updates\.(attendance_data_ready|leave_finalized|regularization_complete)\s*=\s*0/);
    expect((d.match(/updates\.\w+ = 1/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("degrades to not-ready when the evidence query fails", () => {
    // safeQuery's fallback is 0, so an environment where the CC table is missing reads as "no
    // evidence" rather than as ready.
    const d = derivation();
    const idx = d.indexOf("cc_attendance_ho_approved");
    expect(idx).toBeGreaterThan(-1);
    expect(d.slice(Math.max(0, idx - 120), idx)).toMatch(/\b0,\s*$|\b0,\s*\n\s*"/);
  });
});

describe("custom deductions: nothing to upload is not the same as not done", () => {
  it("is satisfied only when the branch has no deduction entries for the month", () => {
    /*
     * Owner ruling: deductions are not mandatory every month. Worth 10 of 100 and satisfiable
     * only by a tick, a branch with nothing to deduct was permanently penalised for not
     * confirming an upload it had no reason to make — Head Office sat at 72 against a threshold
     * of 80 for exactly this, with employee_deduction_entries holding ONE row company-wide.
     */
    const d = derivation();
    expect(d).toContain("employee_deduction_entries");
    expect(d).toMatch(/deductionsPending === 0\) updates\.custom_deductions_uploaded = 1/);
  });

  it("leaves the manual confirmation in place when entries DO exist", () => {
    /*
     * "Somebody uploaded some deductions" does not establish that they uploaded all of them.
     * That judgement needs a person, and this is the one case where the tick earns its keep — so
     * there must be exactly ONE place setting this flag, guarded by the zero-entries condition,
     * and no unconditional second one.
     */
    const d = derivation();
    expect((d.match(/custom_deductions_uploaded = 1/g) ?? []).length).toBe(1);
    expect(d).toMatch(/if \(deductionsPending === 0\) updates\.custom_deductions_uploaded = 1/);
  });

  it("scopes the count to this branch and month", () => {
    const d = derivation();
    expect(d).toContain("d.run_month = ?");
    expect(d).toContain("e.branch_id = ?");
  });

  it("treats an unreadable count as unsatisfied, not as zero", () => {
    // safeQuery's fallback is -1 here precisely so a failed query cannot read as "no deductions
    // exist" and hand the branch 10 points it has not earned.
    const d = derivation();
    const idx = d.indexOf("deduction_entry_count");
    expect(idx).toBeGreaterThan(-1);
    expect(d.slice(Math.max(0, idx - 200), idx)).toContain("-1,");
  });
});
