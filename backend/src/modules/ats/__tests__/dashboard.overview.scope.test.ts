import { describe, expect, it } from "vitest";
import { limitOverviewToBranches } from "../dashboard.overview.service.js";
import { branchInScope, type AtsBranchScope } from "../ats-branch-scope.js";

const ov = () => ({
  kpis: { registered: 645 },
  branches: [{ name: "NOIDA-2", total: 645 }, { name: "NOIDA", total: 356 }, { name: "AHMEDABAD-JALDARSHAN", total: 146 }],
  movers: {
    up: [{ name: "AHMEDABAD-JALDARSHAN", volumeDelta: 111 }, { name: "NOIDA-2", volumeDelta: 20 }],
    down: [{ name: "NOIDA", volumeDelta: -5 }],
    all: [{ name: "NOIDA-2", volumeDelta: 20 }, { name: "NOIDA", volumeDelta: -5 }, { name: "AHMEDABAD-JALDARSHAN", volumeDelta: 111 }],
  },
});
const scope: AtsBranchScope = { orgWide: false, branchIds: ["b1"], branchSpellings: ["b1", "NOIDA-2", "noida 2"], branchNames: ["NOIDA-2"], processNames: [] };

describe("limitOverviewToBranches", () => {
  it("keeps only the caller's branch in the breakdown and every mover list", () => {
    const out = limitOverviewToBranches(ov(), (n) => branchInScope(scope, n));
    expect(out.branches.map((b) => b.name)).toEqual(["NOIDA-2"]);
    expect(out.movers.up.map((m) => m.name)).toEqual(["NOIDA-2"]);
    expect(out.movers.down).toEqual([]);
    expect(out.movers.all.map((m) => m.name)).toEqual(["NOIDA-2"]);
  });

  it("does not mutate the shared cached object", () => {
    const original = ov();
    limitOverviewToBranches(original, () => false);
    expect(original.branches).toHaveLength(3);
    expect(original.movers.all).toHaveLength(3);
  });

  it("leaves every other field alone", () => {
    expect(limitOverviewToBranches(ov(), () => true).kpis).toEqual({ registered: 645 });
  });

  it("returns nothing for a caller with no matching branch", () => {
    const out = limitOverviewToBranches(ov(), (n) => branchInScope({ ...scope, branchSpellings: [] }, n));
    expect(out.branches).toEqual([]);
  });
});
