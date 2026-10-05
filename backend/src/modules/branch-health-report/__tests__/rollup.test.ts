import { describe, expect, it } from "vitest";
import { summarisePeers } from "../rollup.js";

const rep = (branch: string, keys: string[], branchId: string | null = "x"): any => ({
  branch,
  raw: { branchId },
  escalations: keys.map((key) => ({ key, days: 1 })),
});

describe("summarisePeers", () => {
  const all = [rep("A", ["k1", "k2", "k3"]), rep("B", ["k1"]), rep("C", []), rep("D", ["k1", "k2"])];
  const p = summarisePeers(all);
  it("ranks worst first and never ranks a branch with no data", () => {
    expect(p.get("A")!.rank).toBe(1);
    expect(p.get("D")!.rank).toBe(2);
    expect(p.get("C")!.rank).toBe(4);
    expect(summarisePeers([...all, rep("Z", [], null)]).has("Z")).toBe(false);
  });
  it("counts only OTHER branches for the same problem", () => {
    expect(p.get("A")!.sameKeyElsewhere).toEqual({ k1: 2, k2: 1, k3: 0 });
  });
  it("reports median and spotless branches", () => {
    expect(p.get("A")!.median).toBe(1.5);
    expect(p.get("A")!.branchesWithNone).toBe(1);
    expect(p.get("A")!.total).toBe(4);
  });
  it("exposes no other branch's name", () => {
    expect(JSON.stringify(p.get("B"))).not.toMatch(/"(A|C|D)"/);
  });
});
