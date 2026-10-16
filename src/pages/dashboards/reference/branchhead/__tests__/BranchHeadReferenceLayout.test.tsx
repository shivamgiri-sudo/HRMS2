import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BranchHeadHealthPayload, SectionResult } from "../../../../../../backend/src/modules/branch-head-health/types";
import type { BranchProcess } from "../../../../../../backend/src/modules/branch-head-health/processes";
import { BranchHeadReferenceLayout } from "../BranchHeadReferenceLayout";
import { DrilldownTable, defaultDrillBranch, drillMetricFor } from "../ProcessCoveragePanel";
import { BH_SECTIONS } from "../SectionNav";
import * as fx from "./fixtures";
import { branchHeadRoute } from "../../../../../config/routes/branchHeadRoute";

vi.mock("@/lib/hrmsApi", () => ({ hrmsApi: { get: vi.fn() } }));

const ok = (data: unknown): SectionResult<any> => ({ status: "ok", data, asOf: "2026-10-15" });
type Row = BranchHeadHealthPayload["branches"][number];
const proc = (o: Partial<BranchProcess>): BranchProcess => ({
  processId: "p1", processCode: "P1", processName: "Alpha", costCentres: ["CC1"], viaLink: false,
  mandatedSeats: 10, headcount: 8, tier: "full", latestMetricDate: "2026-10-14", billingMirror: false, branchIds: ["b1"], ...o,
});
const branch = (id: string, name: string, status: "healthy" | "watch" | "critical" | "no_data" = "healthy"): Row => ({
  branch: { branchId: id, branchCode: id, branchName: name },
  overview: {
    branch: { branchId: id, branchCode: id, branchName: name }, date: "2026-10-15", status,
    attention: [{ label: "Late arrivals", detail: "12 late today", severity: "warning" }],
    positives: [{ label: "Hiring on track", detail: "3 selected" }],
    people: fx.ok(fx.people), attendance: fx.ok(fx.attendance), hiring: fx.ok(fx.hiring),
    finance: fx.ok(fx.finance), leaderboard: ok([{ manager: "Secret Manager", late: 5, shrinkagePct: null }]),
    attrition: fx.ok(fx.attrition), backlogs: fx.ok(fx.backlogs), processPnl: fx.ok(fx.pnl(3)),
  },
  score: status === "no_data" ? null : { score: 82, pillars: [], excluded: [] },
});
const payload = (o: Partial<BranchHeadHealthPayload> = {}): BranchHeadHealthPayload => ({
  scope: { viaHomeFallback: false, orgWide: false, emptyReason: null },
  branches: [branch("b1", "Kolkata")],
  processes: { active: [proc({})], unmapped: [] },
  generatedAt: "2026-10-15T05:00:00Z", ...o,
});
const html = (data: BranchHeadHealthPayload) => renderToStaticMarkup(
  <QueryClientProvider client={new QueryClient()}><MemoryRouter><BranchHeadReferenceLayout data={data} /></MemoryRouter></QueryClientProvider>,
);

describe("BranchHeadReferenceLayout", () => {
  it("renders hero status and score", () => {
    const out = html(payload());
    expect(out).toContain("Kolkata");
    expect(out).toContain("Healthy");
    expect(out).toContain("82");
  });
  it("no_data shows a neutral No data chip, never Healthy", () => {
    const out = html(payload({ branches: [branch("b1", "Kolkata", "no_data")] }));
    expect(out).toContain("No data");
    expect(out).not.toContain("Healthy");
  });
  it("renders a section error inline while other sections render", () => {
    const b = branch("b1", "Kolkata");
    b.overview.finance = { status: "error", data: null, asOf: "2026-10-15", message: "P&L source timed out" };
    const out = html(payload({ branches: [b] }));
    expect(out).toContain("P&amp;L source timed out");
    expect(out).toContain("Finance");
    expect(out).toContain("Headcount");
    expect(out).toContain("Open positions");
    expect(out).toContain("Process P&amp;L - P&amp;L pages basis");
  });
  it("coverage badge text for each tier", () => {
    const tiers = ["full", "inbound_quality", "outbound_sale", "baseline", "not_wired"] as const;
    const out = html(payload({ processes: { active: tiers.map((t, i) => proc({ processId: `p${i}`, processName: `N${i}`, tier: t })), unmapped: [] } }));
    for (const t of ["Full", "Inbound + quality", "Outbound sale", "Baseline only", "Not wired"]) expect(out).toContain(t);
  });
  it("mirror and unmapped groups are collapsed by default", () => {
    const out = html(payload({ processes: {
      active: [proc({}), proc({ processId: "m", processName: "BSS_X", billingMirror: true })],
      unmapped: [proc({ processId: "u", processName: "Idle1" })],
    } }));
    expect(out).toContain("Billing mirrors (BSS_*)");
    expect(out).toContain("Not mapped to a cost centre");
    expect(out).toMatch(/<details(?![^>]*\bopen\b)[^>]*data-group="mirrors"/);
    expect(out).toMatch(/<details(?![^>]*\bopen\b)[^>]*data-group="unmapped"/);
  });
  it("switcher absent for one branch, present for two", () => {
    expect(html(payload())).not.toContain("All my branches");
    const two = html(payload({ branches: [branch("b1", "Kolkata"), branch("b2", "Delhi")] }));
    expect(two).toContain("All my branches");
    expect(two).toContain("Delhi");
  });
  it("shows no employee names before a process is opened, and none in the leaderboard", () => {
    const out = html(payload());
    expect(out).not.toContain("Secret Manager");
    expect(out).not.toContain("Asha Roy");
  });
  it("drill-down table shows names once rows are supplied", () => {
    const out = renderToStaticMarkup(<DrilldownTable rows={[{ employeeCode: "E1", name: "Asha Roy", value: 71.5, metric: "QA_QUALITY_PCT" }]} valueLabel="QA quality %" />);
    expect(out).toContain("Asha Roy");
    expect(out).toContain("71.5");
  });
  it("renders emptyReason as the empty state", () => {
    const out = html(payload({ scope: { viaHomeFallback: false, orgWide: false, emptyReason: "No MAS Call Net branch in your scope" }, branches: [], processes: { active: [], unmapped: [] } }));
    expect(out).toContain("No MAS Call Net branch in your scope");
  });
  it("shows the home-branch line and processes error notice", () => {
    const out = html(payload({ scope: { viaHomeFallback: true, orgWide: false, emptyReason: null }, processesError: true }));
    expect(out).toContain("Showing your home branch");
    expect(out).toContain("Process coverage could not be loaded");
  });
  it("flags seats over the mandate in text", () => {
    const out = html(payload({ processes: { active: [proc({ mandatedSeats: 5, headcount: 8 })], unmapped: [] } }));
    expect(out).toContain("Over mandate");
  });

  it("does not call a process over mandate when it has no mandated seats", () => {
    for (const seats of [0, null]) {
      const out = html(payload({ processes: { active: [proc({ mandatedSeats: seats, headcount: 51 })], unmapped: [] } }));
      expect(out).not.toContain("Over mandate");
      expect(out).toContain("51 headcount - no mandated seats");
      expect(out).not.toContain("of 0 seats");
    }
  });
  it("drill branch defaults to the selected branch if reachable, else the process's first branch", () => {
    const p2 = proc({ branchIds: ["b2", "b3"] });
    expect(defaultDrillBranch(p2, "b3")).toBe("b3");
    expect(defaultDrillBranch(p2, "")).toBe("b2");
    expect(defaultDrillBranch(p2, "b1")).toBe("b2");
    expect(defaultDrillBranch(proc({ branchIds: [] }), "b1")).toBe("");
  });
  it("drill metric per tier uses human labels; baseline and not_wired have none", () => {
    expect(drillMetricFor("full")?.label).toBe("QA quality %");
    expect(drillMetricFor("inbound_quality")?.key).toBe("QA_QUALITY_PCT");
    expect(drillMetricFor("outbound_sale")).toEqual({ key: "FUNNEL_SALE_PCT", label: "Sale conversion %" });
    expect(drillMetricFor("baseline")).toBeNull();
    expect(drillMetricFor("not_wired")).toBeNull();
  });
  it("drill-down table hides the value column without a metric label", () => {
    const out = renderToStaticMarkup(<DrilldownTable rows={[{ employeeCode: "E1", name: "Asha Roy", value: null, metric: "X" }]} valueLabel={null} />);
    expect(out).toContain("Asha Roy");
    expect(out).not.toContain("QA quality");
  });
  it("an empty hiring section shows the hiring empty state, not an empty list", () => {
    const b = branch("b1", "Kolkata");
    b.overview.hiring = fx.emptySection();
    expect(html(payload({ branches: [b] }))).toContain("No hiring data for this date");
  });
  it("hero shows the score band next to the score and keeps the status chip", () => {
    const out = html(payload());
    expect(out).toContain("Good");
    expect(out).toContain("Healthy");
    const poor = branch("b1", "Kolkata", "critical");
    poor.score = { score: 40, pillars: [], excluded: [] };
    expect(html(payload({ branches: [poor] }))).toContain("Poor");
  });
  it("renders the visual sections in nav order, then data health and process coverage", () => {
    const out = html(payload());
    const ids = ["bh-overview", "bh-people", "bh-attendance", "bh-attrition", "bh-finance", "bh-pnl", "bh-hiring", "bh-backlog", "bh-ops"];
    expect(BH_SECTIONS.map((s) => s.id)).toEqual(ids);
    const at = [...ids.map((id) => out.indexOf(`id="${id}"`)), out.indexOf(">Data health<"), out.indexOf(">Process coverage<")];
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    const titles = ["Attention and wins", ">Headcount<", "Attendance today", "Attrition and retention", "Running P&amp;L - month to date", "Process P&amp;L - P&amp;L pages basis", ">Hiring<", ">Backlogs<", "Operations and quality"];
    const start = out.indexOf("Attention and wins");
    const t = titles.map((x) => out.indexOf(x, start));
    expect(t.every((i) => i >= 0)).toBe(true);
    expect([...t].sort((a, b) => a - b)).toEqual(t);
  });
  it("branch-level output has no person names even if a payload carries them", () => {
    const b = branch("b1", "Kolkata");
    const leak = (o: object, k: string, v: string) => ({ ...o, [k]: v });
    b.overview.hiring = fx.ok({ ...fx.hiring, candidateName: "Zed Candidate", batches: fx.hiring.batches.map((x) => leak(x, "requester", "Qasim Requester")) }) as any;
    b.overview.people = fx.ok({ ...fx.people, joinedNames: ["Nita Joiner"], byProcess: fx.people.byProcess.map((x) => leak(x, "managerName", "Olga Manager")) }) as any;
    b.overview.attrition = fx.ok({ ...fx.attrition, topRisk: [{ name: "Paul Risky" }], byProcess: fx.attrition.byProcess.map((x) => leak(x, "name", "Rita Risky")) }) as any;
    b.overview.attendance = fx.ok({ ...fx.attendance, lateNames: ["Lata Late"], bySlot: fx.attendance.bySlot.map((x) => leak(x, "supervisor", "Sam Supervisor")) }) as any;
    b.overview.finance = fx.ok({ ...fx.finance, approverName: "Fay Approver", grn: { ...fx.finance.grn!, pendingByStage: fx.finance.grn!.pendingByStage.map((x) => leak(x, "approver", "Gus Approver")) } }) as any;
    b.overview.processPnl = fx.ok({ ...fx.pnl(3), rows: fx.pnl(3).rows.map((x) => leak(x, "ownerName", "Hal Owner")) }) as any;
    b.overview.backlogs = fx.ok({ ...fx.backlogs, regularization: leak(fx.backlogs.regularization, "oldestBy", "Ivy Oldest") }) as any;
    b.overview.operations = ok([{ processCode: "P1", processName: "Alpha Ops", tier: "full", metrics: { AHT: 300 }, latestDate: "2026-10-14", stale: false, agentName: "Jon Agent" }]);
    const out = html(payload({ branches: [b] }));
    for (const n of ["Secret Manager", "Zed Candidate", "Qasim Requester", "Nita Joiner", "Olga Manager", "Paul Risky", "Rita Risky", "Lata Late", "Sam Supervisor", "Fay Approver", "Gus Approver", "Hal Owner", "Ivy Oldest", "Jon Agent"]) expect(out).not.toContain(n);
  });
  it("missing optional sections render an honest placeholder", () => {
    const b = branch("b1", "Kolkata");
    delete b.overview.attrition; delete b.overview.backlogs; delete b.overview.processPnl;
    const out = html(payload({ branches: [b] }));
    // attrition, backlogs, process P&L and (absent in this fixture) operations and quality
    expect(out.split("Not available yet").length - 1).toBe(4);
  });
  it("route is omitted when the flag is off and present when on", () => {
    expect(branchHeadRoute(false, <div />)).toBeNull();
    expect(branchHeadRoute(true, <div />)?.props.path).toBe("/branch-head/dashboard");
  });

  it("renders data health counts and over-mandate table", () => {
    const out = html(payload({ dataHealth: { status: "ok", asOf: "2026-10-15", data: {
      unmappedProcesses: 3, costCentresWithoutProcess: 7, staleProcesses: 2,
      overMandate: [{ costCentre: "CC-OVER", seats: 10, headcount: 13 }],
    } } }));
    expect(out).toContain("Data health");
    expect(out).toContain("Cost centres without a process");
    expect(out).toContain("CC-OVER");
    expect(out).toContain("Over by");
  });
  it("data health error is shown inline", () => {
    const out = html(payload({ dataHealth: { status: "error", data: null, asOf: "2026-10-15" } }));
    expect(out).toContain("Data health could not be loaded.");
  });
  it("renders operations, quality and callmaster panels with stale badge, em dash, counts only and truncation notice", () => {
    const b = branch("b1", "Kolkata");
    b.overview.operations = ok([{ processCode: "P1", processName: "Alpha Ops", tier: "full", metrics: { AHT: 300, INBOUND_SL_PCT: null, QA_QUALITY_PCT: 71.5 }, latestDate: "2026-09-01", stale: true }]);
    b.overview.quality = ok([{ processCode: "P1", processName: "Alpha Q", tier: "full", QA_QUALITY_PCT: 71.5, latestDate: "2026-09-01", stale: true }]);
    b.overview.callmaster = ok({
      kpis: ok({
        inbound: { total: 100, avg_quality: 81.2, fatal_score: 3.5, avg_cx: 77, avg_compliance: 88 },
        outbound: { total: 40, conversion: 12.5, ob_quality: 70, happiness_index: "Medium" },
        active_agents: 9,
      }),
      qualityTrend: ok([{ period: "2026-10-01", quality: 80, calls: 3, fatal: 0, agent: "Zed Agent" }]),
      cx: ok({ params: { express_empathy: 90.5, call_identified_by_name: null, active_listening: 75 },
        definitions: [{ key: "express_empathy", label: "Empathy Expressed", column: "express_empathy" }, { key: "active_listening", label: "Active Listening", column: "active_listening" }] }),
      fatal: ok({ totalFatalCalls: 7, agentsWithFatals: 3, truncated: true }),
    });
    const out = html(payload({ branches: [b] }));
    for (const t of ["Alpha Ops", "Alpha Q", "Stale", "Sale conversion %", "Total fatal calls", "Agents with fatals", "Empathy Expressed", "90.5", "Active Listening", "Avg quality", "81.2", "Conversion", "12.5", "Inbound", "Outbound",
      "Showing the most recent 5,000 audit rows - counts are partial"]) expect(out).toContain(t);
    expect(out).not.toContain("Zed Agent");
  });
  it("shows empty states for operations and callmaster", () => {
    const b = branch("b1", "Kolkata");
    b.overview.operations = { status: "empty", data: null, asOf: "2026-10-15" };
    b.overview.callmaster = { status: "empty", data: null, asOf: "2026-10-15" };
    const out = html(payload({ branches: [b] }));
    expect(out).toContain("No operational metrics for this branch");
    expect(out).toContain("No Callmaster client is mapped to this branch");
  });

  it("hero shows the pillar breakdown and the renormalisation note as text", () => {
    const b = branch("b1", "Kolkata");
    b.score = { score: 82, pillars: [{ key: "attendance", weight: 25, score: 90 }, { key: "people", weight: 20, score: 70 }] as any, excluded: ["finance", "hiring"] };
    const out = html(payload({ branches: [b] }));
    expect(out).toContain("attendance");
    expect(out).toContain("90/100");
    expect(out).toContain("weight 25");
    expect(out).toContain("Not scored (no data): finance, hiring - remaining weights renormalised");
  });
  it("one branch: section nav plus an anchor wrapper for every section", () => {
    const out = html(payload());
    expect(out).toContain('aria-label="Page sections"');
    for (const id of ["bh-overview", "bh-people", "bh-attendance", "bh-attrition", "bh-finance", "bh-pnl", "bh-hiring", "bh-backlog", "bh-ops"]) {
      expect(out).toContain(`href="#${id}"`);
      expect(out.split(`id="${id}"`).length - 1).toBe(1);
    }
  });
  it("several branches: no section nav and no duplicate anchor ids", () => {
    const out = html(payload({ branches: [branch("b1", "Kolkata"), branch("b2", "Delhi")] }));
    expect(out).not.toContain('aria-label="Page sections"');
    expect(out).not.toContain('id="bh-people"');
  });
  it("new top area: score ring, 8 KPI tiles and the attention board", () => {
    const out = html(payload());
    expect(out).toContain("Health score: 82 out of 100, Good");
    const strip = out.slice(out.indexOf('aria-label="Key numbers"'), out.indexOf("</ul>", out.indexOf('aria-label="Key numbers"')));
    expect(strip.split('class="bh-viz bh-tile"').length - 1).toBe(8);
    expect(out).toContain(">Late arrivals<");
    expect(out).toMatch(/<details(?![^>]*\bopen\b)[^>]*data-group="wins"/);
    expect(out).toContain("Hiring on track");
  });
  it("hero omits the not-scored line when nothing is excluded", () => {
    const b = branch("b1", "Kolkata");
    b.score = { score: 82, pillars: [{ key: "attendance", weight: 25, score: 90 }] as any, excluded: [] };
    expect(html(payload({ branches: [b] }))).not.toContain("Not scored");
  });
});
