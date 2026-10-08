import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PayrollReferenceLayout } from "../PayrollReferenceLayout";
import { buildLocalActions, payrollHealth, pctChange, readRunData } from "./payrollModel";
import type { ReferenceDashboardData } from "../../reference-dashboard-model";

const stage = (key: string, label: string, state: string, href = "/payroll") => ({ key, label, state, detail: `${label} detail`, href });
const run = {
  totals: { employees: 1256, net: 17564424, deductions: 1119334, contractGross: 1, employer: 1121284, payrollCost: 19805043, lopDays: 6919, lopEmployees: 1082, zeroNet: 122, negativeNet: 0, inactiveInRun: 384, incentive: 0, arrears: 0, overtime: 0, tds: 87160, loanEmi: 0, reimbursement: 0, ptLines: 0, ptAmount: 0, pfLiability: 1, esiLiability: 1 },
  previous: { employees: 1371, net: 18668410, deductions: 1132002, employer: 1161006, payrollCost: 20961418, lopDays: 14135, lopEmployees: 1, zeroNet: 0, negativeNet: 0 },
  previousRun: { id: "p", month: "2026-07" },
  headcount: { activeInScope: 1063, inRun: 1256, activeInRun: 872, paidInactive: 384, missingTotal: 191, missingNotDue: 190, missingNoStructure: 0, missingOther: 1 },
  drivers: [{ key: "joiners", label: "New in this run", amount: 321575, hint: "105 employees" }],
  filings: [{ type: "EPF", label: "PF (EPF)", dueDate: "2026-09-15", status: "overdue", amountDue: null, daysToDue: -17 }],
  payslips: { expected: 1256, generated: 0, acknowledged: 0, emailed: 0 }, disbursement: null, readinessUnits: { units: 121, frozen: 11 },
  branchCost: [{ branch: "NOIDA", employees: 10, net: 1, deductions: 1, cost: 5 }], abnormal: [],
  pipeline: {
    stages: [stage("attendance", "Attendance lock", "blocked"), stage("prep", "Prep & calculation", "done"), stage("validation", "Validation", "pending"), stage("approval", "Approval", "pending"), stage("disbursal", "Bank disbursal", "pending"), stage("statutory", "Statutory filing", "blocked"), stage("payslips", "Payslips", "pending")],
    stuckAt: "attendance", stuckLabel: "Attendance lock", payDate: "2026-09-07", daysToPayDate: -25, lastActivityDays: 29,
  },
};

function fixture(over: Partial<ReferenceDashboardData> = {}): ReferenceDashboardData {
  return {
    dashboardCode: "PAYROLL_HR_DASHBOARD", loading: false, refreshing: false, metrics: {}, selectedPayrollRunId: "r1",
    payrollRuns: [{ id: "r1", run_month: "2026-08", status: "processing" }],
    payroll: { currentMonth: "2026-08", currentRun: { status: "processing", totalEmployees: 1244 }, runInsights: run, unavailableSources: {}, dataIntegrity: [] },
    insights: { dashboardCode: "PAYROLL_HR_DASHBOARD", generatedAt: "", scopeLevel: "ORG_ALL", actions: [{ id: "fnf", label: "F&F settlements not yet paid", count: 91, severity: "critical", href: "/payroll/full-final", oldestDays: 102, overdue: 1 }], kpis: [], series: [], tables: [], signals: [], sectionErrors: {} },
    ...over,
  } as unknown as ReferenceDashboardData;
}

const html = (data: ReferenceDashboardData) => renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><MemoryRouter><PayrollReferenceLayout data={data} /></MemoryRouter></QueryClientProvider>);

describe("PayrollReferenceLayout", () => {
  it("renders hero, pipeline, tiles and linked actions", () => {
    const out = html(fixture());
    expect(out).toContain("Payroll run 2026-08");
    expect(out).toContain("Days past pay date");
    expect((out.match(/aria-label="Payroll run pipeline"/g) ?? []).length).toBe(1);
    expect(out).toContain('href="/payroll/full-final"');
    expect(out).toContain('href="/payroll/statutory?tab=filing"');
    for (const label of ["Net pay", "Payroll cost", "Active, not in run", "Payroll readiness", "LOP days", "Payslips generated"]) expect(out).toContain(label);
    // every KPI tile is an anchor or button, never a bare div
    expect((out.match(/kit-lift/g) ?? []).length).toBeGreaterThanOrEqual(12);
  });

  it("degrades honestly when run analytics are unavailable", () => {
    const out = html(fixture({ payroll: { currentMonth: "2026-08", unavailableSources: { runInsights: "x" } } as never }));
    expect(out).toContain("Run analytics could not be computed");
    expect(out).toContain("Payroll readiness");
  });

  it("asks for a run when none is selected", () => {
    expect(html(fixture({ selectedPayrollRunId: "" }))).toContain("Select a payroll run");
  });
});

describe("payroll model", () => {
  it("readRunData is null when absent", () => expect(readRunData({})).toBeNull());
  it("pctChange needs a previous value", () => { expect(pctChange(10, 0)).toBeNull(); expect(pctChange(110, 100)).toBe(10); });
  it("health averages measurable parts and needs two", () => {
    expect(payrollHealth({ readinessPct: 80, run: null })).toBeNull();
    expect(payrollHealth({ readinessPct: 80, run: readRunData({ runInsights: run }) })?.value).toBeGreaterThan(0);
  });
  it("local actions use mounted payroll routes", () => {
    const a = buildLocalActions({ run: readRunData({ runInsights: run }), missingBank: 5, missingPan: 1, invalidPan: 1, missingUan: 2, attendanceBlockers: 3 });
    expect(a.find((x) => x.id === "run-stuck")?.href).toBe("/payroll");
    expect(a.every((x) => x.href.startsWith("/"))).toBe(true);
  });
});
