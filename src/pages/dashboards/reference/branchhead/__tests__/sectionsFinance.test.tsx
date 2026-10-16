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

describe("FinanceVisual", () => {
  const out = render(FinanceVisual);
  it("waterfall from revenue through salary and GRN to operating profit", () => {
    const b = buildFinance(fx.finance);
    expect(b.waterfall.steps.map((s) => [s.label, s.kind])).toEqual([
      ["Revenue", "total"], ["Salary", "delta"], ["GRN consumed", "delta"], ["GRN reserved", "delta"], ["Operating profit", "total"],
    ]);
    expect(b.waterfall.steps.slice(1, 4).every((s) => s.value <= 0)).toBe(true);
    expect(flat(b.waterfallTable)).toContain(`Operating profit|Total|${formatInr(816216.8)}`);
    for (const t of ["Running P&amp;L - month to date (as in the emailed report)", "Live, month to date", "day 15 of 31", "13.6%"]) expect(out).toContain(t);
  });
  it("budget meter, heads with marker and over-budget text, GRN stages", () => {
    const b = buildFinance(fx.finance);
    expect(b.meter.value).toBe(1250000);
    expect(b.meter.limit).toBe(2000000);
    expect(b.heads.items.map((i) => i.label)).toEqual(["Rent", "Utilities"]);
    expect(flat(b.headsTable)).toContain("Utilities|₹2.6 L|₹2 L|Over budget, 130.0% used");
    expect(b.stages?.items[0]).toMatchObject({ label: "Branch Head", value: 3 });
    expect(flat(b.stagesTable!)).toContain("Branch Head|3|oldest 6 days, ₹3 L");
    for (const t of ["Budget used", "Over budget", "Open GRNs by approval stage", "Available ₹7.5 L"]) expect(out).toContain(t);
  });
  it("projection tiles with the basis footnote; hidden without P&L data", () => {
    expect(out).toContain("Projection basis: linear on days elapsed");
    expect(out).toContain(formatInr(12433000));
    const o = render(FinanceVisual, { finance: fx.ok({ ...fx.finance, pnl: { ...fx.finance.pnl, dataAvailable: false } }) });
    expect(o).toContain("No P&amp;L data yet for this month");
    expect(o).not.toContain("linear on days elapsed");
  });
  it("components, GRN types, tie-out and payroll readiness stay reachable in soft disclosure rows", () => {
    for (const t of ["Invoice", "Accrual", "Credit notes", "Salary (110 staff paid)", "Vendor GRN", "Unbudgeted", "Reconciliation and payroll readiness", "Imprest reserved with no cost centre", "Pending regularization", "Oldest 3 days"]) expect(out).toContain(t);
    expect(out).toMatch(/<details[^>]*\bopen\b[^>]*>\s*<summary[^>]*><span>Reconciliation and payroll readiness/);
  });
  it("mode labels, missing budget note and error", () => {
    const o = (m: string) => render(FinanceVisual, { finance: fx.ok({ ...fx.finance, pnl: { ...fx.finance.pnl, mode: m } }) });
    expect(o("FINAL")).toContain("Final, month closed");
    expect(o("SOME_MODE")).toContain("some mode");
    const nb = render(FinanceVisual, { finance: fx.ok({ ...fx.finance, budget: { ...fx.finance.budget, headerMissing: true, totalBudget: 0 } }) });
    expect(nb).toContain("No budget has been created for this month.");
    expect(render(FinanceVisual, { finance: fx.err("P&L source timed out") })).toContain("P&amp;L source timed out");
    expect(render(FinanceVisual, { finance: fx.err("x") })).toContain("Finance could not be loaded.");
  });
  it("zero revenue never renders NaN", () => {
    const z = { ...fx.finance, grn: null, tieOut: null, payrollReadiness: null, byHead: { top: [], overBudget: [] },
      pnl: { ...fx.finance.pnl, revenueRunning: 0, salaryRunning: 0, grnConsumed: 0, grnReserved: 0, operatingProfit: 0, opPct: null } };
    const o = render(FinanceVisual, { finance: fx.ok(z) });
    expect(o).not.toContain("NaN");
    expect(o).not.toContain("Reconciliation and payroll readiness");
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
