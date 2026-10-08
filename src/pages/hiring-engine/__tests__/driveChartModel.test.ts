import { describe, expect, it } from "vitest";
import { conversionHeatmap, dayLabel, funnelChart, scatterChart, sparklinePath, timingHeatmap, waterfallChart, yieldChart } from "../command/driveChartModel";
import { SEQ_RAMP, TYPE_PATTERN, TYPE_SHAPE, chartMotion, divergingColor, seriesColor, sequentialStep } from "../command/chartTheme";
import { pctText } from "../command/driveCommandModel";
import { STAGES } from "../command/driveCommandTypes";
import type { DriveAnalytics, Grid, SourceType, Stage, StageCounts } from "../command/driveCommandTypes";

const TYPES: SourceType[] = ["meta_live", "meta_old", "he"];
const sc = (o: Partial<StageCounts> = {}): StageCounts => ({ leads: 0, qualified: 0, invited: 0, confirmed: 0, arrived: 0, selected: 0, joined: 0, ...o });
const conv = (s: StageCounts) => STAGES.slice(1).map((to, i) => ({ from: STAGES[i], to, rate: s[STAGES[i]] > 0 ? s[to] / s[STAGES[i]] : null }));
const typ = (s: StageCounts) => ({ stages: s, previous: sc(), noShow: 0, declined: 0, conversions: conv(s), sparkline: [] });
const zeroGrid = (): Grid => Array.from({ length: 7 }, () => Array(24).fill(0));
const byType = (l: number, o: number, h: number) => ({
  meta_live: { invited: l, confirmed: l, arrived: l }, meta_old: { invited: o, confirmed: o, arrived: o }, he: { invited: h, confirmed: h, arrived: h },
});
const live = sc({ leads: 100, qualified: 60, invited: 50, confirmed: 30, arrived: 20, selected: 10, joined: 8 });
const he = sc({ leads: 40, qualified: 30, invited: 30, confirmed: 24, arrived: 20, selected: 12, joined: 9 });
const heTiming = zeroGrid(); heTiming[6][23] = 2;
const fixture = (): DriveAnalytics => ({
  generatedAt: "2026-10-14T05:00:00Z", window: { from: "2026-10-09", to: "2026-10-14", days: 6 }, previousWindow: { from: "2026-10-03", to: "2026-10-08" },
  filter: { requisitionId: null, branch: null }, followupMode: "off", qualifiedTracked: false,
  types: { meta_live: typ(live), meta_old: typ(sc()), he: typ(he) }, typesPresent: ["meta_live", "he"],
  daily: ["2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14"].map((date, i) => ({ date, target: 25, byType: byType(i, 0, i * 2) })),
  timing: { replies: { meta_live: zeroGrid(), meta_old: zeroGrid(), he: heTiming }, arrivals: { meta_live: zeroGrid(), meta_old: zeroGrid(), he: zeroGrid() }, arrivalsWithoutTime: 0 },
  scatter: Array.from({ length: 8 }, (_, i) => ({ requisitionId: `r${i}`, code: `REQ-${i}`, branch: `B${i}`, sourceType: TYPES[i % 3], leads: 10 + i * 7, showRate: 0.3 + i / 100, leadToJoinRate: 0.05 + i / 200 })),
  waterfall: {
    meta_live: [{ from: "invited", to: "confirmed", lost: 20, reasons: [{ reason: "declined", n: 4 }, { reason: "no_reply", n: 16 }] }, { from: "confirmed", to: "arrived", lost: 10, reasons: [{ reason: "no_show", n: 10 }] }],
    meta_old: [], he: [],
  },
  groups: [], cost: { available: false, note: "" }, insights: [], requisitionCount: 3, truncated: false, partial: false, failedSections: [],
}) as unknown as DriveAnalytics;
const empty = (): DriveAnalytics => ({ ...fixture(), types: { meta_live: typ(sc()), meta_old: typ(sc()), he: typ(sc()) }, daily: [], scatter: [], waterfall: { meta_live: [], meta_old: [], he: [] },
  timing: { replies: { meta_live: [], meta_old: [], he: [] }, arrivals: { meta_live: [], meta_old: [], he: [] }, arrivalsWithoutTime: 0 } });
const num = (s: string) => Number(s.split(" ")[0].replace("%", ""));

describe("parity: table rows equal the series", () => {
  it("funnel", () => {
    const f = funnelChart(fixture());
    expect(f.table.rows).toHaveLength(f.stages.length);
    f.stages.forEach((s, i) => {
      const row = f.table.rows[i];
      expect(row[0]).toBe(s.label);
      TYPES.forEach((t, k) => { expect(row[1 + 2 * k]).toBe(String(s.values[t])); expect(row[2 + 2 * k]).toBe(pctText(s.conversion[t])); });
    });
    const sum = (r: string[][]) => r.reduce((n, row) => n + TYPES.reduce((m, _t, k) => m + Number(row[1 + 2 * k]), 0), 0);
    expect(sum(f.table.rows)).toBe(f.stages.reduce((n, s) => n + TYPES.reduce((m, t) => m + s.values[t], 0), 0));
  });
  it("yield: five rows, sum, max and per point", () => {
    const y = yieldChart(fixture());
    expect(y.points.map((p) => p.date)).toEqual(["2026-10-09", "2026-10-10", "2026-10-12", "2026-10-13", "2026-10-14"]);
    expect(y.table.rows).toHaveLength(5);
    y.points.forEach((p, i) => expect(y.table.rows[i]).toEqual([p.label, String(p.meta_live), String(p.meta_old), String(p.he), String(p.target)]));
    for (const [col, key] of [[1, "meta_live"], [2, "meta_old"], [3, "he"]] as const) {
      const cells = y.table.rows.map((r) => Number(r[col]));
      const vals = y.points.map((p) => p[key]);
      expect(cells.reduce((a, b) => a + b, 0)).toBe(vals.reduce((a, b) => a + b, 0));
      expect(Math.max(...cells)).toBe(Math.max(...vals));
    }
    expect(y.points[4].label).toBe("Wed 14 Oct");
  });
  it("conversion heatmap", () => {
    const h = conversionHeatmap(fixture());
    h.rows.forEach((r, i) => r.cells.forEach((c, k) => {
      const shown = h.table.rows[i][1 + k];
      expect(shown.startsWith(c.text)).toBe(true);
      if (c.rate !== null) expect(num(shown)).toBe(Math.round(c.rate * 100));
    }));
  });
  it("timing heatmap", () => {
    const g = timingHeatmap(fixture(), "replies", "he");
    expect(g.peak).toEqual({ weekday: "Sun", hour: 23, n: 2 });
    expect(g.max).toBe(2);
    const sun = g.table.rows.find((r) => r[0] === "Sun")!;
    expect(sun[24]).toBe("2");
    expect(g.table.columns[24]).toBe("23");
    g.rows.forEach((r, i) => expect(g.table.rows[i].slice(1)).toEqual(r.cells.map(String)));
    expect(g.table.rows.flatMap((r) => r.slice(1).map(Number)).reduce((a, b) => a + b, 0)).toBe(2);
  });
  it("scatter", () => {
    const s = scatterChart(fixture());
    expect(s.table.rows).toHaveLength(8);
    s.points.forEach((p, i) => {
      expect(s.table.rows[i][3]).toBe(String(p.z));
      expect(s.table.rows[i][4]).toBe(pctText(p.x / 100));
      expect(s.table.rows[i][5]).toBe(pctText(p.y / 100));
    });
    expect(s.table.rows.reduce((n, r) => n + Number(r[3]), 0)).toBe(s.points.reduce((n, p) => n + p.leads, 0));
  });
  it("waterfall", () => {
    const w = waterfallChart(fixture(), "meta_live");
    w.bars.forEach((b, i) => expect(w.table.rows[i]).toEqual([b.label, String(b.base + b.lost), String(b.base), String(b.lost), b.reasons]));
  });
});

describe("funnel", () => {
  it("meta_old is all zero with null conversions rendered as an en dash", () => {
    const f = funnelChart(fixture());
    f.stages.forEach((s, i) => { expect(s.values.meta_old).toBe(0); expect(s.conversion.meta_old).toBeNull(); expect(f.table.rows[i][4]).toBe("–"); });
    expect(f.biggestDrop.meta_old).toBeNull();
  });
  it("biggestDrop is the pair with the lowest non-null conversion", () => {
    const f = funnelChart(fixture());
    const rates = f.stages.filter((s) => s.conversion.meta_live !== null).map((s) => [s.stage, s.conversion.meta_live as number] as [Stage, number]);
    const lowest = rates.reduce((a, b) => (b[1] < a[1] ? b : a));
    expect(f.biggestDrop.meta_live).toBe(lowest[0]);
    expect(lowest[0]).toBe("selected"); // 10/20 = 0.5, vs 0.6 .. 0.8
  });
});

describe("conversion heatmap", () => {
  it("rate 0.3 vs average 0.4 is below, with text 30%; null rate has no direction", () => {
    const a = fixture();
    // live leads 100 -> qualified 30 (0.3); he leads 100 -> qualified 50; old 0: combined 80/200 = 0.4
    a.types.meta_live = typ(sc({ leads: 100, qualified: 30 }));
    a.types.he = typ(sc({ leads: 100, qualified: 50 }));
    const h = conversionHeatmap(a);
    const live = h.rows.find((r) => r.sourceType === "meta_live")!.cells[0];
    expect(live).toMatchObject({ rate: 0.3, average: 0.4, direction: "below", text: "30%" });
    const old = h.rows.find((r) => r.sourceType === "meta_old")!.cells[0];
    expect(old).toMatchObject({ rate: null, direction: null, text: "–", delta: null });
  });
});

describe("timing", () => {
  it("all zero gives peak null and the empty flag", () => {
    const g = timingHeatmap(fixture(), "arrivals", "he");
    expect(g.peak).toBeNull();
    expect(g.max).toBe(0);
    expect(g.empty).toBe(true);
  });
});

describe("scatter", () => {
  it("has exactly 5 labelled, largest leads first", () => {
    const s = scatterChart(fixture());
    expect(s.points).toHaveLength(8);
    expect(s.points.filter((p) => p.labelled)).toHaveLength(5);
    expect(s.points.map((p) => p.leads)).toEqual([...s.points.map((p) => p.leads)].sort((a, b) => b - a));
    expect(s.points.slice(0, 5).every((p) => p.labelled)).toBe(true);
    expect(s.points[0]).toMatchObject({ x: 37, z: 59 });
  });
});

describe("waterfall", () => {
  it("base + lost is the previous stage value; reasons text", () => {
    const w = waterfallChart(fixture(), "meta_live");
    expect(w.bars[0].base + w.bars[0].lost).toBe(live.invited);
    expect(w.bars[1].base + w.bars[1].lost).toBe(live.confirmed);
    expect(w.bars[0].reasons).toBe("declined 4, no reply 16");
  });
  it("names the recorded reasons under declined and no-show, and the table cell equals it", () => {
    const a = fixture();
    a.waterfall.meta_live[0].reasons[0].detail = [{ code: "distance", n: 2 }, { code: "salary", n: 1 }, { code: "not_stated", n: 1 }];
    a.waterfall.meta_live[1].reasons[0].detail = [{ code: "other_job", n: 6 }, { code: "not_stated", n: 4 }];
    const w = waterfallChart(a, "meta_live");
    expect(w.bars[0].reasons).toBe("declined 4 (distance 2, salary 1, not stated 1), no reply 16");
    expect(w.bars[1].reasons).toBe("no show 10 (got another job 6, not stated 4)");
    w.bars.forEach((b, i) => expect(w.table.rows[i][4]).toBe(b.reasons));
  });
  it("an empty detail prints as today", () => {
    const a = fixture();
    a.waterfall.meta_live[0].reasons[0].detail = [];
    expect(waterfallChart(a, "meta_live").bars[0].reasons).toBe("declined 4, no reply 16");
  });
});

describe("sparklinePath", () => {
  it("flat, empty, scaled", () => {
    expect(sparklinePath([0, 0, 0], 60, 20)).toBe("M0,19 L30,19 L60,19");
    expect(sparklinePath([], 60, 20)).toBe("");
    expect(sparklinePath([0, 5, 10], 60, 20)).toBe("M0,19 L30,10 L60,1");
    expect(sparklinePath([Number.NaN, Infinity], 10, 10)).not.toMatch(/NaN|Infinity/);
  });
});

describe("theme", () => {
  it("colours, steps, diverging", () => {
    expect(seriesColor("meta_old", true)).toBe("#d95926");
    expect(seriesColor("meta_live", true)).toBe("#3987e5");
    expect(seriesColor("he", true)).toBe("#199e70");
    expect(seriesColor("he", false)).toBe("#1baf7a");
    expect(sequentialStep(0, 10)).toBe(0);
    expect(sequentialStep(10, 10)).toBe(5);
    expect(sequentialStep(1, 0)).toBe(0);
    expect(SEQ_RAMP).toHaveLength(6);
    expect(divergingColor(0.01, false)).toBe("#f0efec");
    expect(divergingColor(0.01, true)).toBe("#383835");
    expect(divergingColor(0.5, false)).not.toBe(divergingColor(-0.5, false));
    expect(divergingColor(Number.NaN, false)).toBe("#f0efec");
  });
  it("every type has its own marker shape and texture", () => {
    expect(new Set(TYPES.map((t) => TYPE_SHAPE[t])).size).toBe(3);
    expect(new Set(TYPES.map((t) => TYPE_PATTERN[t].id)).size).toBe(3);
    expect(new Set(TYPES.map((t) => seriesColor(t, false))).size).toBe(3);
  });
  it("reduced motion turns animation off", () => {
    expect(chartMotion(true)).toEqual({ animate: false, durationMs: 0 });
    expect(chartMotion(false).animate).toBe(true);
    expect(yieldChart(fixture(), { prefersReducedMotion: true }).motion.animate).toBe(false);
    expect(funnelChart(fixture()).motion.animate).toBe(true);
  });
});

describe("labels and empty states", () => {
  const all = (a: DriveAnalytics) => [funnelChart(a), yieldChart(a), conversionHeatmap(a), timingHeatmap(a, "replies", "he"), scatterChart(a), waterfallChart(a, "meta_live")];
  it("every series has a non-empty label string (aqua is below 3:1 on light, so direct labels are mandatory)", () => {
    for (const c of all(fixture())) { expect(c.series.length).toBeGreaterThan(0); for (const s of c.series) expect(s.label.trim().length).toBeGreaterThan(0); }
  });
  it("zero and empty input flags empty and never yields NaN or Infinity", () => {
    const a = empty();
    for (const c of all(a)) { expect(c.empty).toBe(true); const j = JSON.stringify(c); expect(j).not.toMatch(/NaN|Infinity/); expect(j).not.toContain("null,null,null"); }
    expect(all(fixture()).every((c) => c.empty === false || c.series.length > 0)).toBe(true);
    const junk = { types: {}, daily: [{ date: "x", target: Number.NaN, byType: {} }], timing: {}, scatter: [{ code: "a", leads: Number.NaN, showRate: Infinity, leadToJoinRate: Number.NaN }] } as unknown as DriveAnalytics;
    for (const c of all(junk)) expect(JSON.stringify(c)).not.toMatch(/NaN|Infinity/);
  });
  it("no output of the fixture contains NaN", () => {
    for (const c of all(fixture())) expect(JSON.stringify(c)).not.toMatch(/NaN|Infinity/);
  });
  it("dates are labelled without the browser zone", () => {
    expect(dayLabel("2026-10-11")).toBe("Sun 11 Oct");
    expect(dayLabel("bad")).toBe("bad");
  });
});
