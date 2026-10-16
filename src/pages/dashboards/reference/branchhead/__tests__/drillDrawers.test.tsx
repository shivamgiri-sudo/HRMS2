import { describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BranchHeadHealthPayload, BranchOverview } from "../../../../../../backend/src/modules/branch-head-health/types";
import type { DrillTarget, MetricDrillId } from "../drill";
import { ProcessDrawer } from "../drill/ProcessDrawer";
import { MetricDrawer, METRIC_TITLES } from "../drill/MetricDrawer";
import { PnlTable } from "../drill/metrics/PnlMetric";
import { DrillHost, type DrillHostApi } from "../drill/DrillHost";
import { EMPTY_DRILL, pushDrill } from "../drill/history";
import { drillHandlers } from "../BranchHeadReferenceLayout";
import * as fx from "./fixtures";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const esc = (t: string) => t.split("&").join("&amp;");

vi.mock("@/lib/hrmsApi", () => ({ hrmsApi: { get: vi.fn() } }));

const wrap = (el: ReactElement) => renderToStaticMarkup(
  <QueryClientProvider client={new QueryClient()}><MemoryRouter>{el}</MemoryRouter></QueryClientProvider>,
);
const ops = [{ processCode: "ALPHA", processName: "Alpha Voice", tier: "full", metrics: { AHT: 300, QA_QUALITY_PCT: 82.5 }, latestDate: "2026-10-14", stale: false }];
const quality = [{ processCode: "ALPHA", processName: "Alpha Voice", tier: "full", QA_QUALITY_PCT: 82.5, latestDate: "2026-10-14", stale: false }];
const richOverview = (): BranchOverview => {
  const pnl = fx.pnl(3);
  pnl.rows.push({ ...pnl.rows[2], processId: "p-alpha", processName: "Alpha Voice", revenue: 900000, peopleCost: 400000, otherCost: 100000, operatingProfit: 400000, opPct: 44.4, status: "profitable" });
  return fx.overviewOf({ processPnl: fx.ok(pnl), operations: fx.ok(ops) as never, quality: fx.ok(quality) as never });
};
const alpha = { kind: "process", id: "p-alpha", name: "Alpha Voice", branchId: "b1" } as const;
const proc = (ov: BranchOverview, payload: BranchHeadHealthPayload, target: Extract<DrillTarget, { kind: "process" }> = alpha) =>
  wrap(<ProcessDrawer payload={payload} overview={ov} target={target} branchNames={{ b1: "Kolkata" }} />);

describe("ProcessDrawer", () => {
  it("renders the header, tiles, mini charts, batches and links from the payload", () => {
    const ov = richOverview();
    const out = proc(ov, fx.payloadOf(ov));
    for (const t of ["Full", "1 cost centre", "Headcount vs seats", "60 / 50", "Over by 10", "Revenue", "₹9 L", "Operating profit", "₹4 L", "OP % 44.4%",
      "Shrinkage today", "10.0%", "5 absent of 50 planned", "Attrition high risk", "Absent streak 2", "QA %", "82.5%",
      "Attendance by shift slot", "09:00-18:00", "P&amp;L this month", "People cost", "Open hiring batches", "Telecaller", "Operations metrics", "AHT",
      "Agents", "Show agent list", 'href="/finance/process-pnl"', 'href="/wfm/roster-command-center"', 'href="/process-operations"']) expect(out, t).toContain(t);
    expect(out).not.toContain("NaN");
  });
  it("a process with no data shows each section's honest empty line", () => {
    const ov = fx.overviewOf();
    const payload = fx.payloadOf(ov, { processes: { active: [fx.procRow({ processId: "p-z", processName: "Zeta Empty", mandatedSeats: 0, headcount: 4 })], unmapped: [] } });
    const out = proc(ov, payload, { kind: "process", id: "p-z", name: "Zeta Empty", branchId: "b1" });
    for (const t of ["No mandate", "No P&amp;L activity this month", "No attendance rostered today", "No open hiring batches for this process", "No operational metrics for this process"]) expect(out, t).toContain(t);
    expect(out).not.toContain("Over by");
    expect(out).not.toContain("NaN");
  });
  it("an unknown process shows an honest no-detail state", () => {
    const ov = fx.overviewOf();
    const out = proc(ov, fx.payloadOf(ov), { kind: "process", id: "nope", name: "Ghost", branchId: "b1" });
    expect(out).toContain("No detail available for this process");
  });
  it("notes a billing mirror", () => {
    const ov = fx.overviewOf();
    const payload = fx.payloadOf(ov, { processes: { active: [fx.procRow({ billingMirror: true })], unmapped: [] } });
    expect(proc(ov, payload)).toContain("Billing mirror");
  });
  it("shows no person names from planted payload fields; names only via the agent list", () => {
    const ov = richOverview();
    const leak = <T extends object>(o: T, k: string, v: string) => ({ ...o, [k]: v });
    ov.attendance = fx.ok({ ...fx.attendance, bySlot: fx.attendance.bySlot.map((x) => leak(x, "supervisor", "Sam Supervisor")) });
    ov.hiring = fx.ok({ ...fx.hiring, batches: fx.hiring.batches.map((x) => leak(x, "requester", "Qasim Requester")) });
    ov.attrition = fx.ok({ ...fx.attrition, byProcess: fx.attrition.byProcess.map((x) => leak(x, "name", "Rita Risky")) });
    const out = proc(ov, fx.payloadOf(ov));
    for (const n of ["Sam Supervisor", "Qasim Requester", "Rita Risky", "Secret Manager"]) expect(out).not.toContain(n);
    expect(out).toContain("Show agent list");
  });
});

const ALL: MetricDrillId[] = ["shrinkage", "late", "headcount", "attrition", "profit", "budget", "grn", "openings", "attendance", "finance", "pnl", "hiring", "backlog", "ops"];
const EXPECT: Record<MetricDrillId, string[]> = {
  shrinkage: ["Attendance by process", "Attendance by process and shift slot", "Trend appears after a few days of history"],
  late: ["Late arrivals by process", "Attendance by process and shift slot"],
  attendance: ["Attendance by process", "Attendance by process and shift slot"],
  headcount: ["Headcount versus mandate by process", "Joined MTD", "Upcoming exits (30 days)"],
  attrition: ["Employees by attrition risk tier", "High attrition risk by process", "Exits per month"],
  profit: ["Running P&amp;L, revenue to operating profit", "Budget heads: charged against budget", "Open GRNs by approval stage"],
  finance: ["Running P&amp;L, revenue to operating profit"],
  budget: ["Budget heads: charged against budget", "Budget used"],
  grn: ["Open GRNs by approval stage", "GRNs by type"],
  pnl: ["Process P&amp;L, all processes", "aria-sort"],
  hiring: ["Open positions by batch", "Offer conversion by window", "Interview tokens by outcome"],
  openings: ["Open positions by batch"],
  backlog: ["Pending requests by age", "Regularization", "Leave"],
  ops: ["Latest operational metrics per process", "Alpha Voice", "Callmaster"],
};

describe("MetricDrawer", () => {
  const ov = richOverview();
  ov.callmaster = fx.emptySection();
  const render = (id: MetricDrillId, trends: Record<string, Array<number | null>> = {}) =>
    wrap(<MetricDrawer id={id} overview={ov} payload={fx.payloadOf(ov)} trends={trends} onOpen={() => {}} />);
  it.each(ALL)("%s renders its tables and a deep-link row", (id) => {
    const out = render(id);
    expect(METRIC_TITLES[id]).toBeTruthy();
    for (const t of EXPECT[id]) expect(out, `${id}: ${t}`).toContain(t);
    expect(out).toContain('aria-label="Related pages"');
    expect(out).not.toContain("NaN");
    expect(out).not.toContain("Secret Manager");
  });
  it("draws the trend once there are 3 points", () => {
    expect(render("shrinkage", { shrinkagePct: [10, 12, 11] })).not.toContain("Trend appears after a few days of history");
    expect(render("late", { totalLate: [3, 4] })).toContain("Trend appears after a few days of history");
  });
  it("an errored section says so instead of rendering an empty drawer", () => {
    const bad = fx.overviewOf({ finance: fx.err("down") });
    const out = wrap(<MetricDrawer id="budget" overview={bad} payload={fx.payloadOf(bad)} trends={{}} onOpen={() => {}} />);
    expect(out).toContain("could not be loaded");
  });
  it("pnl table: sort buttons in headers with aria-sort, process rows are buttons", () => {
    const out = wrap(<PnlTable rows={fx.pnlRows(3)} onPick={() => {}} />);
    expect(out).toContain('aria-sort="ascending"');
    expect(out.split('aria-sort="none"').length - 1).toBe(5);
    expect(out).toMatch(/<th[^>]*aria-sort="ascending"[^>]*><button/);
    expect(out).toContain(">Process 0</button>");
  });
});

describe("DrillHost", () => {
  const host = (state = EMPTY_DRILL): DrillHostApi => ({ state, open: () => {}, back: () => {}, close: () => {} });
  const render = (h: DrillHostApi) => {
    const ov = richOverview();
    return wrap(<DrillHost host={h} data={fx.payloadOf(ov)} branchNames={{ b1: "Kolkata" }} inline />);
  };
  it("renders nothing while closed", () => {
    expect(render(host())).not.toContain("bh-drawer");
  });
  it("opens a metric drawer and a process drawer with a back button after a swap", () => {
    const s1 = pushDrill(EMPTY_DRILL, { target: { kind: "metric", id: "pnl" }, branchId: "b1" });
    const out1 = render(host(s1));
    expect(out1).toContain(esc(METRIC_TITLES.pnl));
    expect(out1).not.toContain(">Back");
    const s2 = pushDrill(s1, { target: alpha, branchId: "b1" });
    const out2 = render(host(s2));
    expect(out2).toContain("Alpha Voice");
    expect(out2).toContain(`Back to ${esc(METRIC_TITLES.pnl)}`);
    expect(out2).toContain("Close Alpha Voice");
  });
  it("closes when the payload no longer has the process", () => {
    const s = pushDrill(EMPTY_DRILL, { target: { kind: "process", id: "gone", name: "Gone", branchId: "b1" }, branchId: "b1" });
    expect(render(host(s))).not.toContain("bh-drawer");
  });
});

describe("layout drill wiring", () => {
  it("section clicks and KPI tiles open the host with the overview's branch", () => {
    const calls: Array<[DrillTarget, string]> = [];
    const h = drillHandlers((t, b) => calls.push([t, b]), "b2");
    h.onSelect({ kind: "metric", id: "pnl" });
    h.onOpenKpi("grn");
    h.onSelect({ kind: "process", id: "x", name: "X" });
    const src = readFileSync(resolve(__dirname, "../BranchHeadReferenceLayout.tsx"), "utf8");
    expect(src).not.toContain("NOOP");
    expect(src).toContain("onSelect={onSelect}");
    expect(src).toContain("onOpenKpi={onOpenKpi}");
    expect(calls).toEqual([
      [{ kind: "metric", id: "pnl" }, "b2"],
      [{ kind: "metric", id: "grn" }, "b2"],
      [{ kind: "process", id: "x", name: "X" }, "b2"],
    ]);
  });
});
