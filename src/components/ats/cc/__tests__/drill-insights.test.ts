import { describe, expect, it } from "vitest";
import type { DrillData } from "@/hooks/useAtsDashboards";
import { buildDrillFindings } from "../drill-insights";

const kpis = (total: number, selected: number, noShow = 0) => ({
  total, selected, rejected: 0, noShow, hold: 0, waiting: 0, joined: 0,
  selRate: total ? Math.round((selected / total) * 1000) / 10 : 0, rejRate: 0, noShowRate: total ? Math.round((noShow / total) * 1000) / 10 : 0, joinRate: 0,
});
const split = (name: string, total: number, selected: number) => ({ name, total, selected, rejected: 0, selRate: Math.round((selected / total) * 1000) / 10 });
const drill = (over: Partial<DrillData> & { k: ReturnType<typeof kpis> }): DrillData => ({
  total: over.k.total, kpis: over.k, trend: [], weekly: false, weekday: [], splits: { branch: [], process: [], source: [], recruiter: [], stage: [], status: [] }, ...over,
});

describe("buildDrillFindings", () => {
  it("returns nothing for an empty slice", () => {
    expect(buildDrillFindings(drill({ k: kpis(0, 0) }), null, undefined)).toEqual([]);
  });

  it("compares to the level above and flags a selection-rate gap of 3+ points", () => {
    const parent = drill({ k: kpis(1000, 200) });
    const child = drill({ k: kpis(100, 10) });
    const f = buildDrillFindings(child, parent, undefined);
    expect(f.find((x) => x.title.includes("10% of the level above"))).toBeTruthy();
    const gap = f.find((x) => x.title.startsWith("Selection rate"));
    expect(gap?.tone).toBe("bad");
    expect(gap?.title).toContain("-10 pts");
  });

  it("does not flag a gap smaller than 3 points", () => {
    const f = buildDrillFindings(drill({ k: kpis(100, 21) }), drill({ k: kpis(1000, 200) }), undefined);
    expect(f.some((x) => x.title.startsWith("Selection rate"))).toBe(false);
  });

  it("names best and weakest splits and ignores slices too small to rank", () => {
    const d = drill({
      k: kpis(200, 40),
      splits: { branch: [split("Noida", 100, 40), split("Pune", 90, 5), split("Tiny", 3, 3)], process: [], source: [], recruiter: [], stage: [], status: [] },
    });
    const f = buildDrillFindings(d, null, "branch");
    expect(f.find((x) => x.title.startsWith("Best branch"))?.title).toContain("Noida");
    expect(f.find((x) => x.title.startsWith("Weakest branch"))?.title).toContain("Pune");
    expect(f.some((x) => x.title.includes("Tiny"))).toBe(false);
    expect(f.find((x) => x.title.startsWith("Best branch"))?.drill?.extra).toEqual({ branch: "Noida" });
  });

  it("warns when a large slice has no selections", () => {
    expect(buildDrillFindings(drill({ k: kpis(40, 0) }), null, undefined)[0]?.tone).toBe("bad");
  });

  it("reports 7-day momentum only on a daily trend with enough volume", () => {
    const days = Array.from({ length: 14 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, "0")}`, total: i < 7 ? 10 : 20, selected: 0, rejected: 0 }));
    const up = buildDrillFindings(drill({ k: kpis(210, 10), trend: days }), null, undefined);
    expect(up.find((x) => x.title.startsWith("Volume"))?.title).toContain("+100%");
    const weekly = buildDrillFindings(drill({ k: kpis(210, 10), trend: days, weekly: true }), null, undefined);
    expect(weekly.some((x) => x.title.startsWith("Volume"))).toBe(false);
  });
});
