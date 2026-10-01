import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ getPopulation: vi.fn(), getModel: vi.fn(), execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: m.execute } }));
vi.mock("../../analytics/attrition-hub.service.js", () => ({
  getPopulation: m.getPopulation, getModel: m.getModel,
  probabilityFor: (model: { calibration: { tier: string; observedRatePct: number | null }[] }, tier: string) => { const r = model.calibration.find((c) => c.tier === tier)?.observedRatePct; return r == null ? null : r / 100; },
}));

import { fetchBranchAttrition } from "../branch-attrition.js";
import { attritionBody } from "../template.js";

const person = (id: string, branchId: string, tier: string, over: Record<string, unknown> = {}) => ({
  id, code: `MAS${id}`, name: `P ${id}`, process: "Sales", branchId, aonDays: 40, score: 60, tier, inNotice: false,
  features: { absentStreak: 0 }, reasons: [{ label: "Low attendance" }, { label: "First 30 days" }], ...over,
});
const model = { baseRatePct: 10, calibration: [{ tier: "CRITICAL", observedRatePct: 40 }, { tier: "HIGH", observedRatePct: 25 }, { tier: "MEDIUM", observedRatePct: 10 }, { tier: "LOW", observedRatePct: 5 }] };

beforeEach(() => {
  m.getPopulation.mockReset(); m.getModel.mockReset().mockResolvedValue(model); m.execute.mockReset();
  m.execute.mockResolvedValue([[{ m: "2026-09", n: 12, e30: 8, ep30: 4, e90: 12, early90: 9 }, { m: "2026-10", n: 3, e30: 3, ep30: 0, e90: 3, early90: 1 }], []]);
});

describe("fetchBranchAttrition", () => {
  it("counts only this branch, leaves people in notice out of risk, and totals exits from the database", async () => {
    m.getPopulation.mockResolvedValue({ people: [
      person("1", "b1", "CRITICAL", { features: { absentStreak: 4 } }), person("2", "b1", "HIGH"), person("3", "b1", "LOW"),
      person("4", "b1", "CRITICAL", { inNotice: true }), person("5", "other", "CRITICAL"),
    ] });
    const r = (await fetchBranchAttrition("b1", "2026-10-01"))!;
    expect(r.headcount).toBe(4);
    expect([r.critical, r.high, r.low]).toEqual([1, 1, 1]);
    expect(r.absentStreak).toBe(1);
    expect(r.newJoinerRisk).toBe(2);
    expect(r.expectedExits30).toBeCloseTo(0.4 + 0.25 + 0.05, 1);
    expect([r.exits30, r.exitsPrev30, r.exits90]).toEqual([11, 4, 15]);
    expect(r.earlyExitSharePct).toBe(66.7);
    expect(r.topRisk[0].code).toBe("MAS1");
    expect(r.calibrationNote).toMatch(/Critical 40%/);
  });
  it("returns null instead of throwing when the analytics source fails", async () => {
    m.getPopulation.mockRejectedValue(new Error("boom"));
    expect(await fetchBranchAttrition("b1", "2026-10-01")).toBeNull();
  });
});

describe("attritionBody (email section)", () => {
  const base = { headcount: 10, critical: 2, high: 3, medium: 3, low: 2, expectedExits30: 1.5, absentStreak: 4, newJoinerRisk: 2, exits30: 11, exitsPrev30: 4, exits90: 15, earlyExitSharePct: 66.7,
    monthlyExits: [{ month: "2026-09", exits: 12 }], byProcess: [{ process: "Sales", headcount: 10, highRisk: 5, absentStreak: 2 }],
    topRisk: [{ code: "M1", name: "A <script>x</script>", process: "Sales", aonDays: 12, score: 70, tier: "CRITICAL", reasons: ["First 30 days"], absentStreak: 3 }], calibrationNote: null };
  it("is empty when there is no data, and renders the key numbers when there is", () => {
    expect(attritionBody({ attrition: null })).toBe("");
    const html = attritionBody({ attrition: base });
    expect(html).toContain("Critical risk");
    expect(html).toContain("+175% vs previous 30");
    expect(html).toContain("HIGHEST RISK RIGHT NOW");
    expect(html).toContain("09/26");
  });
  it("escapes employee names", () => {
    const html = attritionBody({ attrition: base });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
