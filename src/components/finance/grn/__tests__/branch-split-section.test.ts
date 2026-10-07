import { describe, expect, it } from "vitest";
import { branchSharesError, splitAmountIntoShares, type BranchShareDraft } from "../BranchSplitSection";
import type { BranchSplitOptions } from "@/hooks/useBranchSplitOptions";

const opt = (id: string, status: "ok" | "none" | "ambiguous") => ({
  branchId: id, branchName: id, isHeadOffice: false, status,
  resolved: status === "ok" ? { id: `cc-${id}`, code: `BO-${id}`, name: null } : null,
  candidates: status === "ambiguous" ? [{ id: "c1", code: "A", name: null }] : [],
});
const options: BranchSplitOptions = { enabled: true, branches: [opt("A", "ok"), opt("B", "none"), opt("C", "ambiguous")] };
const row = (branchId: string, percentage: number, costCentreId = ""): BranchShareDraft => ({ key: branchId, branchId, costCentreId, percentage });

describe("branch split shares", () => {
  it("splits to the paisa", () => {
    const s = splitAmountIntoShares(100, [33.33, 33.33, 33.34]);
    expect(s.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 2);
  });
  it("accepts valid shares", () => {
    expect(branchSharesError([row("A", 60), row("C", 40, "c1")], options)).toBeNull();
  });
  it("rejects bad shares", () => {
    expect(branchSharesError([], options)).toMatch(/at least one/);
    expect(branchSharesError([row("B", 100)], options)).toMatch(/no active Back Office/);
    expect(branchSharesError([row("C", 100)], options)).toMatch(/pick which/);
    expect(branchSharesError([row("A", 50), row("A", 50)], options)).toMatch(/twice/);
    expect(branchSharesError([row("A", 50)], options)).toMatch(/total 100/);
  });
});
