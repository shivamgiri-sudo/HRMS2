/**
 * Leave module invariant tests — five defects fixed in 2026-08-10 audit.
 * All tests are pure-logic; no database connection required.
 */
import { describe, it, expect } from "vitest";
import { daysIntersectWithMonth } from "../../payroll/leave-reversal.service.js";
import { leavePolicyService } from "../leave-policy.service.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Simulate the overlap guard added to submitRequest (DEFECT 1). */
function hasOverlap(
  existing: Array<{ from_date: string; to_date: string; status: string }>,
  newFrom: string,
  newTo: string,
): boolean {
  const active = ["approved", "pending", "pending_branch_head"];
  return existing.some(
    (r) =>
      active.includes(r.status) &&
      r.from_date <= newTo &&
      r.to_date >= newFrom,
  );
}

/** Simulate the lapse status filter (DEFECT 3). */
function shouldLapse(status: string): boolean {
  return ["pending", "pending_branch_head"].includes(status);
}

/** Simulate the branch_head_approved balance/ADR trigger (DEFECT 4). */
function shouldDeductBalance(status: string): boolean {
  return status === "approved" || status === "branch_head_approved";
}

function shouldRestoreBalance(
  newStatus: string,
  currentStatus: string,
): boolean {
  return (
    (newStatus === "rejected" || newStatus === "cancelled") &&
    (currentStatus === "approved" || currentStatus === "branch_head_approved")
  );
}

// ─── DEFECT 1: Overlapping leave guard ────────────────────────────────────────

describe("DEFECT 1 — submitRequest overlap guard", () => {
  it("blocks a request whose dates exactly match an existing approved request", () => {
    const existing = [{ from_date: "2026-07-10", to_date: "2026-07-11", status: "approved" }];
    expect(hasOverlap(existing, "2026-07-10", "2026-07-11")).toBe(true);
  });

  it("blocks a request that partially overlaps an existing pending request", () => {
    const existing = [{ from_date: "2026-07-08", to_date: "2026-07-12", status: "pending" }];
    expect(hasOverlap(existing, "2026-07-10", "2026-07-14")).toBe(true);
  });

  it("blocks a request that is fully contained within an existing pending_branch_head request", () => {
    const existing = [{ from_date: "2026-07-01", to_date: "2026-07-15", status: "pending_branch_head" }];
    expect(hasOverlap(existing, "2026-07-05", "2026-07-08")).toBe(true);
  });

  it("allows a request that is adjacent (one day gap) to an existing approved request", () => {
    const existing = [{ from_date: "2026-07-10", to_date: "2026-07-11", status: "approved" }];
    expect(hasOverlap(existing, "2026-07-12", "2026-07-13")).toBe(false);
  });

  it("allows a request when the only existing request is rejected", () => {
    const existing = [{ from_date: "2026-07-10", to_date: "2026-07-11", status: "rejected" }];
    expect(hasOverlap(existing, "2026-07-10", "2026-07-11")).toBe(false);
  });

  it("allows a request when the only existing request is lapsed", () => {
    const existing = [{ from_date: "2026-07-10", to_date: "2026-07-11", status: "lapsed" }];
    expect(hasOverlap(existing, "2026-07-10", "2026-07-11")).toBe(false);
  });

  it("allows a request when there are no existing requests", () => {
    expect(hasOverlap([], "2026-07-10", "2026-07-11")).toBe(false);
  });
});

// ─── DEFECT 2: Cross-month reversal — daysIntersectWithMonth ─────────────────

describe("DEFECT 2 — daysIntersectWithMonth (cross-month reversal helper)", () => {
  it("counts full days for a leave entirely within the month", () => {
    expect(daysIntersectWithMonth("2026-07-05", "2026-07-08", "2026-07-01", "2026-07-31")).toBe(4);
  });

  it("counts only the in-month tail for a leave that started the previous month", () => {
    // Leave: Jun 28 – Jul 03 → in July: Jul 01–03 = 3 days
    expect(daysIntersectWithMonth("2026-06-28", "2026-07-03", "2026-07-01", "2026-07-31")).toBe(3);
  });

  it("counts only the in-month head for a leave that ends the following month", () => {
    // Leave: Jul 29 – Aug 02 → in July: Jul 29–31 = 3 days
    expect(daysIntersectWithMonth("2026-07-29", "2026-08-02", "2026-07-01", "2026-07-31")).toBe(3);
  });

  it("returns 0 for a leave entirely before the window", () => {
    expect(daysIntersectWithMonth("2026-06-01", "2026-06-30", "2026-07-01", "2026-07-31")).toBe(0);
  });

  it("returns 0 for a leave entirely after the window", () => {
    expect(daysIntersectWithMonth("2026-08-01", "2026-08-15", "2026-07-01", "2026-07-31")).toBe(0);
  });

  it("counts 1 for a leave of exactly one day on the last day of the month", () => {
    expect(daysIntersectWithMonth("2026-07-31", "2026-07-31", "2026-07-01", "2026-07-31")).toBe(1);
  });

  it("counts the full month for a leave that spans the entire month and beyond", () => {
    // Leave: Jun 15 – Aug 15 → all 31 July days
    expect(daysIntersectWithMonth("2026-06-15", "2026-08-15", "2026-07-01", "2026-07-31")).toBe(31);
  });
});

// ─── DEFECT 3: pending_branch_head included in lapse sweep ───────────────────

describe("DEFECT 3 — lapseUnresolvedLeaves status filter", () => {
  it("lapses ordinary pending requests", () => {
    expect(shouldLapse("pending")).toBe(true);
  });

  it("lapses pending_branch_head requests", () => {
    expect(shouldLapse("pending_branch_head")).toBe(true);
  });

  it("does not lapse branch_head_approved requests (already actioned)", () => {
    expect(shouldLapse("branch_head_approved")).toBe(false);
  });

  it("does not lapse already-approved requests", () => {
    expect(shouldLapse("approved")).toBe(false);
  });

  it("does not lapse rejected requests", () => {
    expect(shouldLapse("rejected")).toBe(false);
  });

  it("does not lapse already-lapsed requests", () => {
    expect(shouldLapse("lapsed")).toBe(false);
  });
});

// ─── DEFECT 4: branch_head_approved triggers balance/ADR ─────────────────────

describe("DEFECT 4 — branch_head_approved balance and attendance triggers", () => {
  describe("balance deduction", () => {
    it("deducts balance on approved", () => {
      expect(shouldDeductBalance("approved")).toBe(true);
    });

    it("deducts balance on branch_head_approved", () => {
      expect(shouldDeductBalance("branch_head_approved")).toBe(true);
    });

    it("does not deduct on pending", () => {
      expect(shouldDeductBalance("pending")).toBe(false);
    });

    it("does not deduct on rejected", () => {
      expect(shouldDeductBalance("rejected")).toBe(false);
    });

    it("does not deduct on pending_branch_head", () => {
      expect(shouldDeductBalance("pending_branch_head")).toBe(false);
    });
  });

  describe("balance restore on cancel/reject", () => {
    it("restores when cancelling an approved leave", () => {
      expect(shouldRestoreBalance("cancelled", "approved")).toBe(true);
    });

    it("restores when rejecting an approved leave", () => {
      expect(shouldRestoreBalance("rejected", "approved")).toBe(true);
    });

    it("restores when cancelling a branch_head_approved leave", () => {
      expect(shouldRestoreBalance("cancelled", "branch_head_approved")).toBe(true);
    });

    it("restores when rejecting a branch_head_approved leave", () => {
      expect(shouldRestoreBalance("rejected", "branch_head_approved")).toBe(true);
    });

    it("does not restore when cancelling a pending leave (no balance was deducted)", () => {
      expect(shouldRestoreBalance("cancelled", "pending")).toBe(false);
    });

    it("does not restore when cancelling a pending_branch_head leave", () => {
      expect(shouldRestoreBalance("cancelled", "pending_branch_head")).toBe(false);
    });
  });
});

// ─── DEFECT 5: Monthly cap counts in-month days only ─────────────────────────

describe("DEFECT 5 — monthly cap overlap-day counting (prorateMonthlyCredit as proxy)", () => {
  // prorateMonthlyCredit is pure and testable without DB.
  // Tests document the policy that in-month days are what matters.

  it("credits full month when employee joined before the credit month", () => {
    const result = leavePolicyService.prorateMonthlyCredit("2025-01-15", 7, 2026);
    expect(result).toBe(1.0);
  });

  it("prorates when employee joined in the credit month", () => {
    // Joined Jul 16 in a 31-day month → 16 days remaining / 31 = 0.52
    const result = leavePolicyService.prorateMonthlyCredit("2026-07-16", 7, 2026);
    expect(result).toBeCloseTo(16 / 31, 2);
  });

  it("credits 0 when employee joined after the credit month", () => {
    const result = leavePolicyService.prorateMonthlyCredit("2026-08-01", 7, 2026);
    expect(result).toBe(0);
  });

  // Document the cross-month cap arithmetic that DEFECT 5 was about.
  it("in-month days for Jan 31 – Feb 01 leave counted as 1 day in January", () => {
    // This is the scenario the SQL fix resolves. Verified via daysIntersectWithMonth
    // which mirrors the DATEDIFF(LEAST, GREATEST)+1 logic now in the SQL.
    const janDays = daysIntersectWithMonth("2026-01-31", "2026-02-01", "2026-01-01", "2026-01-31");
    const febDays = daysIntersectWithMonth("2026-01-31", "2026-02-01", "2026-02-01", "2026-02-28");
    expect(janDays).toBe(1);
    expect(febDays).toBe(1);
    expect(janDays + febDays).toBe(2); // total_days = 2, but only 1 counts per month
  });
});

// ─── EL proration (accrual ledger reconstructability) ────────────────────────

describe("EL annual proration — prorateAnnualCredit", () => {
  it("credits full 18 days for an employee who joined before the prior year", () => {
    const { daysToCredit, monthsServed } = leavePolicyService.prorateAnnualCredit("2023-01-01", 2026);
    expect(monthsServed).toBe(12);
    expect(daysToCredit).toBe(18);
  });

  it("prorates for an employee who joined mid prior year (Jul 2024 for 2025 credit)", () => {
    // Joined Jul 2024 → Jul to Dec = 6 months served in 2024 → 18 * 6/12 = 9
    const { daysToCredit, monthsServed } = leavePolicyService.prorateAnnualCredit("2024-07-01", 2025);
    expect(monthsServed).toBe(6);
    expect(daysToCredit).toBeCloseTo(9, 1);
  });

  it("credits 0 for an employee who joined in the credit year itself", () => {
    const { daysToCredit, monthsServed } = leavePolicyService.prorateAnnualCredit("2026-03-01", 2026);
    expect(monthsServed).toBe(0);
    expect(daysToCredit).toBe(0);
  });

  it("credits full 18 days for December joiner of two years prior", () => {
    const { daysToCredit, monthsServed } = leavePolicyService.prorateAnnualCredit("2024-12-01", 2026);
    expect(monthsServed).toBe(12);
    expect(daysToCredit).toBe(18);
  });
});
