import { describe, it, expect } from "vitest";
import {
  SOURCE_TYPES, STAGES, zeroStages, stageCountsByType, conversions, dailySeries, timingGrids, scatterPoints, waterfall,
  type StageCounts,
} from "../he-drive-analytics.js";
import type { DriveAggRow } from "../he-drive-trend.service.js";
import type { SourceRow } from "../he-requisition-sources.service.js";

const src = (o: Partial<SourceRow>): SourceRow => ({
  sourceType: "he", originId: "o", originLabel: "o", streamId: null, streamStatus: null,
  leads: 0, qualified: 0, emailed: 0, whatsapped: 0, replied: 0, confirmed: 0, called: 0, arrived: 0, selected: 0, joined: 0,
  shareOfLeads: 0, shareOfJoined: 0, leadToJoinRate: 0, ...o,
});
const agg = (o: Partial<DriveAggRow>): DriveAggRow => ({
  driveId: "d1", date: "2026-10-10", status: "open", wanted: 0, streamId: null, streamType: null,
  lined: 0, invited: 0, confirmed: 0, arrived: 0, noShow: 0, declined: 0, ...o,
});
const clean = (v: unknown): void => { const j = JSON.stringify(v); expect(j).not.toContain("NaN"); expect(j).not.toContain("Infinity"); };

describe("stageCountsByType", () => {
  const sources = [src({ sourceType: "meta_live", leads: 60, qualified: 20, selected: 1, joined: 0 }), src({ sourceType: "he", leads: 10, qualified: 0 })];
  const rows = [
    agg({ streamType: "meta_live", invited: 15, confirmed: 8, arrived: 4 }),
    agg({ driveId: "d2", streamType: null, invited: 6, confirmed: 3, arrived: 2, noShow: 1 }),
  ];
  const out = stageCountsByType(sources, rows, [{ sourceType: "meta_live", selected: 2, joined: 1 }]);
  it("attributes per type with max(outcome, sources) for selected/joined", () => {
    expect(out.meta_live).toEqual({ leads: 60, qualified: 20, invited: 15, confirmed: 8, arrived: 4, selected: 2, joined: 1, noShow: 0, declined: 0 });
    expect(out.he).toMatchObject({ leads: 10, invited: 6, confirmed: 3, arrived: 2, noShow: 1 });
    expect(out.meta_old).toEqual({ ...zeroStages(), noShow: 0, declined: 0 });
    clean(out);
  });
  it("keeps the larger source value when it exceeds the outcome", () => {
    const o = stageCountsByType([src({ sourceType: "he", selected: 5, joined: 3 })], [], [{ sourceType: "he", selected: 2, joined: 1 }]);
    expect(o.he.selected).toBe(5); expect(o.he.joined).toBe(3);
  });
  it("empty input gives three zeroed types", () => {
    const o = stageCountsByType([], [], []);
    expect(Object.keys(o).sort()).toEqual([...SOURCE_TYPES].sort());
    for (const t of SOURCE_TYPES) expect(STAGES.every((s) => o[t][s] === 0)).toBe(true);
    clean(o);
  });
});

describe("conversions", () => {
  it("is all null for zeros", () => {
    const c = conversions(zeroStages());
    expect(c).toHaveLength(6);
    expect(c.every((x) => x.rate === null)).toBe(true);
    clean(c);
  });
  it("is null when the stage exceeds the previous one", () => {
    const s: StageCounts = { ...zeroStages(), leads: 100, qualified: 20, invited: 30 };
    const c = conversions(s);
    expect(c[0]).toEqual({ from: "leads", to: "qualified", rate: 0.2 });
    expect(c[1]).toEqual({ from: "qualified", to: "invited", rate: null });
    expect(c[2].rate).toBe(0); // invited -> confirmed: 0 of 30 is a real 0, not null
  });
  it("a real zero stays 0, not null", () => {
    expect(conversions({ ...zeroStages(), leads: 10 })[0].rate).toBe(0);
  });
});

describe("dailySeries", () => {
  const rows = [
    agg({ driveId: "dx", date: "2026-10-10", wanted: 12, streamType: "meta_live", invited: 5, confirmed: 3, arrived: 2 }),
    agg({ driveId: "dx", date: "2026-10-10", wanted: 12, streamType: null, invited: 4, confirmed: 2, arrived: 1 }),
  ];
  const s = dailySeries(rows, "2026-10-09", "2026-10-13");
  it("skips Sunday, counts target once and zero-fills", () => {
    expect(s.map((p) => p.date)).toEqual(["2026-10-09", "2026-10-10", "2026-10-12", "2026-10-13"]);
    expect(s.map((p) => p.target)).toEqual([0, 12, 0, 0]);
    expect(s[1].byType.meta_live).toEqual({ invited: 5, confirmed: 3, arrived: 2 });
    expect(s[1].byType.he).toEqual({ invited: 4, confirmed: 2, arrived: 1 });
    expect(s[0].byType.meta_old).toEqual({ invited: 0, confirmed: 0, arrived: 0 });
    clean(s);
  });
  it("keeps a Sunday that holds a drive", () => {
    const o = dailySeries([agg({ date: "2026-10-11", wanted: 3 })], "2026-10-09", "2026-10-13");
    expect(o.map((p) => p.date)).toContain("2026-10-11");
  });
  it("ignores rows outside the window", () => {
    expect(dailySeries([agg({ date: "2026-11-01", wanted: 9 })], "2026-10-09", "2026-10-10").every((p) => p.target === 0)).toBe(true);
  });
});

describe("timingGrids", () => {
  const g = timingGrids([{ sourceType: "he", weekday: 6, hour: 23, n: 2 }, { sourceType: "he", weekday: 7, hour: 1, n: 5 }, { sourceType: "he", weekday: 0, hour: 24, n: 5 }]);
  it("maps Sunday 23h and ignores out-of-range cells", () => {
    expect(g.he[6][23]).toBe(2);
    expect(g.he.flat().reduce((a, b) => a + b, 0)).toBe(2);
    for (const t of SOURCE_TYPES) { expect(g[t]).toHaveLength(7); expect(g[t].every((r) => r.length === 24)).toBe(true); }
    clean(g);
  });
});

describe("scatterPoints", () => {
  const base = { requisitionId: "r1", code: "R-1", branch: "Pune", sourceType: "he" as const };
  it("show rate is 0 with no confirmed, and a point needs leads or confirmed", () => {
    const sources = [{ requisitionId: "r1", rows: [src({ sourceType: "he", leads: 10, joined: 2 })] }];
    const p = scatterPoints([{ ...base, confirmed: 0, arrived: 0 }, { ...base, requisitionId: "r2", confirmed: 0, arrived: 0 }], sources);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ requisitionId: "r1", leads: 10, showRate: 0, leadToJoinRate: 0.2 });
    clean(p);
  });
  it("a point with confirmed but no leads has lead-to-join 0", () => {
    const p = scatterPoints([{ ...base, confirmed: 4, arrived: 3 }], []);
    expect(p).toEqual([{ ...base, leads: 0, showRate: 0.75, leadToJoinRate: 0 }]);
  });
});

describe("waterfall", () => {
  const s = { leads: 100, qualified: 40, invited: 30, confirmed: 10, arrived: 6, selected: 3, joined: 1, noShow: 3, declined: 4 };
  const w = waterfall(s, { opted_out: 2 }, 1);
  it("splits losses into reasons that sum to lost", () => {
    expect(w).toHaveLength(6);
    expect(w[0]).toEqual({ from: "leads", to: "qualified", lost: 60, reasons: [{ reason: "not_qualified", n: 60 }] });
    expect(w[1]).toMatchObject({ lost: 10, reasons: [{ reason: "opted_out", n: 2 }, { reason: "not_invited", n: 8 }] });
    expect(w[2].reasons).toEqual([{ reason: "declined", n: 4 }, { reason: "no_reply", n: 16 }]);
    expect(w[3].reasons).toEqual([{ reason: "no_show", n: 3 }, { reason: "slot_released", n: 1 }]);
    expect(w[3].lost).toBe(4);
    for (const st of w) expect(st.reasons.reduce((a, r) => a + r.n, 0)).toBe(st.lost);
    clean(w);
  });
  it("caps named reasons at what is left and never goes negative", () => {
    const o = waterfall({ ...s, qualified: 10, invited: 30, declined: 99 }, { opted_out: 50 }, 0);
    expect(o[1].lost).toBe(0); expect(o[1].reasons).toEqual([]);
    expect(o[2].reasons).toEqual([{ reason: "declined", n: 20 }]);
    clean(o);
  });
  it("all zeros give empty reasons", () => {
    const o = waterfall({ ...zeroStages(), noShow: 0, declined: 0 }, {}, 0);
    expect(o.every((x) => x.lost === 0 && x.reasons.length === 0)).toBe(true);
  });
});
