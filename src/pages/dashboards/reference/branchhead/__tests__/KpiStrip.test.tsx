import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import type { BranchOverview } from "../../../../../../backend/src/modules/branch-head-health/types";
import { KPI_HUE, kpiStatus, KpiStrip } from "../KpiStrip";
import { buildKpis, KPI_IDS, KPI_TONES, mandateTone, toneFor } from "../kpiModel";
import * as fx from "./fixtures";

const overview = (o: Partial<BranchOverview> = {}): BranchOverview => ({
  branch: { branchId: "b1", branchCode: "b1", branchName: "Kolkata" }, date: "2026-10-15", status: "healthy",
  attention: [], positives: [],
  people: fx.ok(fx.people), attendance: fx.ok(fx.attendance), hiring: fx.ok(fx.hiring), finance: fx.ok(fx.finance),
  leaderboard: fx.ok([]), attrition: fx.ok(fx.attrition), ...o,
});
const html = (ov: BranchOverview, trends: Record<string, Array<number | null>> = {}) =>
  renderToStaticMarkup(<KpiStrip overview={ov} trends={trends} onOpen={() => {}} />);

describe("KPI_TONES", () => {
  it("shrinkage: >= 20 critical, >= 10 warning, else good; null neutral", () => {
    expect(toneFor(20, KPI_TONES.shrinkagePct)).toBe("critical");
    expect(toneFor(10, KPI_TONES.shrinkagePct)).toBe("warning");
    expect(toneFor(9.9, KPI_TONES.shrinkagePct)).toBe("good");
    expect(toneFor(null, KPI_TONES.shrinkagePct)).toBe("neutral");
    expect(toneFor(Number.NaN, KPI_TONES.shrinkagePct)).toBe("neutral");
  });
  it("budget >= 95 critical, >= 80 warning; late share >= 15 / >= 8", () => {
    expect(toneFor(95, KPI_TONES.budgetPct)).toBe("critical");
    expect(toneFor(80, KPI_TONES.budgetPct)).toBe("warning");
    expect(toneFor(79.9, KPI_TONES.budgetPct)).toBe("good");
    expect(toneFor(15, KPI_TONES.lateSharePct)).toBe("critical");
    expect(toneFor(8, KPI_TONES.lateSharePct)).toBe("warning");
  });
  it("OP % below 0 critical, below 5 warning (lower is worse)", () => {
    expect(toneFor(-0.1, KPI_TONES.opPct)).toBe("critical");
    expect(toneFor(0, KPI_TONES.opPct)).toBe("warning");
    expect(toneFor(5, KPI_TONES.opPct)).toBe("good");
  });
  it("GRN pending > 0 warning, >= 10 critical; attrition risk >= 1 warning, >= 10 critical", () => {
    expect(toneFor(0, KPI_TONES.grnPending)).toBe("good");
    expect(toneFor(1, KPI_TONES.grnPending)).toBe("warning");
    expect(toneFor(10, KPI_TONES.grnPending)).toBe("critical");
    expect(toneFor(0, KPI_TONES.attritionRisk)).toBe("good");
    expect(toneFor(7, KPI_TONES.attritionRisk)).toBe("warning");
  });
  it("headcount vs mandate: under 80% critical, under 90% or over 110% warning, no mandate neutral", () => {
    expect(mandateTone(120, 130)).toBe("good");
    expect(mandateTone(100, 130)).toBe("critical");
    expect(mandateTone(115, 130)).toBe("warning");
    expect(mandateTone(150, 130)).toBe("warning");
    expect(mandateTone(120, 0)).toBe("neutral");
    expect(mandateTone(120, null)).toBe("neutral");
  });
});

describe("KpiStrip", () => {
  it("renders exactly 8 tiles, each a button, in the agreed order", () => {
    const out = html(overview());
    expect(KPI_IDS).toEqual(["shrinkage", "late", "headcount", "attrition", "profit", "budget", "grn", "openings"]);
    expect(out.split("<button").length - 1).toBe(8);
    const labels = ["Shrinkage", "Late today", "Headcount vs mandate", "Attrition risk", "Operating profit", "Budget used", "GRN pending", "Open positions"];
    const at = labels.map((l) => out.indexOf(l));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });
  it("shows the payload values", () => {
    const out = html(overview());
    for (const v of ["12.0%", ">12<", "120 / 130", ">7<", "2 critical, 5 high", "13.6%", "62.5%", ">5<", "2 over 3 days", ">4<"]) expect(out).toContain(v);
  });
  it("has a delta only for shrinkage (vs yesterday), and none without previousDay", () => {
    const out = html(overview());
    expect(out.split("vs yesterday").length - 1).toBe(1);
    expect(out).toContain("+2.0 pts vs yesterday");
    const tiles = buildKpis(overview());
    expect(tiles.filter((t) => t.delta).map((t) => t.id)).toEqual(["shrinkage"]);
    const noPrev = overview({ attendance: fx.ok({ ...fx.attendance, previousDay: null }) });
    expect(html(noPrev)).not.toContain("vs yesterday");
  });
  it("status stays text + icon on the tile: Warning / Critical chips only where a tile needs a look", () => {
    const out = html(overview());
    expect(out.split('class="bhl-kpi-status"').length - 1).toBeGreaterThanOrEqual(3);
    expect(out).toContain(">Warning<");
    expect(out).toContain("+2.0 pts vs yesterday");
    expect(kpiStatus({ id: "grn", label: "", value: "", tone: "serious" })).toBe("critical");
    expect(kpiStatus({ id: "grn", label: "", value: "", tone: "good" })).toBeNull();
    const calm = html(overview({ attendance: fx.ok({ ...fx.attendance, absent: 0, scheduled: 100, shrinkagePct: 1, totalLate: 0, previousDay: null }),
      finance: fx.ok({ ...fx.finance, grn: null }), attrition: undefined, people: fx.ok({ ...fx.people, mandateSeatsTotal: 120 }) }));
    expect(calm).not.toContain('class="bhl-kpi-status"');
  });
  it("solid gradient tiles, a different hue per metric; a critical status turns the tile rose", () => {
    const out = html(overview());
    expect(out.split('class="bhl-kpi bhl-hue-').length - 1).toBe(8);
    expect(new Set(Object.values(KPI_HUE)).size).toBe(8);
    expect(out).not.toContain('data-hue="rose"');
    const crit = html(overview({ finance: fx.ok({ ...fx.finance, grn: { ...fx.finance.grn!, pending: 12 } }) }));
    expect(crit).toContain('data-hue="rose"');
    expect(crit).toContain(">Critical<");
  });
  it("degrades cleanly when sections are missing or errored", () => {
    const err = fx.err<never>("down");
    const out = html(overview({ attendance: err, people: err, hiring: err, finance: err, attrition: undefined }));
    expect(out.split("<button").length - 1).toBe(8);
    expect(out).not.toContain("NaN");
    expect(out).not.toContain("vs yesterday");
    expect(out).toContain("—");
  });
  it("each tile calls onOpen with its KPI id", () => {
    const onOpen = vi.fn();
    const tree = KpiStrip({ overview: overview(), trends: {}, onOpen }) as ReactElement;
    const clicks: Array<() => void> = [];
    const walk = (n: ReactNode) => {
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (!isValidElement(n)) return;
      const props = n.props as { onClick?: () => void; children?: ReactNode };
      if (typeof props.onClick === "function") clicks.push(props.onClick);
      walk(props.children);
    };
    walk(tree);
    expect(clicks).toHaveLength(8);
    clicks.forEach((c) => c());
    expect(onOpen.mock.calls.map((c) => c[0])).toEqual([...KPI_IDS]);
  });
});

describe("empty branches do not show fake numbers", () => {
  const tile = (ov: BranchOverview, id: string) => buildKpis(ov).find((t) => t.id === id)!;
  it("nobody scheduled: shrinkage is a dash with a plain note and no -100 pts delta", () => {
    const att = { ...fx.attendance, scheduled: 0, present: 0, absent: 0, onLeave: 0, shrinkagePct: 0 };
    const t = tile(overview({ attendance: fx.ok(att) }), "shrinkage");
    expect(t.value).toBe("—");
    expect(t.tone).toBe("neutral");
    expect(t.hint).toBe("Nobody scheduled today");
    expect(t.delta).toBeUndefined();
  });
  it("no schedule yesterday: no delta; a normal day keeps its delta", () => {
    const att = { ...fx.attendance, previousDay: { shrinkagePct: 0, absent: 0, scheduled: 0 } };
    expect(tile(overview({ attendance: fx.ok(att) }), "shrinkage").delta).toBeUndefined();
    expect(tile(overview(), "shrinkage").delta?.text).toContain("pts vs yesterday");
  });
  it("no budget set: budget used is a dash saying so; no P&L activity says so", () => {
    const fi = { ...fx.finance, revenueRunning: 0, totalCostRunning: 0, budget: { ...fx.finance.budget, totalBudget: 0, available: 0 } };
    const ov = overview({ finance: fx.ok(fi) });
    expect(tile(ov, "budget")).toMatchObject({ value: "—", hint: "No budget set", tone: "neutral" });
    expect(tile(ov, "profit").hint).toBe("No P&L activity yet");
  });
});
