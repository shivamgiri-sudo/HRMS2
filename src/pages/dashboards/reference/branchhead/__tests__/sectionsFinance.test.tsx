import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { BranchOverview, ProcessPnlData } from "../../../../../../backend/src/modules/branch-head-health/types";
import type { DrillTarget } from "../drill";
import { FinanceVisual, buildFinance } from "../sections/FinanceVisual";
import { ProcessPnlVisual, buildPnl, pnlSelect } from "../sections/ProcessPnlVisual";
import { formatInr } from "../format";
import * as fx from "./fixtures";

const render = (C: typeof FinanceVisual, o: Partial<BranchOverview> = {}) => {
  const ov = fx.overviewOf(o);
  return renderToStaticMarkup(<C overview={ov} payload={fx.payloadOf(ov)} onSelect={() => {}} />);
};
const flat = (t: { rows: Array<Array<string | number | null>> }) => t.rows.map((r) => r.join("|")).join("\n");

const fin = (sub: string, o: Partial<BranchOverview> = {}) => {
  const ov = fx.overviewOf(o);
  return renderToStaticMarkup(<FinanceVisual overview={ov} payload={fx.payloadOf(ov)} onSelect={() => {}} sub={sub} />);
};

describe("FinanceVisual", () => {
  const pnlOut = fin("pnl");
  const budgetOut = fin("budget");
  const grnOut = fin("grn");
  it("four sub-tabs for email sections 1, 2, 3 and 9; budget is the default", () => {
    for (const t of ["Budget vs consumption", "GRN summary", "Recent GRNs", "Running P&amp;L"]) expect(budgetOut).toContain(t);
    expect(budgetOut.split('aria-pressed="true"').length - 1).toBe(1);
    expect(render(FinanceVisual)).toContain("Total budget");
  });
  it("waterfall from revenue through salary and GRN to operating profit", () => {
    const b = buildFinance(fx.finance);
    expect(b.waterfall.steps.map((s) => [s.label, s.kind])).toEqual([
      ["Revenue", "total"], ["Salary", "delta"], ["GRN consumed", "delta"], ["GRN reserved", "delta"], ["Operating profit", "total"],
    ]);
    expect(b.waterfall.steps.slice(1, 4).every((s) => s.value <= 0)).toBe(true);
    expect(flat(b.waterfallTable)).toContain(`Operating profit|Total|${formatInr(816216.8)}`);
    for (const t of ["Revenue to operating profit", "Live, month to date", "day 15 of 31", "13.6%"]) expect(pnlOut).toContain(t);
  });
  it("budget tiles, heads with % used bars and over-budget text, history and open sub-heads", () => {
    const b = buildFinance(fx.finance);
    expect(b.meter.value).toBe(1250000);
    expect(b.meter.limit).toBe(2000000);
    expect(b.heads.items.map((i) => i.label)).toEqual(["Rent", "Utilities"]);
    expect(flat(b.headsTable)).toContain("Utilities|₹2.6 L|₹2 L|Over budget, 130.0% used");
    expect(b.stages?.items[0]).toMatchObject({ label: "Branch Head", value: 3 });
    expect(flat(b.stagesTable!)).toContain("Branch Head|3|oldest 6 days, ₹3 L");
    for (const t of ["Total budget", "Consumed", "Reserved", "Available", "₹7.5 L", "Utilization", "62.5%", "Over budget", "130.0%",
      "Budget history and after closure", "Still-open sub-heads", "Office", "₹20,000"]) expect(budgetOut).toContain(t);
  });
  it("GRN summary: tiles, stage chart, types and the bridge to the budget", () => {
    for (const t of ["GRNs raised this month", "Approved", "Pending", "Unbudgeted", "Open GRNs by approval stage", "Branch Head (GRNs waiting 3",
      "GRNs by type", "Vendor GRN", "Bridge: GRNs raised to budget charged", "charged to this month&#x27;s budget", "₹7.2 L"]) expect(grnOut).toContain(t);
  });
  it("recent GRNs table as the email lists them", () => {
    const o = fin("recent");
    for (const t of ["Recent GRNs (latest 15, excluding drafts)", "GRN-2210-0042", "Sai Facility Services", "Housekeeping", "Consumables", "₹18,500", "Submitted", "2026-10-14"]) expect(o).toContain(t);
  });
  it("projection with the basis footnote; hidden without P&L data", () => {
    expect(pnlOut).toContain("Projection basis: linear on days elapsed");
    expect(pnlOut).toContain(formatInr(12433000));
    const o = fin("pnl", { finance: fx.ok({ ...fx.finance, pnl: { ...fx.finance.pnl, dataAvailable: false } }) });
    expect(o).toContain("No P&amp;L data yet for this month");
    expect(o).not.toContain("linear on days elapsed");
  });
  it("components, tie-out and payroll readiness sit with the running P&L", () => {
    for (const t of ["Invoice", "Accrual", "Credit notes", "Salary (110 staff paid)", "Tie-out between budget and P&amp;L", "Imprest reserved with no cost centre", "Pending regularization", "Oldest 3 days"]) expect(pnlOut).toContain(t);
  });
  it("mode labels, missing budget note and error", () => {
    const o = (m: string) => fin("pnl", { finance: fx.ok({ ...fx.finance, pnl: { ...fx.finance.pnl, mode: m } }) });
    expect(o("FINAL")).toContain("Final, month closed");
    expect(o("SOME_MODE")).toContain("some mode");
    const nb = fin("budget", { finance: fx.ok({ ...fx.finance, budget: { ...fx.finance.budget, headerMissing: true, totalBudget: 0 } }) });
    expect(nb).toContain("No budget has been created for this month.");
    expect(render(FinanceVisual, { finance: fx.err("P&L source timed out") })).toContain("P&amp;L source timed out");
    expect(render(FinanceVisual, { finance: fx.err("x") })).toContain("Finance could not be loaded.");
  });
  it("zero revenue never renders NaN; no GRN data says so", () => {
    const z = { ...fx.finance, grn: null, tieOut: null, payrollReadiness: null, byHead: { top: [], overBudget: [] }, recentGrns: [], history: [], openSubheads: [],
      pnl: { ...fx.finance.pnl, revenueRunning: 0, salaryRunning: 0, grnConsumed: 0, grnReserved: 0, operatingProfit: 0, opPct: null } };
    for (const sub of ["budget", "grn", "recent", "pnl"]) expect(fin(sub, { finance: fx.ok(z) })).not.toContain("NaN");
    expect(fin("pnl", { finance: fx.ok(z) })).not.toContain("Tie-out between");
    expect(fin("grn", { finance: fx.ok(z) })).toContain("No GRN data for this month");
    expect(fin("recent", { finance: fx.ok(z) })).toContain("No GRNs raised yet");
    expect(fin("budget", { finance: fx.ok(z) })).toContain("No earlier budget months");
  });
});

describe("ProcessPnlVisual", () => {
  it("diverging bars worst first with Profit / Loss legend, header chips and totals tiles", () => {
    const d = fx.pnl(5);
    d.rows.reverse();
    const out = render(ProcessPnlVisual as never, { processPnl: fx.ok(d) });
    expect(out).toContain("Process P&amp;L - P&amp;L pages basis, 2026-10");
    expect(out.indexOf("Process 0")).toBeLessThan(out.indexOf("Process 4"));
    for (const t of [">Profit<", ">Loss<", "2 loss-making", "2 at risk", "1 profitable", "Uses the same calculation as the Process P&amp;L pages, so it can differ from the month-to-date running figures above."]) expect(out).toContain(t);
    for (const t of ["Revenue", "People cost", "Other cost", "Operating profit", "OP %", formatInr(1000000), "11.1%"]) expect(out).toContain(t);
  });
  it("totals tiles sum people and other cost across active rows", () => {
    const d = fx.pnl(12);
    const people = d.rows.reduce((a, x) => a + x.peopleCost, 0);
    const other = d.rows.reduce((a, x) => a + x.otherCost, 0);
    const b = buildPnl(d);
    expect(b.totals.people).toBe(people);
    expect(b.totals.other).toBe(other);
    const last = b.table.rows[b.table.rows.length - 1];
    expect(last[0]).toBe("Total (12 processes)");
    expect(last).toContain(formatInr(people));
    expect(last).toContain(formatInr(other));
    expect(last).toContain(formatInr(d.totals.operatingProfit));
  });
  it("table twin has every active row with status text, client and receivable", () => {
    const b = buildPnl(fx.pnl(3));
    expect(b.table.columns.slice(0, 3)).toEqual(["Item", "Value", "Side"]);
    expect(flat(b.table)).toContain("Process 0|-₹50,000|Loss|Client 0|Loss-making");
    expect(flat(b.table)).toContain("₹12,345");
  });
  it("more than 8 processes: first 8 drawn, rest in a collapsed Show all", () => {
    const out = render(ProcessPnlVisual as never, { processPnl: fx.ok(fx.pnl(12)) });
    expect(out).toContain("Show all 12 processes");
    expect(out).toMatch(/<details(?![^>]*\bopen\b)/);
  });
  it("zero-activity rows are folded and left out of the chart", () => {
    const d: ProcessPnlData = fx.pnl(3);
    d.rows.push({ ...d.rows[0], processId: "z1", processName: "BSS_IDLE_ONE", revenue: 0, peopleCost: 0, otherCost: 0, operatingProfit: 0, opPct: null });
    const b = buildPnl(d);
    expect(b.bars.items.map((i) => i.label)).not.toContain("BSS_IDLE_ONE");
    const out = render(ProcessPnlVisual as never, { processPnl: fx.ok(d) });
    expect(out).toContain("1 process has no P&amp;L activity this month");
    expect(out).toMatch(/<details(?![^>]*\bopen\b)[^>]*>\s*<summary[^>]*><span>1 process has no/);
  });
  it("click joins by process name, else opens the P&L row itself as a process", () => {
    const seen: DrillTarget[] = [];
    const rows = fx.payloadOf().processes.active;
    pnlSelect({ processId: "zz", processName: "process 1" }, rows, (t) => seen.push(t));
    pnlSelect({ processId: "zz", processName: "Unknown" }, rows, (t) => seen.push(t));
    pnlSelect({ processId: "p-beta", processName: "Renamed" }, rows, (t) => seen.push(t));
    expect(seen).toEqual([{ kind: "process", id: "p1", name: "process 1" }, { kind: "process", id: "zz", name: "Unknown" }, { kind: "process", id: "p-beta", name: "Beta  Chat " }]);
    pnlSelect({ processId: "zz", processName: "Unknown" }, rows, (t) => seen.push(t), "b1");
    expect(seen[3]).toEqual({ kind: "process", id: "zz", name: "Unknown", branchId: "b1" });
  });
  it("empty, error, missing and null OP %", () => {
    expect(render(ProcessPnlVisual as never, { processPnl: fx.emptySection() })).toContain("No process P&amp;L for this branch");
    expect(render(ProcessPnlVisual as never, { processPnl: fx.err("P&L could not be loaded") })).toContain('role="alert"');
    expect(render(ProcessPnlVisual as never, { processPnl: undefined })).toContain("Not available yet");
    const d = fx.pnl(1); d.rows[0].opPct = null; d.totals.opPct = null;
    expect(render(ProcessPnlVisual as never, { processPnl: fx.ok(d) })).toContain("—");
  });
});
