import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { BranchOverview, SectionResult } from "../../../../../../backend/src/modules/branch-head-health/types";
import { HiringVisual, buildHiring } from "../sections/HiringVisual";
import { BacklogVisual, backlogBuckets, buildBacklog } from "../sections/BacklogVisual";
import { DataHealthChips, OpsQualityVisual, heatTint, opsTable } from "../sections/OpsQualityVisual";
import * as fx from "./fixtures";

const render = (C: typeof HiringVisual, o: Partial<BranchOverview> = {}) => {
  const ov = fx.overviewOf(o);
  return renderToStaticMarkup(<C overview={ov} payload={fx.payloadOf(ov)} onSelect={() => {}} />);
};
const flat = (t: { rows: Array<Array<string | number | null>> }) => t.rows.map((r) => r.join("|")).join("\n");
const ok = (data: unknown): SectionResult<any> => ({ status: "ok", data, asOf: "2026-10-15" });

describe("HiringVisual", () => {
  const out = render(HiringVisual);
  it("funnel requested to fulfilled, offer meters, batches, ATS and pending actions", () => {
    const b = buildHiring(fx.hiring);
    expect(b.funnel.stages.map((s) => [s.label, s.value])).toEqual([["Requested", 20], ["In pipeline", 9], ["Selected", 3], ["Fulfilled", 12]]);
    expect(b.offers.map((m) => m.label)).toEqual(["Offer conversion, last 30 days", "Offer conversion, month to date"]);
    expect(flat(b.offersTable)).toContain("Offer conversion, last 30 days|28|40|70%|Within limit|12|70.0%");
    for (const t of ["Open positions", "1 pending approval", "Joining in next 7 days", "Telecaller", "2026-10-25 (10 d)", "Walk-ins", "SLA breaches today", "2 / 28",
      "Open hiring batches", "Short by 1", "Closure pending", "No feedback", "Offers made and joined", "Hiring funnel: Requested 20, In pipeline 9, Selected 3, Fulfilled 12"]) expect(out).toContain(t);
    expect(flat(b.batchesTable)).toContain("Batch A");
  });
  it("ATS outcomes stack keeps every outcome count in its table", () => {
    const b = buildHiring(fx.hiring);
    expect(b.atsTable.columns).toEqual(["Item", "Selected", "Rejected", "Open", "Other", "Total", "No-show", "Client round", "On hold"]);
    expect(flat(b.atsTable)).toContain("Tokens|8|9|8|6|31|3|2|1");
  });
  it("no names from planted fields; empty and missing", () => {
    const leaky = { ...fx.hiring, candidateName: "Zed Candidate", batches: fx.hiring.batches.map((x) => ({ ...x, requester: "Qasim Requester" })) };
    const o = render(HiringVisual, { hiring: ok(leaky) });
    expect(o).not.toContain("Zed Candidate");
    expect(o).not.toContain("Qasim Requester");
    expect(render(HiringVisual, { hiring: fx.emptySection() })).toContain("No hiring data for this date");
    const none = { ...fx.hiring, batches: [], offers: null, ats: null, pendingActions: [], requested: 0, inPipeline: 0, selected: 0, fulfilled: 0 };
    const z = render(HiringVisual, { hiring: ok(none) });
    expect(z).toContain("No open batches");
    expect(z).toContain("No ATS activity for this date");
    expect(z).not.toContain("NaN");
  });
});

describe("BacklogVisual", () => {
  it("age buckets are non-negative and sum to pending", () => {
    expect(backlogBuckets({ pending: 14, oldestDays: 9, over3Days: 6, over7Days: 2 })).toEqual({ within3: 8, d3to7: 4, over7: 2 });
    expect(backlogBuckets({ pending: 3, oldestDays: 9, over3Days: 5, over7Days: 6 })).toEqual({ within3: 0, d3to7: 0, over7: 3 });
    expect(backlogBuckets({ pending: 0, oldestDays: 0, over3Days: 0, over7Days: 0 })).toEqual({ within3: 0, d3to7: 0, over7: 0 });
  });
  it("stack per queue with the other counts in the table", () => {
    const b = buildBacklog(fx.backlogs);
    expect(b.bars.rows.map((r) => r.label)).toEqual(["Regularization", "Leave"]);
    expect(flat(b.table)).toContain("Regularization|8|4|2|14|9|Escalated 1");
    expect(flat(b.table)).toContain("Leave|3|2|0|5|4|Stale 1");
    const out = render(BacklogVisual, {});
    for (const t of ["Backlogs", "Within 3 days", "3 to 7 days", "Over 7 days", "Pending GRN stages"]) expect(out).toContain(t);
    expect(out).toContain("on the Finance tab");
  });
  it("empty and missing", () => {
    expect(render(BacklogVisual, { backlogs: fx.emptySection() })).toContain("No backlog data");
    expect(render(BacklogVisual, { backlogs: undefined })).toContain("Not available yet");
  });
});

const opsRows = [
  { processCode: "P1", processName: "Alpha Ops", tier: "full", metrics: { AHT: 300, INBOUND_SL_PCT: null, QA_QUALITY_PCT: 71.5 }, latestDate: "2026-09-01", stale: true },
  { processCode: "P2", processName: "Beta Ops", tier: "baseline", metrics: { AHT: 200, QA_QUALITY_PCT: 90 }, latestDate: "2026-10-14", stale: false },
];

describe("OpsQualityVisual", () => {
  it("heat grid is a real table with numbers, em dash, Stale badge and a one-hue tint", () => {
    const out = render(OpsQualityVisual, { operations: ok(opsRows) });
    for (const t of ["Operations and quality", "Alpha Ops", "Stale", "—", "300", "71.5", "Sale conversion %", "Baseline only"]) expect(out).toContain(t);
    expect(out).toContain("<table");
    expect(out).toContain('scope="col"');
    expect(heatTint(300, 200, 300)).not.toBe(heatTint(200, 200, 300));
    expect(heatTint(5, 5, 5)).toBe(heatTint(200, 200, 300));
    expect(flat(opsTable(opsRows as never))).toContain("Alpha Ops|Full|300|—|—|71.5|—|—|2026-09-01|Stale");
  });
  it("quality list, callmaster tiles, truncation notice; no agent names", () => {
    const out = render(OpsQualityVisual, {
      quality: ok([{ processCode: "P1", processName: "Alpha Q", tier: "full", QA_QUALITY_PCT: 71.5, latestDate: "2026-09-01", stale: true }]),
      callmaster: ok({
        kpis: ok({ inbound: { total: 100, avg_quality: 81.2, agent_name: "Zed Agent" }, outbound: { total: 40, conversion: 12.5 } }),
        qualityTrend: ok([{ period: "2026-10-01", quality: 80, agent: "Zed Agent" }]),
        cx: ok({ params: { express_empathy: 90.5 }, definitions: [{ key: "express_empathy", label: "Empathy Expressed" }] }),
        fatal: ok({ totalFatalCalls: 7, agentsWithFatals: 3, truncated: true }),
      }),
    });
    for (const t of ["Lowest quality processes", "Alpha Q", "Avg quality", "81.2", "Conversion", "12.5", "Inbound", "Outbound", "Empathy Expressed", "90.5", "Total fatal calls", "Agents with fatals", "Quality trend by day",
      "Showing the most recent 5,000 audit rows - counts are partial"]) expect(out).toContain(t);
    expect(out).not.toContain("Zed Agent");
  });
  it("empty states, error and all-missing", () => {
    const e = render(OpsQualityVisual, { operations: { status: "empty", data: null, asOf: "x" }, callmaster: { status: "empty", data: null, asOf: "x" } });
    expect(e).toContain("No operational metrics for this branch");
    expect(e).toContain("No Callmaster client is mapped to this branch");
    expect(render(OpsQualityVisual, { operations: { status: "error", data: null, asOf: "x" } })).toContain("Operations could not be loaded.");
    expect(render(OpsQualityVisual, {})).toContain("Not available yet");
  });
});

describe("DataHealthChips", () => {
  it("over-mandate cost centres in an accent card with a count chip, worst first; none is an empty line", () => {
    const out = renderToStaticMarkup(<DataHealthChips section={{ status: "ok", asOf: "2026-10-15", data: {
      unmappedProcesses: 3, costCentresWithoutProcess: 7, staleProcesses: 2, overMandate: [{ costCentre: "CC-A", seats: 10, headcount: 11 }, { costCentre: "CC-OVER", seats: 10, headcount: 13 }],
    } }} />);
    for (const t of ["Cost centres over mandate", "2 over", "View as table", "CC-OVER 13 of 10 seats, Over by 3"]) expect(out).toContain(t);
    expect(out.indexOf("CC-OVER 13")).toBeLessThan(out.indexOf("CC-A 11"));
    const none = renderToStaticMarkup(<DataHealthChips section={{ status: "ok", asOf: "x", data: { unmappedProcesses: 0, costCentresWithoutProcess: 0, staleProcesses: 0, overMandate: [] } }} />);
    expect(none).toContain("No cost centre is over its mandated seats.");
    expect(none).toContain("0 over");
  });
  it("error and empty", () => {
    expect(renderToStaticMarkup(<DataHealthChips section={{ status: "error", data: null, asOf: "x" }} />)).toContain("Data health could not be loaded.");
    expect(renderToStaticMarkup(<DataHealthChips section={undefined} />)).toContain("Data health could not be loaded.");
    expect(renderToStaticMarkup(<DataHealthChips section={{ status: "empty", data: null, asOf: "x" }} />)).toContain("No data health information for these branches.");
  });
});
