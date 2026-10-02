import { describe, expect, it } from "vitest";
import { canSeeFinanceFigures } from "../helpers.js";

describe("canSeeFinanceFigures", () => {
  it("allows finance, executive and operations-head roles", () => {
    for (const r of ["super_admin", "ceo", "finance_head", "operations_head", "ho_operations"]) {
      expect(canSeeFinanceFigures([r])).toBe(true);
    }
  });
  it("denies branch heads, process managers, QA and plain managers", () => {
    for (const r of ["branch_head", "process_manager", "qa", "tq_head", "manager", "operations_manager"]) {
      expect(canSeeFinanceFigures([r])).toBe(false);
    }
  });
  it("is true when any one role qualifies", () => {
    expect(canSeeFinanceFigures(["manager", "ceo"])).toBe(true);
  });
});
