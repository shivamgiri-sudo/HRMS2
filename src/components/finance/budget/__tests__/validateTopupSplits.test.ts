import { describe, expect, it } from "vitest";
import { validateTopupSplits, SPLIT_AMOUNT_TOLERANCE, type TopupSplitRow } from "../BudgetTopupPanel";

/**
 * Group D: client-side fast-feedback validation for a top-up's cost-centre split, mirroring (not
 * replacing) budget-topup.service.ts's own validateCostCentreSplits(). The server remains
 * authoritative; these are the same three failure modes the brief calls out explicitly — missing
 * cost centre, duplicate cost centre (mirrors the DB's UNIQUE(topup_request_id, cost_centre_id)),
 * non-positive amount — plus the aggregate reconciliation against the request's own top-level
 * amount.
 */

const row = (costCentreId: string, amount: string): TopupSplitRow => ({
  key: costCentreId || Math.random().toString(36),
  costCentreId,
  amount,
});

describe("validateTopupSplits", () => {
  it("refuses an empty split", () => {
    const result = validateTopupSplits([], 1000);
    expect(result.ok).toBe(false);
  });

  it("refuses a row with no cost centre selected", () => {
    const result = validateTopupSplits([row("", "1000")], 1000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/cost centre/i);
  });

  it("refuses a duplicate cost centre across rows — mirrors the DB's UNIQUE constraint", () => {
    const result = validateTopupSplits([row("cc-1", "500"), row("cc-1", "500")], 1000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe("This cost centre is already in the split");
  });

  it("refuses a zero or negative amount", () => {
    expect(validateTopupSplits([row("cc-1", "0")], 1000).ok).toBe(false);
    expect(validateTopupSplits([row("cc-1", "-50")], 1000).ok).toBe(false);
    expect(validateTopupSplits([row("cc-1", "abc")], 1000).ok).toBe(false);
  });

  it("refuses when the split total does not match the requested amount", () => {
    const result = validateTopupSplits([row("cc-1", "400"), row("cc-2", "400")], 1000);
    expect(result.ok).toBe(false);
    expect(result.sum).toBe(800);
  });

  it("accepts an exact match", () => {
    const result = validateTopupSplits([row("cc-1", "600"), row("cc-2", "400")], 1000);
    expect(result.ok).toBe(true);
    expect(result.sum).toBe(1000);
  });

  it("accepts within the documented rupee-or-two tolerance", () => {
    const result = validateTopupSplits([row("cc-1", "999.5")], 1000);
    expect(result.ok).toBe(true);
    expect(SPLIT_AMOUNT_TOLERANCE).toBe(1);
  });

  it("refuses just outside the tolerance", () => {
    const result = validateTopupSplits([row("cc-1", "998")], 1000);
    expect(result.ok).toBe(false);
  });

  it("refuses when the requested amount itself is not a positive number yet", () => {
    const result = validateTopupSplits([row("cc-1", "500")], 0);
    expect(result.ok).toBe(false);
  });
});
