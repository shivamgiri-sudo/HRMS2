import { describe, expect, it } from "vitest";
import {
  mapLifecycle,
  requiredQuotedAmount,
  CONSUMED_GRN_STATUSES,
} from "../remediate-residual-grn-cost-allocation-2026-08.js";

/**
 * Group F (2026-08-22) — pure-logic pins for the residual GRN-to-budget-linkage remediation
 * script. This directory has no pre-existing test convention for either precedent script
 * (remediate-grn-budget-linkage-full-fy.ts, backfill-grn-cost-allocation-clean-match.ts have no
 * sibling test files); this file only pins the two pure functions this script's correctness
 * hinges on, per the task brief's "welcome but not required" guidance.
 */
describe("mapLifecycle", () => {
  it("maps every CONSUMED_GRN_STATUSES value to 'consumed'", () => {
    for (const status of CONSUMED_GRN_STATUSES) {
      expect(mapLifecycle(status)).toBe("consumed");
    }
  });

  it("maps branch_head_approved to 'reserved'", () => {
    expect(mapLifecycle("branch_head_approved")).toBe("reserved");
  });

  it("maps submitted to 'draft'", () => {
    expect(mapLifecycle("submitted")).toBe("draft");
  });

  it("refuses to guess on finance_head_approved — not in grn.service.ts's own CONSUMED_GRN_STATUSES", () => {
    expect(mapLifecycle("finance_head_approved")).toBeNull();
  });

  it("refuses to guess on consumption_reversed", () => {
    expect(mapLifecycle("consumption_reversed")).toBeNull();
  });

  it("refuses to guess on any unrecognised status", () => {
    expect(mapLifecycle("some_future_status")).toBeNull();
  });
});

describe("requiredQuotedAmount", () => {
  it("divides tax back out for exclusive treatment with a positive GST rate", () => {
    // 118 gross at 18% exclusive should require a quoted (pre-tax) amount of 100
    expect(requiredQuotedAmount(118, "exclusive", 18)).toBeCloseTo(100, 6);
  });

  it("divides tax back out for reverse_charge the same way as exclusive", () => {
    expect(requiredQuotedAmount(112, "reverse_charge", 12)).toBeCloseTo(100, 6);
  });

  it("returns the gross target unchanged for inclusive treatment", () => {
    expect(requiredQuotedAmount(118, "inclusive", 18)).toBe(118);
  });

  it("returns the gross target unchanged when gstRate is 0", () => {
    expect(requiredQuotedAmount(100, "exclusive", 0)).toBe(100);
  });

  it("returns the gross target unchanged for exempt/non_gst treatments", () => {
    expect(requiredQuotedAmount(100, "exempt", 0)).toBe(100);
    expect(requiredQuotedAmount(100, "non_gst", 0)).toBe(100);
  });
});
