import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BranchHeadHealthPayload } from "../../../../../../backend/src/modules/branch-head-health/types";
import type { BranchProcess } from "../../../../../../backend/src/modules/branch-head-health/processes";
import { BranchHeadReferenceLayout } from "../BranchHeadReferenceLayout";
import { DrilldownTable } from "../ProcessCoveragePanel";

vi.mock("@/lib/hrmsApi", () => ({ hrmsApi: { get: vi.fn() } }));

const ok = (data: unknown) => ({ status: "ok" as const, data, asOf: "2026-10-15" });
const proc = (o: Partial<BranchProcess>): BranchProcess => ({
  processId: "p1", processCode: "P1", processName: "Alpha", costCentres: ["CC1"], viaLink: false,
  mandatedSeats: 10, headcount: 8, tier: "full", latestMetricDate: "2026-10-14", billingMirror: false, ...o,
});
const branch = (id: string, name: string, status: "healthy" | "watch" | "critical" | "no_data" = "healthy") => ({
  branch: { branchId: id, branchCode: id, branchName: name },
  overview: {
    branch: { branchId: id, branchCode: id, branchName: name }, date: "2026-10-15", status,
    attention: [{ label: "Late arrivals", detail: "12 late today", severity: "warning" as const }],
    positives: [{ label: "Hiring on track", detail: "3 selected" }],
    people: ok({ totalActive: 120 }), attendance: ok({ present: 90 }), hiring: ok({ openPositions: 4 }),
    finance: ok({ opPct: 12 }), leaderboard: ok([{ manager: "Secret Manager", late: 5, shrinkagePct: null }]),
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
    expect(out).toContain("Total Active");
    expect(out).toContain("Open Positions");
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
    const out = renderToStaticMarkup(<DrilldownTable rows={[{ employeeCode: "E1", name: "Asha Roy", value: 71.5, metric: "QA_QUALITY_PCT" }]} />);
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
});
