import { describe, expect, it } from "vitest";
import { budgetLineKey } from "../BranchBudgetPlannerGrid";

/**
 * The Prev/Variance lookup key.
 *
 * This key was hand-built as a template literal in four places and the four drifted: the map was
 * written with a lower-cased sub-head while the grid read it back with the original case. Since
 * every real sub-head is capitalised — "Office Rent", "Electricity Govt." — the lookup missed on
 * every row, and the Prev and Var columns rendered "—" as though last month had no budget at all.
 *
 * Nothing threw. Empty columns are indistinguishable from "no prior data", which is why it
 * survived: the screen looked correct while silently hiding the whole comparison.
 *
 * These tests exist so the two sides can never disagree again.
 */

describe("budgetLineKey", () => {
  it("matches regardless of the case either side was written in", () => {
    // The exact failure: map written lower-cased, grid reading the original case.
    expect(budgetLineKey("Office Rent", "Office Rent"))
      .toBe(budgetLineKey("office rent", "office rent"));
    expect(budgetLineKey("Repairs & Maintenance", "Electricity Govt."))
      .toBe(budgetLineKey("REPAIRS & MAINTENANCE", "ELECTRICITY GOVT."));
  });

  it("case-folds the head too, not just the sub-head", () => {
    // The old key lower-cased only the sub-head, so a head differing in case still missed.
    expect(budgetLineKey("Office Rent", "x")).toBe(budgetLineKey("OFFICE RENT", "x"));
  });

  it("treats a missing sub-head and an empty one as the same row", () => {
    // The mirror returns "" for a line with no sub-head; workspace lines carry null or undefined.
    expect(budgetLineKey("Staff Welfare", null)).toBe(budgetLineKey("Staff Welfare", ""));
    expect(budgetLineKey("Staff Welfare", undefined)).toBe(budgetLineKey("Staff Welfare", ""));
  });

  it("ignores surrounding whitespace from either source", () => {
    // db_bill values are user-entered and carry stray spaces; mas_hrms masters do not.
    expect(budgetLineKey(" Office Rent ", " Office Rent "))
      .toBe(budgetLineKey("Office Rent", "Office Rent"));
  });

  it("still separates two genuinely different sub-heads under one head", () => {
    // Case-folding must not collapse distinct rows into one and silently sum them.
    expect(budgetLineKey("Communication & Connectivity", "Company Owned Data"))
      .not.toBe(budgetLineKey("Communication & Connectivity", "Company Owned Voice"));
  });

  it("keeps the head and sub-head halves from bleeding into each other", () => {
    // A naive join would make ("a|b", "") collide with ("a", "b").
    expect(budgetLineKey("a|b", "")).not.toBe(budgetLineKey("a", "b"));
  });
});
