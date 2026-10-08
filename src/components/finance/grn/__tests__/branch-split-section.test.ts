import { describe, expect, it } from "vitest";
import { branchCheck, branchSharesError, branchSharesPayload, splitAmountIntoShares, type BranchShareDraft } from "../BranchSplitSection";
import type { BranchSplitBranch, BranchSplitOptions } from "@/hooks/useBranchSplitOptions";

const cov = (available: number, over: Partial<NonNullable<BranchSplitBranch["coverage"]>> = {}) =>
  ({ headerActive: true, hasAnyLine: true, aggregateAvailable: available, ...over });
const opt = (id: string, status: "ok" | "none" | "ambiguous", coverage: BranchSplitBranch["coverage"] = cov(100000)): BranchSplitBranch => ({
  branchId: id, branchName: id, isHeadOffice: false, status,
  resolved: status === "ok" ? { id: `cc-${id}`, code: `BO-${id}`, name: null } : null,
  candidates: status === "ambiguous" ? [{ id: "c1", code: "A", name: null }] : [],
  coverage,
});
const options: BranchSplitOptions = { enabled: true, branches: [opt("A", "ok"), opt("B", "none"), opt("C", "ambiguous"), opt("D", "ok", cov(100)), opt("E", "ok", cov(0, { hasAnyLine: false }))] };
const row = (branchId: string, percentage: number, included = true, costCentreId = ""): BranchShareDraft => ({ key: branchId, branchId, costCentreId, percentage, included });

describe("branch split shares", () => {
  it("splits to the paisa", () => {
    expect(splitAmountIntoShares(100, [33.33, 33.33, 33.34]).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 2);
  });
  it("accepts valid shares and ignores unticked rows", () => {
    expect(branchSharesError([row("A", 60), row("C", 40, true, "c1"), row("D", 0, false)], options, 1000)).toBeNull();
  });
  it("rejects bad shares", () => {
    expect(branchSharesError([row("A", 0, false)], options, 1000)).toMatch(/at least one/);
    expect(branchSharesError([row("B", 100)], options, 1000)).toMatch(/no active Back Office/);
    expect(branchSharesError([row("C", 100)], options, 1000)).toMatch(/pick which/);
    expect(branchSharesError([row("A", 50)], options, 1000)).toMatch(/total 100/);
  });
  it("checks each branch's own budget", () => {
    expect(branchCheck(options.branches[0], 50, 1000).ok).toBe(true);
    expect(branchCheck(options.branches[3], 50, 1000)).toMatchObject({ ok: false });
    expect(branchSharesError([row("A", 50), row("D", 50)], options, 1000)).toMatch(/D: Short by/);
    expect(branchSharesError([row("E", 100)], options, 1000)).toMatch(/No budget line/);
    expect(branchCheck({ ...options.branches[0], coverage: undefined }, 50, 1000).waiting).toBe(true);
  });
  it("sends only ticked rows with a share", () => {
    expect(branchSharesPayload([row("A", 60), row("D", 40), row("E", 0, false)]))
      .toEqual([{ branchId: "A", costCentreId: undefined, percentage: 60 }, { branchId: "D", costCentreId: undefined, percentage: 40 }]);
  });
});
