import { describe, expect, it } from "vitest";
import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { BranchOverview } from "../../../../../../backend/src/modules/branch-head-health/types";
import type { DrillTarget } from "../drill";
import { BarList, StackedBar, divergingLayout } from "../viz";
import { NavyTable } from "../look";
import { PeopleVisual } from "../sections/PeopleVisual";
import { AttendanceVisual } from "../sections/AttendanceVisual";
import { FinanceVisual, buildFinance } from "../sections/FinanceVisual";
import { ProcessPnlVisual, buildPnl } from "../sections/ProcessPnlVisual";
import { OpsQualityVisual, qualityBars } from "../sections/OpsQualityVisual";
import { HiringVisual } from "../sections/HiringVisual";
import { selectByName, type VisualProps } from "../sections/shared";
import { barListTable } from "../viz";
import * as fx from "./fixtures";

type Visual = (p: VisualProps) => ReactElement | null;

/** Expand the visual (and its SectionShell render prop) into a plain element tree, without a DOM. */
function expand(node: ReactNode): ReactNode {
  if (Array.isArray(node)) return node.map(expand);
  if (!isValidElement(node)) return node;
  const el = node as ReactElement<{ children?: unknown; section?: { data: unknown } }>;
  const kids = el.props.children;
  if (typeof kids === "function") return expand((kids as (d: unknown) => ReactNode)(el.props.section?.data));
  if (typeof el.type === "function" && el.type !== BarList && el.type !== StackedBar && !String(el.type.name).startsWith("Chart")) {
    try { return expand((el.type as (p: unknown) => ReactNode)(el.props)); } catch { /* hook-using component: keep its children */ }
  }
  return cloneElement(el, { children: expand(kids as ReactNode) } as never);
}
function findAll(node: ReactNode, type: unknown, acc: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) node.forEach((n) => findAll(n, type, acc));
  else if (isValidElement(node)) {
    if (node.type === type) acc.push(node);
    findAll((node.props as { children?: ReactNode }).children, type, acc);
  }
  return acc;
}
/** Click the first row of the first clickable navy table in the visual (tables carry the process drill-down). */
function clickFirstRow(V: Visual, type: unknown, ov: BranchOverview, payload = fx.payloadOf(ov)) {
  const seen: DrillTarget[] = [];
  const tree = expand(V({ overview: ov, payload, onSelect: (t) => seen.push(t) }));
  const table = findAll(tree, type).find((e) => typeof (e.props as { onRowClick?: unknown }).onRowClick === "function")!;
  const p = table.props as { onRowClick: (row: unknown, i: number) => void; rows: unknown[] };
  p.onRowClick(p.rows[0], 0);
  return seen;
}

const twoBranches = () => {
  const ov = fx.overviewOf();
  return fx.payloadOf(ov, { processes: { active: [
    fx.procRow({ processId: "other-branch", processName: "Alpha Voice", branchIds: ["b2"] }),
    fx.procRow({ processId: "this-branch", processName: "alpha voice", branchIds: ["b1"] }),
  ], unmapped: [] } });
};

describe("branch-aware selection", () => {
  it("a duplicate process name in two branches resolves to this branch's processId", () => {
    const ov = fx.overviewOf();
    const seen: DrillTarget[] = [];
    selectByName({ overview: ov, payload: twoBranches(), onSelect: (t) => seen.push(t) }, "headcount")("Alpha Voice");
    expect(seen).toEqual([{ kind: "process", id: "this-branch", name: "alpha voice", branchId: "b1" }]);
    const other = { ...ov, branch: { ...ov.branch, branchId: "b9" } };
    selectByName({ overview: other, payload: twoBranches(), onSelect: (t) => seen.push(t) }, "headcount")("Alpha Voice");
    expect(seen[1]).toEqual({ kind: "metric", id: "headcount" });
  });
  it("people: clicking the first headcount row opens this branch's process", () => {
    const ov = fx.overviewOf();
    expect(clickFirstRow(PeopleVisual as Visual, NavyTable, ov, twoBranches())).toEqual([{ kind: "process", id: "this-branch", name: "alpha voice", branchId: "b1" }]);
  });
  it("attendance: clicking the first by-process row opens this branch's process", () => {
    const ov = fx.overviewOf();
    expect(clickFirstRow(AttendanceVisual as Visual, NavyTable, ov, twoBranches())).toEqual([{ kind: "process", id: "this-branch", name: "alpha voice", branchId: "b1" }]);
  });
  it("rows are keyed by index, so duplicate names cannot collide", () => {
    const d = { ...fx.people, byProcess: [fx.people.byProcess[0], fx.people.byProcess[0]] };
    const out = renderToStaticMarkup(<PeopleVisual overview={fx.overviewOf({ people: fx.ok(d) })} payload={fx.payloadOf()} onSelect={() => {}} />);
    expect(out.split('aria-label="Open Alpha Voice"').length - 1).toBe(2);
  });
});

describe("P&L shared scale", () => {
  const withOps = (ops: number[]) => {
    const d = fx.pnl(ops.length);
    d.rows.forEach((r, i) => { r.operatingProfit = ops[i]; });
    return buildPnl(d);
  };
  it("mixed signs across the 8-row boundary: same zero, a smaller profit draws shorter than a larger loss", () => {
    const b = withOps([-100, -90, -80, -70, -60, -50, -40, -30, 20, 10]);
    const first = divergingLayout(b.bars.items.slice(0, 8), b.domain);
    const rest = divergingLayout(b.bars.items.slice(8), b.domain);
    expect(first.zeroPct).toBe(50);
    expect(rest.zeroPct).toBe(50);
    expect(rest.rows[1].widthPct).toBeLessThan(first.rows[0].widthPct);
    expect(rest.rows[1].widthPct).toBe(10);
    expect(divergingLayout(b.bars.items.slice(8)).rows[1].widthPct).toBe(100);
  });
  it("40 processes and all negative", () => {
    const many = withOps(Array.from({ length: 40 }, (_, i) => (i - 20) * 1000));
    const out = renderToStaticMarkup(<ProcessPnlVisual overview={fx.overviewOf({ processPnl: fx.ok({ ...fx.pnl(40), rows: many.active }) })} payload={fx.payloadOf()} onSelect={() => {}} />);
    expect(out).toContain("Show all 40 processes");
    expect(out).not.toContain("NaN");
    const neg = withOps([-10, -20, -30, -40, -50, -60, -70, -80, -90, -5]);
    expect(divergingLayout(neg.bars.items.slice(8), neg.domain).zeroPct).toBe(100);
    expect(divergingLayout(neg.bars.items.slice(8), neg.domain).rows[1].widthPct).toBeCloseTo(5.6, 1);
  });
});

describe("as-of and independent team chart", () => {
  it("team frame renders with its own As of when attendance failed", () => {
    const ov = fx.overviewOf({ attendance: fx.err("down") });
    const out = renderToStaticMarkup(<AttendanceVisual overview={ov} payload={fx.payloadOf(ov)} onSelect={() => {}} />);
    for (const t of ["Attendance could not be loaded.", "Late arrivals by team", "Team 1", "As of 2026-10-15"]) expect(out).toContain(t);
    expect(out).not.toContain("Secret Manager");
  });
  it("team frame shows As of inside the attendance section too", () => {
    const out = renderToStaticMarkup(<AttendanceVisual overview={fx.overviewOf()} payload={fx.payloadOf()} onSelect={() => {}} />);
    expect(out).toContain("Teams are ranked; names are in the process drill-down · As of 2026-10-15");
  });
  it("quality frame and callmaster carry their own As of; missing QA is a dash, not 0", () => {
    const ov = fx.overviewOf({
      quality: { status: "ok", asOf: "2026-10-11", data: [{ processCode: "Q", processName: "No Score", tier: "full", QA_QUALITY_PCT: null, latestDate: null, stale: false }] },
      callmaster: { status: "ok", asOf: "2026-10-12", data: { fatal: fx.ok({ totalFatalCalls: 1, agentsWithFatals: 1, truncated: false }) } },
    });
    const out = renderToStaticMarkup(<OpsQualityVisual overview={ov} payload={fx.payloadOf(ov)} onSelect={() => {}} />);
    expect(out).toContain("QA quality %, lowest first · As of 2026-10-11");
    expect(out).toContain("As of 2026-10-12");
    const bars = qualityBars([{ processCode: "Q", processName: "No Score", tier: "full", QA_QUALITY_PCT: null, latestDate: null, stale: false }]);
    expect(barListTable(bars).rows[0][1]).toBe("—");
    expect(out).toContain("No Score —");
    expect(out).not.toContain("0.0%");
  });
});

describe("finance reconciles with reversals; zero budget is shown", () => {
  it("a negative cost adds back and the deltas end at the OP total", () => {
    const f = { ...fx.finance, pnl: { ...fx.finance.pnl, revenueRunning: 1000, salaryRunning: -100, grnConsumed: 300, grnReserved: 0, operatingProfit: 800 } };
    const b = buildFinance(f);
    expect(b.waterfall.steps.map((s) => s.value)).toEqual([1000, 100, -300, 0, 800]);
    const run = b.waterfall.steps.slice(0, 4).reduce((a, s) => a + s.value, 0);
    expect(run).toBe(800);
  });
  it("a head with budget 0 shows ₹0 as its budget", () => {
    const f = { ...fx.finance, byHead: { top: [{ head: "Misc", budget: 0, charged: 5000, pct: 0 }], overBudget: [] } };
    expect(buildFinance(f).headsTable.rows[0][2]).toBe("₹0");
  });
});

describe("aria summaries carry real values", () => {
  const r = (V: Visual) => renderToStaticMarkup(<V overview={fx.overviewOf()} payload={fx.payloadOf()} onSelect={() => {}} />);
  it("people, P&L, hiring and finance", () => {
    expect(r(PeopleVisual as Visual)).toContain('aria-label="Headcount versus mandate by process: Alpha Voice 60 of 50, Beta Chat 40');
    expect(r(ProcessPnlVisual as Visual)).toContain("Operating profit by process, worst first: Process 0 -₹50,000 Loss");
    expect(r(HiringVisual as Visual)).toContain("Hiring funnel");
    expect(r(HiringVisual as Visual)).toMatch(/aria-label="Hiring funnel[^"]*Requested 20/);
    const fin = renderToStaticMarkup(<FinanceVisual overview={fx.overviewOf()} payload={fx.payloadOf()} onSelect={() => {}} sub="pnl" />);
    expect(fin).toMatch(/aria-label="Running P&amp;L, revenue to operating profit: Revenue ₹60.2 L, Salary -₹39 L/);
  });
});
