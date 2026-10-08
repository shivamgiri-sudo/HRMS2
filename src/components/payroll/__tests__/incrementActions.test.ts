import { describe, it, expect } from "vitest";
import { INCREMENT_ACTIONS_FOR_STATUS as A } from "../incrementActions";

const actions = (s: string) => (A[s] ?? []).map((b) => b.action);

describe("increment request buttons", () => {
  it("never offers a Finance step", () => {
    for (const s of Object.keys(A)) {
      expect(actions(s)).not.toContain("finance_validate");
      expect((A[s] ?? []).map((b) => b.label).join(" ")).not.toMatch(/finance/i);
    }
  });
  it("a new request can be HR-validated or go straight to the Payroll Head's Approve & Apply", () => {
    expect(actions("submitted")).toEqual(["hr_validate", "approve", "reject", "cancel"]);
    expect(A.submitted!.find((b) => b.action === "approve")!.label).toBe("Approve & Apply");
  });
  it("an HR-validated request goes to Approve & Apply", () => {
    expect(actions("hr_validated")).toEqual(["approve", "reject", "cancel"]);
  });
  it("an old Finance Validated request can still be approved or rejected", () => {
    expect(actions("finance_validated")).toEqual(["approve", "reject"]);
  });
  it("an approved request that did not apply offers Apply; finished requests offer nothing", () => {
    expect(actions("approved")).toEqual(["implement"]);
    for (const s of ["implemented", "rejected", "cancelled", "withdrawn"]) expect(actions(s)).toEqual([]);
  });
});
