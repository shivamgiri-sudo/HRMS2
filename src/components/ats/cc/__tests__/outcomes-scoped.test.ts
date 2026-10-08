import { describe, expect, it } from "vitest";
import type { DrillData, DrillSplit } from "@/hooks/useAtsDashboards";
import type { Leakage } from "@/hooks/useAtsCommandCenter";
import { bestWorst, bgvSurvival, biggestLoss, buildScopedFindings, noShowHotspot, offersApproved, outcomeRows, rankStageRejections } from "../outcomes-scoped-helpers";

const sp = (name: string, total: number, selected: number, rejected = 0, extra: Partial<DrillSplit> = {}): DrillSplit => ({ name, total, selected, rejected, selRate: Math.round((selected / total) * 1000) / 10, ...extra });
const leak: Leakage = { generatedAt: "", stages: [{ key: "registered", label: "Registered", n: 500 }, { key: "selected", label: "Selected", n: 100 }, { key: "offer_approved", label: "Offer approved", n: 80 }, { key: "bgv_clear", label: "BGV clear", n: 60 }, { key: "joined", label: "Joined", n: 50 }], losses: [] };
const drill = (splits: Partial<DrillData["splits"]>, kpis: Partial<DrillData["kpis"]> = {}): DrillData => ({
  total: 200, kpis: { total: 200, selected: 40, rejected: 100, noShow: 10, hold: 0, waiting: 0, joined: 20, selRate: 20, rejRate: 50, noShowRate: 5, joinRate: 50, ...kpis },
  trend: [], weekly: false, weekday: [], splits: { branch: [], process: [], source: [], recruiter: [], stage: [], status: [], ...splits },
});

describe("bestWorst", () => {
  it("ignores rows under the minimum sample", () => {
    const rows = outcomeRows([sp("A", 50, 25), sp("B", 40, 4), sp("Tiny", 3, 3)]);
    const r = bestWorst(rows)!;
    expect(r.best.name).toBe("A"); expect(r.worst.name).toBe("B"); expect(r.gap).toBe(40);
  });
  it("returns null with fewer than two qualifying rows", () => {
    expect(bestWorst(outcomeRows([sp("A", 50, 25), sp("T", 2, 1)]))).toBeNull();
  });
});

describe("outcomeRows", () => {
  it("fills missing rates and drops empty rows", () => {
    const r = outcomeRows([sp("A", 20, 5, 10, { noShow: 2, joined: 1 }), sp("Z", 0, 0)]);
    expect(r).toHaveLength(1); expect(r[0]).toMatchObject({ rejRate: 50, noShowRate: 10, joinRate: 5 });
  });
});

describe("noShowHotspot", () => {
  it("needs a clear margin over the overall rate and a min sample", () => {
    const rows = outcomeRows([sp("A", 30, 5, 0, { noShow: 9 }), sp("B", 30, 5, 0, { noShow: 2 }), sp("C", 4, 0, 0, { noShow: 4 })]);
    expect(noShowHotspot(rows, 10)?.name).toBe("A");
    expect(noShowHotspot(rows, 28)).toBeNull();
  });
});

describe("rankStageRejections", () => {
  it("ranks by rejected count with share", () => {
    const r = rankStageRejections([sp("HR", 100, 10, 60), sp("Ops", 40, 10, 20), sp("Final", 10, 5, 0)]);
    expect(r.map((x) => x.name)).toEqual(["HR", "Ops"]); expect(r[0]).toMatchObject({ share: 75, rate: 60 });
  });
});

describe("leakage", () => {
  it("computes step survival and biggest loss from selected onwards", () => {
    expect(offersApproved(leak)?.pct).toBe(80);
    expect(bgvSurvival(leak)?.pct).toBe(75);
    const l = biggestLoss(leak)!; expect(l.from.key).toBe("selected"); expect(l.lost).toBe(20);
  });
  it("is null when the step is absent", () => { expect(bgvSurvival({ ...leak, stages: leak.stages.slice(0, 3) })).toBeNull(); });
});

describe("buildScopedFindings", () => {
  it("builds best/weakest, no-show hotspot, stage and leakage findings", () => {
    const d = drill({
      process: [sp("P1", 80, 40), sp("P2", 80, 8)],
      recruiter: [sp("R1", 50, 10, 0, { noShow: 15 }), sp("R2", 50, 10, 0, { noShow: 1 })],
      stage: [sp("HR screening", 100, 10, 70), sp("Ops", 40, 10, 10)],
    });
    const titles = buildScopedFindings({ drill: d, leakage: leak }).map((f) => f.title).join("|");
    expect(titles).toContain("Best process: P1"); expect(titles).toContain("Weakest process: P2");
    expect(titles).toContain("No-show hotspot: R1"); expect(titles).toContain("87.5% of rejections happen at HR screening");
    expect(titles).toContain("Biggest offer-to-join loss");
  });
  it("is empty without data", () => { expect(buildScopedFindings({})).toEqual([]); });
});
