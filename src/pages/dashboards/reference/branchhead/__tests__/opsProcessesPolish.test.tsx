import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SectionResult } from "../../../../../../backend/src/modules/branch-head-health/types";
import type { BranchProcess } from "../../../../../../backend/src/modules/branch-head-health/processes";
import { OpsQualityVisual, opsKpis, qaBand, qualityTable } from "../sections/OpsQualityVisual";
import { CallmasterBlock } from "../sections/CallmasterBlock";
import { cxItems, trendChart } from "../sections/callmasterParts";
import { ProcessesTab, coverageMix, processKpis } from "../sections/ProcessesVisual";
import { ProcessCoveragePanel, applyFilter } from "../ProcessCoveragePanel";
import { freshness, seatGap, sortWorstFirst } from "../processRows";
import { richOverview, richPayload } from "./richFixtures";
import { procRow } from "./fixtures";

vi.mock("@/lib/hrmsApi", () => ({ hrmsApi: { get: vi.fn() } }));

const ok = (data: unknown): SectionResult<any> => ({ status: "ok", data, asOf: "2026-10-15" });
const empty: SectionResult<any> = { status: "empty", data: null, asOf: "2026-10-15" };
const wrap = (el: JSX.Element) => renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}>{el}</QueryClientProvider>);
const ops = (o = richOverview()) => renderToStaticMarkup(<OpsQualityVisual overview={o} payload={richPayload(o)} onSelect={() => {}} />);

describe("Operations tab polish", () => {
  it("KPI tiles from the payload, clickable, warnings as words", () => {
    const k = opsKpis(richOverview().operations, richOverview().quality);
    expect(k).toMatchObject({ total: 5, reporting: 5, stale: 1, baseline: 0 });
    expect(k.avgQa).toBeCloseTo(77, 5);
    expect(k.avgAht).toBeCloseTo(324, 5);
    const out = ops();
    expect(out).toContain('aria-label="Operations summary"');
    for (const t of ["Processes reporting", "Average QA %", "77.0%", "Below target (target 85%)", "Average AHT", "324", "Stale data", "Baseline only", "Warning"]) expect(out, t).toContain(t);
    expect(out.split('<button type="button" class="bhl-kpi').length - 1).toBe(5);
  });
  it("quality bands: green at target, amber to the floor, red below, missing is No score", () => {
    expect([qaBand(85).word, qaBand(80).word, qaBand(70).word, qaBand(null).word]).toEqual(["On target", "Below target", "Critical", "No score"]);
    const rows = [{ processCode: "a", processName: "Hi", tier: "full", QA_QUALITY_PCT: 90, latestDate: "2026-10-14", stale: false },
      { processCode: "b", processName: "Lo", tier: "full", QA_QUALITY_PCT: 60, latestDate: "2026-09-01", stale: true }] as never;
    expect(qualityTable(rows).rows).toEqual([["Lo", "60.0%", "Critical", "2026-09-01", "Stale"], ["Hi", "90.0%", "On target", "2026-10-14", "Current"]]);
    const out = ops();
    for (const t of ["Lowest quality processes", "3 of 4 below 85%", "Critical", "Below target", "On target", "Stale · 2026-10-14", "#d03b3b"]) expect(out, t).toContain(t);
  });
  it("Callmaster parts: CX bars sorted, trend chart with quality line, fatal tiles and count table", () => {
    const cm = (richOverview().callmaster!.data as any);
    expect(cxItems(cm.cx).map((c) => c.label)).toEqual(["Empathy expressed", "Active listening", "Resolution"]);
    const t = trendChart(cm.qualityTrend.data)!;
    expect(t.xKey).toBe("period");
    expect(t.series.find((s) => s.key === "quality")?.kind).toBe("line");
    expect(t.series.find((s) => s.key === "calls")?.axis).toBe("right");
    const out = ops();
    for (const t2 of ["Callmaster KPIs", "Inbound 1240 · Outbound 410", "CX parameters", "Quality trend", "2 days", "Quality trend by day: 2026-10-13", "Fatal calls", "7 fatal calls", "Fatal calls per agent", "1.8"]) expect(out, t2).toContain(t2);
  });
  it("trend with only right-axis series falls back to the left axis; no identity columns", () => {
    const t = trendChart([{ day: "d1", calls: 3, agent_name: "Zed" }])!;
    expect(t.series).toEqual([{ key: "calls", label: "Calls", color: "#9ec5f4", axis: undefined }]);
    expect(trendChart([])).toBeNull();
  });
  it("honest empty state when no Callmaster client is mapped", () => {
    const out = renderToStaticMarkup(<CallmasterBlock section={empty} />);
    expect(out).toContain("No Callmaster client is mapped to this branch&#x27;s processes");
    expect(out).toContain("Ask the Callmaster admin to map a client");
    const all = ops(richOverview({ operations: empty, quality: empty, callmaster: empty }));
    expect(all).not.toContain("Operations summary");
    expect(all).toContain("No operational metrics for this branch");
    expect(all).not.toContain("NaN");
  });
});

const P = (o: Partial<BranchProcess>) => procRow(o);

describe("Processes tab polish", () => {
  it("freshness, seat gap and worst-first order", () => {
    expect(freshness(null, "2026-10-15")).toBe("none");
    expect(freshness("2026-10-01", "2026-10-15")).toBe("current");
    expect(freshness("2026-09-30", "2026-10-15")).toBe("stale");
    expect(seatGap({ headcount: 12, mandatedSeats: 10 })).toEqual({ mandated: true, over: 2, open: 0 });
    expect(seatGap({ headcount: 12, mandatedSeats: 0 }).mandated).toBe(false);
    const rows = [P({ processId: "a", processName: "Good", headcount: 10, mandatedSeats: 10 }), P({ processId: "b", processName: "Over", headcount: 20, mandatedSeats: 10 }),
      P({ processId: "c", processName: "Base", tier: "baseline", headcount: 5, mandatedSeats: 10 })];
    expect(sortWorstFirst(rows, "2026-10-15").map((r) => r.processName)).toEqual(["Over", "Base", "Good"]);
    expect(applyFilter(rows, "over").map((r) => r.processName)).toEqual(["Over"]);
    expect(applyFilter(rows, "baseline").map((r) => r.processName)).toEqual(["Base"]);
  });
  it("KPI tiles count active, coverage, stale, unmapped and data health; mix sums to active", () => {
    const d = richPayload();
    const k = processKpis(d.processes, d.dataHealth, "2026-10-15");
    expect(k).toMatchObject({ active: 6, mirrors: 1, full: 2, baseline: 1, stale: 1, unmapped: 1, ccWithoutProcess: 2, overMandate: 1, dhNote: null });
    expect(coverageMix(d.processes.active).reduce((a, m) => a + m.value, 0)).toBe(6);
    const none = processKpis(d.processes, { status: "error", data: null, asOf: "x" });
    expect(none.ccWithoutProcess).toBeNull();
    expect(none.dhNote).toBe("Data health unavailable");
  });
  it("tab renders tiles, coverage mix, over-mandate card and the navy coverage table worst first", () => {
    const out = wrap(<ProcessesTab data={richPayload()} selectedBranchId="b1" branchNames={{ b1: "Kolkata - Salt Lake" }} onOpenProcess={() => {}} />);
    for (const t of ['aria-label="Process coverage summary"', "Active processes", "Full coverage", "Baseline only", "Stale processes", "Unmapped processes",
      "Cost centres without a process", "Cost centres over mandate", "Critical", "Coverage mix", "Process coverage, worst first", "Over mandate +20", "No mandate",
      "90 headcount - no mandated seats", "Stale", "No data", "Kolkata - Salt Lake", 'aria-expanded="false"', "Open Delta Collections details"]) expect(out, t).toContain(t);
    expect(out.indexOf(">Delta Collections<")).toBeLessThan(out.indexOf(">Alpha Voice<"));
    expect(out).not.toContain("NaN");
  });
  it("a tile filter narrows the table and says so; unmapped filter opens its group", () => {
    const d = richPayload();
    const f = wrap(<ProcessCoveragePanel active={d.processes.active} unmapped={d.processes.unmapped} asOf="2026-10-15" filter="baseline" onClearFilter={() => {}} />);
    expect(f).toContain("Showing 1 of 6: Baseline only");
    expect(f).toContain("Clear filter");
    expect(f).not.toContain(">Alpha Voice<");
    const u = wrap(<ProcessCoveragePanel active={d.processes.active} unmapped={d.processes.unmapped} filter="unmapped" />);
    expect(u).toMatch(new RegExp('<details[^>]*data-group="unmapped"[^>]*open'));
  });
  it("more than ten processes show the top ten with Show all", () => {
    const many = Array.from({ length: 12 }, (_, i) => P({ processId: `x${i}`, processName: `Proc ${i}` }));
    expect(wrap(<ProcessCoveragePanel active={many} unmapped={[]} />)).toContain("Show all 12");
  });
});
