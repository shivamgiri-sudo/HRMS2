import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn() } }));

import { computePipeline, daysBetween, deriveDrivers, effectiveFilingStatus, payrollCost, type PipelineInput, type RunTotals } from "../role-insights/providers/payrollRun.js";
import { buildSignals, cycleMonth, type SignalInput } from "../role-insights/providers/payroll.js";

const base: PipelineInput = {
  status: "processing", validationStatus: "pending", financeApprovedAt: null, attendanceLocked: false,
  readiness: { units: 10, frozen: 10 }, employees: 100, disbursement: null, disbursedAt: null, filings: [], payslips: null,
  payDate: "2026-09-07", today: "2026-10-02", runMonth: "2026-08", updatedAt: "2026-09-03T00:00:00.000Z",
};

describe("payroll run pipeline", () => {
  it("stops at validation for a calculated run and counts days past the pay date", () => {
    const p = computePipeline(base);
    expect(p.stages.map((s) => s.state)).toEqual(["done", "done", "current", "pending", "pending", "unknown", "unknown"]);
    expect(p.stuckAt).toBe("validation");
    expect(p.daysToPayDate).toBe(-25);
    expect(p.lastActivityDays).toBe(29);
  });

  it("blocks on unfrozen attendance when the run is already calculated", () => {
    const p = computePipeline({ ...base, readiness: { units: 10, frozen: 3 } });
    expect(p.stages[0]).toMatchObject({ state: "blocked", detail: "3 of 10 branch-process units frozen" });
    expect(p.stuckAt).toBe("attendance");
  });

  it("treats a finalized run as past validation/approval but not as disbursed without evidence", () => {
    const p = computePipeline({ ...base, status: "FINALIZED" });
    expect(p.stages.slice(0, 4).map((s) => s.state)).toEqual(["done", "done", "done", "done"]);
    expect(p.stages[4].state).toBe("unknown");
    expect(p.stages[4].detail).toMatch(/no disbursal record/);
  });

  it("marks disbursal done from a completed disbursement and filing overdue as blocked", () => {
    const p = computePipeline({
      ...base, status: "finalized", disbursement: { status: "completed" },
      filings: [{ type: "EPF", label: "PF (EPF)", dueDate: "2026-09-15", status: "overdue", amountDue: null, daysToDue: -17 }],
      payslips: { generated: 100, expected: 100 },
    });
    expect(p.stages[4].state).toBe("done");
    expect(p.stages[5]).toMatchObject({ state: "blocked", detail: "0 of 1 filed, 1 overdue" });
    expect(p.stages[6].state).toBe("done");
    expect(p.stuckAt).toBe("statutory");
  });

  it("flags a rejected validation as blocked", () => {
    const p = computePipeline({ ...base, validationStatus: "rejected" });
    expect(p.stages[2].state).toBe("blocked");
  });
});

describe("filing status and costs", () => {
  it("treats a pending filing past its due date as overdue", () => {
    expect(effectiveFilingStatus("pending", "2026-09-07", "2026-10-02")).toBe("overdue");
    expect(effectiveFilingStatus("pending", "2026-10-07", "2026-10-02")).toBe("pending");
    expect(effectiveFilingStatus("filed", "2026-09-07", "2026-10-02")).toBe("filed");
  });
  it("computes payroll cost from net + deductions + employer contributions, not contractual gross", () => {
    expect(payrollCost(17564424.2, 1119334.75, 1121284.52)).toBe(19805043.47);
  });
  it("daysBetween is signed", () => {
    expect(daysBetween("2026-10-02", "2026-10-07")).toBe(5);
    expect(daysBetween("2026-10-07", "2026-10-02")).toBe(-5);
  });
});

describe("variance drivers", () => {
  const t = (over: Partial<RunTotals>): RunTotals => ({
    employees: 0, net: 0, deductions: 0, contractGross: 0, employer: 0, payrollCost: 0, lopDays: 0, lopEmployees: 0, zeroNet: 0, negativeNet: 0,
    inactiveInRun: 0, incentive: 0, arrears: 0, overtime: 0, tds: 0, loanEmi: 0, reimbursement: 0, ptLines: 0, ptAmount: 0, pfLiability: 0, esiLiability: 0, ...over,
  });
  it("orders by absolute impact and signs deductions so a rise lowers net", () => {
    const d = deriveDrivers(t({ incentive: 100, tds: 500, lopDays: 10 }), t({ incentive: 900, tds: 100, lopDays: 4 }), { count: 3, net: 3000 }, { count: 1, net: 1200 });
    expect(d.map((x) => x.key)).toEqual(["joiners", "dropped", "incentive", "tds", "lop"]);
    expect(d.find((x) => x.key === "tds")?.amount).toBe(-400);
    expect(d.find((x) => x.key === "dropped")?.amount).toBe(-1200);
    expect(d.find((x) => x.key === "lop")?.hint).toBe("+6 days vs previous run");
  });
});

describe("cycle month and signals", () => {
  it("processes the previous calendar month, including across a year boundary", () => {
    expect(cycleMonth("2026-10-02")).toBe("2026-09");
    expect(cycleMonth("2027-01-05")).toBe("2026-12");
  });

  const sig: SignalInput = {
    today: "2026-10-02", cycle: "2026-09", cycleRunExists: true,
    latest: { month: "2026-08", status: "processing", net: 17_564_424, zeroNet: 122, employees: 1256, ptLines: 72, ptAmount: 14400 },
    previousNet: 18_668_410, payDate: "2026-09-07", filingsOverdue: 3, filingsDueSoon: 1, bankExceptions: 91, unfrozenUnits: 377,
  };
  it("derives bad/watch/good from thresholds", () => {
    const s = buildSignals({ ...sig, cycleRunExists: false });
    const titles = s.map((x) => `${x.tone}:${x.title}`);
    expect(titles).toContain("bad:No payroll run exists for 2026-09");
    expect(titles).toContain("bad:2026-08 pay date passed 25d ago");
    expect(titles).toContain("bad:High share of zero-net lines");
    expect(titles).toContain("bad:Statutory filings overdue");
    expect(titles).toContain("good:Net pay is stable vs previous run");
    expect(titles.some((x) => x.startsWith("watch:Professional tax"))).toBe(true);
    for (const x of s) if (x.href) expect(x.href.startsWith("/")).toBe(true);
  });
  it("is quiet when everything is clean", () => {
    const s = buildSignals({ ...sig, latest: { ...sig.latest!, status: "finalized", zeroNet: 0, ptLines: 0 }, filingsOverdue: 0, filingsDueSoon: 0, bankExceptions: 0, unfrozenUnits: 0 });
    expect(s.filter((x) => x.tone !== "good")).toEqual([]);
  });
});

describe("payroll dashboard source contracts", () => {
  const routes = readFileSync(resolve(process.cwd(), "src/modules/dashboards/dashboard.routes.ts"), "utf8");
  const metrics = readFileSync(resolve(process.cwd(), "src/modules/dashboards/dashboard-metric.service.ts"), "utf8");
  it("serves run analytics, the real statutory filings and the calendar pay date from the operational summary", () => {
    const route = routes.slice(routes.indexOf('router.get("/PAYROLL_HR_DASHBOARD/operational-summary"'), routes.indexOf('router.get("/:dashboardCode/summary"'));
    expect(route).toContain("loadRunInsights");
    expect(route).toContain("statutoryFiling: runInsights?.filings");
    expect(route).toContain("payDay: runInsights?.calendar?.pay");
    expect(route).not.toContain("statutory_filing_record does not exist");
  });
  it("counts every awaiting-approval incentive state, not only 'pending'", () => {
    expect(metrics).toContain("status IN ('pending','pending_approval','approval_chain_active','finance_approved')");
  });
});
