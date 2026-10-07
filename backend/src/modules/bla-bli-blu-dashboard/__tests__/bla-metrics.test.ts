import { describe, it, expect } from "vitest";
import {
  buildDashboard,
  weekLabel,
  type ReceivedAgg,
  type SalesAgg,
  type TargetCfg,
} from "../bla-metrics.js";

const t: TargetCfg = {
  lob: "Cart ABC",
  requiredPerDay: 100,
  capPct: 1.1,
  conversionTarget: 0.1,
  prepaidTarget: 0.85,
  rtoTarget: 0.05,
  targetAov: 600,
};
const recv = (date: string, fw: number): ReceivedAgg => ({
  date,
  lob: "Cart ABC",
  freshBase: fw,
  freshWorkable: fw,
  totalWorkable: fw,
  dnd: 0,
  uniqueAttempt: fw,
  connected: 0,
  le30: 0,
  lt1m: 0,
  ge1m: 0,
});
const sale = (
  date: string,
  rts: number,
  prepaid: number,
  rto: number,
  revenue: number,
): SalesAgg => ({
  date,
  campaign: "cart abc",
  realTimeSale: rts,
  prepaid,
  rto,
  revenue,
  ptp: 0,
  h24: 0,
});

describe("bla-metrics", () => {
  it("labels weeks in 7-day blocks", () => {
    expect(weekLabel("2026-09-01")).toBe("Week 1");
    expect(weekLabel("2026-09-08")).toBe("Week 2");
    expect(weekLabel("2026-09-29")).toBe("Week 5");
  });

  it("caps data per day and derives target/achievement", () => {
    const d = buildDashboard(
      [recv("2026-09-01", 200), recv("2026-09-02", 50)],
      [sale("2026-09-01", 10, 8, 1, 6000)],
      [t],
    );
    const b = d.blocks[0];
    expect(b.daily[0].cappedData).toBeCloseTo(110); // min(200, 100*1.1)
    expect(b.daily[1].cappedData).toBe(50); // min(50, 110)
    expect(b.mtd.targetSale).toBeCloseTo(16); // (110+50)*0.1
    expect(b.mtd.targetRevenue).toBeCloseTo(9600);
    expect(b.mtd.saleAchievement).toBeCloseTo(10 / 16);
    expect(b.mtd.deliveryPrepaid).toBeCloseTo(0.8);
    expect(b.mtd.aov).toBe(600);
    expect(b.mtd.revenueAchievement).toBeCloseTo(6000 / 9600);
  });

  it("matches LOB and campaign case-insensitively and never divides by zero", () => {
    const d = buildDashboard([], [sale("2026-09-01", 0, 0, 0, 0)], []);
    expect(d.blocks).toHaveLength(1);
    expect(d.blocks[0].mtd.aov).toBe(0);
    expect(d.blocks[0].hasTarget).toBe(false);
  });

  it("sums LOBs for the combined view", () => {
    const up: TargetCfg = {
      ...t,
      lob: "Upgrade",
      requiredPerDay: 10,
      conversionTarget: 0.2,
    };
    const r2: ReceivedAgg = { ...recv("2026-09-01", 30), lob: "Upgrade" };
    const d = buildDashboard([recv("2026-09-01", 200), r2], [], [t, up]);
    expect(d.all.mtd.targetSale).toBeCloseTo(110 * 0.1 + 11 * 0.2);
    expect(d.all.mtd.freshWorkable).toBe(230);
  });
});

describe("blended targets across LOBs", () => {
  it("does not dilute prepaid / RTO targets with LOBs that have no target", () => {
    const cfg = { lob: "Cart ABC", requiredPerDay: 100, capPct: 1.1, conversionTarget: 0.135, prepaidTarget: 0.85, rtoTarget: 0.05, targetAov: 600 };
    const sales = [
      { date: "2026-08-01", campaign: "Cart ABC", realTimeSale: 80, prepaid: 60, rto: 4, revenue: 48000, ptp: 0, h24: 0 },
      { date: "2026-08-01", campaign: "Inbound", realTimeSale: 20, prepaid: 10, rto: 1, revenue: 12000, ptp: 0, h24: 0 },
    ];
    const r = buildDashboard([], sales, [cfg]);
    expect(r.all.mtd.prepaidTarget).toBeCloseTo(0.85, 6);
    expect(r.all.mtd.rtoTarget).toBeCloseTo(0.05, 6);
  });
});
