import { describe, expect, it } from "vitest";
import { blendedCostPerHire, channelCosts, demandFindings, demandSupply, hasDemand, hasSpend, type Bmi, type BmiRow } from "../bmi-helpers";

const row = (key: string, vals: (number | null)[], months: string[]): BmiRow => ({ key, label: key, total: null, cells: Object.fromEntries(months.map((m, i) => [m, { value: vals[i] ?? null }])) });
const M = ["2026-07", "2026-08", "2026-09"];
const board = (over: Partial<Record<string, (number | null)[]>> = {}): Bmi => ({
  months: M,
  funnel: [row("demand_raised", over.demand ?? [100, 100, 100], M), row("ops_selected", [60, 70, 80], M), row("offers_accepted", over.acc ?? [50, 60, 90], M),
    row("sourced_portal", [200, 200, 200], M), row("sourced_agency", [50, 50, 50], M), row("sourced_referral", [20, 20, 20], M), row("sourced_walk_in", [300, 300, 300], M)],
  costs: [row("portal_cost", over.portal ?? [30000, 30000, 30000], M), row("consultant_cost", over.consult ?? [10000, null, 10000], M), row("referral_bonus", [2000, 2000, 2000], M)],
  quality: [], speed: [],
});

describe("demandSupply", () => {
  it("computes fill rate and the shortfall per month", () => {
    const r = demandSupply(board());
    expect(r[0]).toMatchObject({ demand: 100, accepted: 50, fillRate: 50, gap: 50 });
    expect(r[2]).toMatchObject({ fillRate: 90, gap: 10 });
    expect(r[0].label).toBe("Jul 26");
  });
  it("leaves fill rate empty when demand was not recorded, never dividing by zero", () => {
    const r = demandSupply(board({ demand: [0, null, 100] }));
    expect(r[0].fillRate).toBeNull();
    expect(r[1].fillRate).toBeNull();
    expect(hasDemand(demandSupply(board({ demand: [0, null, null] })))).toBe(false);
  });
  it("is empty without data", () => { expect(demandSupply(null)).toEqual([]); });
});

describe("channelCosts", () => {
  it("divides each channel's spend by the candidates it sourced", () => {
    const c = channelCosts(board());
    const portal = c.find((x) => x.key === "portal")!;
    expect(portal).toMatchObject({ spend: 90000, sourced: 600, costPerSourced: 150 });
    expect(c.find((x) => x.key === "agency")).toMatchObject({ spend: 20000, sourced: 150, costPerSourced: 133 });
  });
  it("shows walk-ins as sourced with no direct spend", () => {
    expect(channelCosts(board()).find((x) => x.key === "walk_in")).toMatchObject({ spend: 0, sourced: 900, costPerSourced: 0 });
  });
  it("reports unknown spend as null, not zero", () => {
    const c = channelCosts(board({ portal: [null, null, null] }));
    expect(c.find((x) => x.key === "portal")!.spend).toBeNull();
    expect(hasSpend(c)).toBe(true);
    expect(hasSpend(channelCosts(board({ portal: [null, null, null], consult: [null, null, null] })).filter((x) => x.key !== "referral" && x.key !== "walk_in"))).toBe(false);
  });
});

describe("blendedCostPerHire", () => {
  it("divides direct spend by accepted offers", () => {
    const b = blendedCostPerHire(board());
    expect(b[0]).toMatchObject({ spend: 42000, accepted: 50, costPerHire: 840 });
    expect(b[1].spend).toBe(32000);
  });
  it("gives no cost per hire when nobody accepted", () => {
    expect(blendedCostPerHire(board({ acc: [0, null, 10] }))[0].costPerHire).toBeNull();
  });
});

describe("demandFindings", () => {
  it("summarises the fill rate and flags a short latest month", () => {
    const f = demandFindings(demandSupply(board({ acc: [50, 60, 70] })));
    expect(f[0].title).toBe("60% of requested hires were filled");
    expect(f.some((x) => x.title.includes("Sep 26 fell 30 short"))).toBe(true);
  });
  it("is quiet with no recorded demand", () => { expect(demandFindings(demandSupply(board({ demand: [null, null, null] })))).toEqual([]); });
});
