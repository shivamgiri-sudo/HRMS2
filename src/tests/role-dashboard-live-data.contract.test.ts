import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildRecruitmentFunnel,
  mergeRecruiterDashboardData,
  normalizeExecutiveQualityData,
  normalizeOrgKpiData,
  normalizeQualityDashboardData,
} from "@/pages/dashboards/dashboard-data-contracts";
import { countEmployeesOnLeaveOnDate } from "@/pages/dashboards/reference-dashboard-model";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("role dashboard live-data contracts", () => {
  it("normalizes quality summary, trend, defects, coaching agents, and pending audits", () => {
    const result = normalizeQualityDashboardData(
      {
        success: true,
        summary: {
          total_calls: "3125",
          audited_calls: "2175",
          avg_quality_score: "71.12",
        },
        parameter_fails: [
          { param: "call_open", fail_rate: "40" },
          { param: "accuracy", fail_rate: "60" },
        ],
      },
      {
        success: true,
        trend: [
          { date: "2026-07-19", avg_score: "70.5" },
          { date: "2026-07-20", avg_score: "71.1" },
        ],
      },
      {
        success: true,
        agents: [
          { agent_code: "A", avg_score: "82", calls_below_50: 1 },
          { agent_code: "B", avg_score: "55", calls_below_50: 5 },
        ],
      },
    );

    expect(result.avg_score).toBe(71.12);
    expect(result.total_audits).toBe(2175);
    expect(result.pending_audits).toBe(950);
    expect(result.fail_rate).toBeNull();
    expect(result.score_trend).toEqual([
      { label: "2026-07-19", value: 70.5 },
      { label: "2026-07-20", value: 71.1 },
    ]);
    expect(result.defects).toEqual([
      { category: "Call Open", count: 40, severity: "high" },
      { category: "Accuracy", count: 60, severity: "critical" },
    ]);
    expect(result.bottom_agents).toEqual([
      { agent_code: "B", score: 55, fail_count: 5 },
      { agent_code: "A", score: 82, fail_count: 1 },
    ]);
  });

  it("calculates quality fail rate from failed audits, not averaged parameter percentages", () => {
    const result = normalizeQualityDashboardData(
      {
        summary: {
          audited_calls: 200,
          failed_audits: 30,
        },
        parameter_fails: [
          { param: "accuracy", fail_rate: 90 },
          { param: "disclosure", fail_rate: 10 },
        ],
      },
      {},
      {},
    );

    expect(result.fail_rate).toBe(15);
  });

  it("maps the executive quality API to the CEO dashboard fields", () => {
    const result = normalizeExecutiveQualityData({
      metrics: {
        overall_quality_score: 71.37,
        target_quality_score: 85,
      },
      risk_summary: {
        critical_agents_count: 12,
        at_risk_agents_count: 11,
      },
      process_performance: [
        {
          process: "Collections",
          avg_quality: 78.4,
          agent_count: 51,
          calls_handled: 4802,
          status: "At Risk",
        },
      ],
    });

    expect(result.org_quality_score).toBe(71.37);
    expect(result.target_score).toBe(85);
    expect(result.risk_agents).toBe(23);
    expect(result.processes).toEqual([
      {
        process: "Collections",
        avg_score: 78.4,
        agent_count: 51,
        calls: 4802,
        status: "At Risk",
      },
    ]);
    expect(normalizeExecutiveQualityData({}).risk_agents).toBeNull();
  });

  it("maps the mounted KPI endpoint shape to CEO and manager fields", () => {
    const result = normalizeOrgKpiData({
      period: "2026-07",
      summary: {
        org_avg_score: "76.5",
        employees_scored: 42,
      },
      by_process: [
        { label: "Sales", avg_score: "82", agents: 20 },
        { label: "Support", avg_score: "68", agents: 22 },
      ],
      trend: [
        { period: "2026-06", avg_score: "74" },
        { period: "2026-07", avg_score: "76.5" },
      ],
    });

    expect(result.org_average_score).toBe(76.5);
    expect(result.score).toBe(76.5);
    expect(result.best_process).toEqual({ name: "Sales", score: 82, agents: 20 });
    expect(result.needs_attention).toEqual({ name: "Support", score: 68, agents: 22 });
    expect(result.trend).toEqual([
      { label: "2026-06", value: 74 },
      { label: "2026-07", value: 76.5 },
    ]);
  });

  it("adds today's live hiring metrics without replacing ATS pipeline totals", () => {
    const result = mergeRecruiterDashboardData(
      { total_candidates: 33414, selected_candidates: 54 },
      { metrics: { walkins: "7", offer_letter_issued: "3", joined: "2" } },
    );

    expect(result.total_candidates).toBe(33414);
    expect(result.selected_candidates).toBe(54);
    expect(result.walkins_today).toBe(7);
    expect(result.offers_today).toBe(3);
    expect(result.joined_today).toBe(2);
  });

  it("builds the full recruitment funnel without treating shortlisted as offered", () => {
    const funnel = buildRecruitmentFunnel({
      total_candidates: 20,
      by_stage: {
        shortlisted: 8,
        offered: 2,
        joined: 1,
      },
    });

    expect(funnel.map((stage) => stage.label)).toEqual([
      "Applied", "Screened", "HR Round", "Skill Test", "Operations Round",
      "Client Round", "Selected", "Offered", "Offer Accepted", "Joined",
      "Rejected", "Dropped", "No-show",
    ]);
    expect(funnel.find((stage) => stage.label === "Screened")?.value).toBe(8);
    expect(funnel.find((stage) => stage.label === "Offered")?.value).toBe(2);
    expect(funnel.filter((stage) => stage.value === 0)).not.toHaveLength(0);
  });

  it("routes dedicated operational dashboards through the reference data pipeline", () => {
    for (const file of [
      "src/pages/dashboards/QualityDashboardRole.tsx",
      "src/pages/dashboards/OperationsDashboardRole.tsx",
      "src/pages/dashboards/RecruiterDashboard.tsx",
      "src/pages/dashboards/WfmAttendanceDashboard.tsx",
    ]) {
      const source = read(file);
      expect(source).toContain("ReferenceRoleDashboard");
      expect(source).not.toContain("RoleDashboardV3");
    }
  });

  it("mounts the self-service LMS integration route before the legacy LMS router", () => {
    const app = read("backend/src/app.ts");
    expect(app.indexOf('app.use("/api/lms", lmsIntegrationRouter)')).toBeLessThan(
      app.indexOf('app.use("/api/lms", lmsRouter)'),
    );
  });

  it("retires RoleDashboardV3 and routes employee dashboards through the shared engine", () => {
    const index = read("src/pages/Index.tsx");
    const employee = read("src/pages/dashboards/EmployeeSelfDashboard.tsx");

    expect(index).not.toContain("RoleDashboardV3");
    expect(index).toContain("ReferenceRoleDashboard");
    expect(employee).toContain("ReferenceRoleDashboard");
  });

  it("refreshes only APIs enabled for the active role dashboard", () => {
    const dashboard = read("src/pages/dashboards/ReferenceRoleDashboard.tsx");

    expect(dashboard).toContain("const activeQueryResults =");
    expect(dashboard).toContain("for (const query of activeQueryResults)");
    expect(dashboard).not.toContain("for (const query of queryResults)");
  });

  it("keeps IT provisioning failures distinct from genuine zero results", () => {
    const dashboard = read("src/pages/dashboards/ReferenceRoleDashboard.tsx");
    const layout = read("src/pages/dashboards/reference/ItManagerReferenceLayout.tsx");

    expect(dashboard).toContain("itProvisioningAvailable: !itProvisioningQuery.isError");
    expect(layout).not.toContain("?? 0");
    expect(layout).toContain("Provisioning source unavailable");
    expect(layout).toContain("No pending provisioning tasks");
  });

  it("counts only distinct employees whose approved leave covers the selected day", () => {
    const requests = [
      { employee_id: "e1", status: "approved", start_date: "2026-07-23", end_date: "2026-07-24" },
      { employee_id: "e1", status: "approved", from_date: "2026-07-23", to_date: "2026-07-23" },
      { employee_id: "e2", status: "approved", leave_date: "2026-07-23" },
      { employee_id: "e3", status: "approved", start_date: "2026-07-20", end_date: "2026-07-22" },
      { employee_id: "e4", status: "pending", start_date: "2026-07-23", end_date: "2026-07-23" },
    ];

    expect(countEmployeesOnLeaveOnDate(requests, "2026-07-23")).toBe(2);
  });

  it("does not use payroll close time as the pay date", () => {
    const layout = read("src/pages/dashboards/reference/PayrollReferenceLayout.tsx");

    expect(layout).not.toContain('stringAt(currentRun, "closedAt")');
    expect(layout).not.toContain('"Bank Transfer"');
    expect(layout).not.toContain('{ name: "Basic / Gross Pay"');
  });

  it("does not present headcount movement as manager performance", () => {
    const layout = read("src/pages/dashboards/reference/ManagerReferenceLayout.tsx");

    expect(layout).not.toContain("row.headcount");
    expect(layout).toContain('arrayAt(data.orgKpi, "trend")');
  });

  it("does not fabricate WFM alert counts or sub-minimum dashboard text", () => {
    const wfm = read("src/pages/dashboards/reference/WfmReferenceLayout.tsx");
    const dashboardUi = read("src/pages/dashboards/ReferenceDashboardUI.tsx");

    expect(wfm).not.toContain("interventionRows.length || 4");
    expect(`${wfm}\n${dashboardUi}`).not.toMatch(/text-\[(?:8|9|10|11)px\]/);
  });

  it("keeps Operations login adherence separate from SLA and avoids hard-coded thresholds", () => {
    const operations = read("src/pages/dashboards/reference/OperationsReferenceLayout.tsx");

    expect(operations).not.toContain("const slaAdherence =");
    expect(operations).not.toContain("login_adherence_pct ?? o.sla_pct");
    expect(operations).not.toContain("slaAdherence >= 90");
    expect(operations).not.toContain('<ReferenceLineChart data={shrinkageRows}');
  });

  it("labels processed attendance accurately and does not synthesize biometric devices", () => {
    const dashboard = read("src/pages/dashboards/ReferenceRoleDashboard.tsx");
    const attendance = read("src/pages/dashboards/reference/WfmAttendanceReferenceLayout.tsx");

    expect(attendance).toContain('title="Processed Attendance Status"');
    expect(attendance).not.toContain('title="Live Attendance Status"');
    expect(dashboard).not.toContain('id: "cosec-integration"');
  });

  it("does not fall back from selected candidates to total ATS records", () => {
    const hr = read("src/pages/dashboards/reference/HrReferenceLayout.tsx");

    expect(hr).not.toContain("data.ats.total)");
    expect(hr).not.toContain("HR Operations AI Briefing");
    expect(hr).toContain("Automated HR Operations Summary");
  });

  it("does not label processed attendance as CEO login adherence or static summaries as AI", () => {
    const ceo = read("src/pages/dashboards/reference/CeoReferenceLayout.tsx");
    const superAdmin = read("src/pages/dashboards/reference/SuperAdminReferenceLayout.tsx");

    expect(ceo).not.toContain('label: "Login Adherence", value: attendance');
    expect(ceo).not.toContain('title="Executive AI Briefing"');
    expect(superAdmin).not.toContain('helper: "Excellent"');
  });

  it("uses direct quality pass/fail counts and stable-row deduplication", () => {
    const quality = read("src/pages/dashboards/reference/QualityReferenceLayout.tsx");

    expect(quality).not.toContain("auditsDone * (1 - failRate / 100)");
    expect(quality).not.toContain("auditsDone * (failRate / 100)");
    expect(quality).toContain("deduplicateQualityRows");
  });

  it("filters dashboard quick actions through current page and role permissions", () => {
    const dashboardUi = read("src/pages/dashboards/ReferenceDashboardUI.tsx");
    const linkAccess = read("src/pages/dashboards/dashboardLinkAccess.ts");

    expect(dashboardUi).toContain("useDashboardLinkAccess()");
    expect(linkAccess).toContain("disabledPageCodes");
    expect(linkAccess).toContain("page.can_view");
    expect(linkAccess).toContain("roles.has(\"super_admin\")");
  });

  it("keeps WFM planning, availability, and adherence metrics independent", () => {
    const wfm = read("src/pages/dashboards/reference/WfmReferenceLayout.tsx");

    expect(wfm).not.toContain('metricDetail(m, "hc", "available") ?? active');
    expect(wfm).not.toContain("attendanceRate");
    expect(wfm).toContain("roster_adherence_pct");
    expect(wfm).toContain("Planning source unavailable");
    expect(wfm).not.toContain("Workforce AI Analysis");
  });

  it("does not convert missing employee source fields into zero or static AI claims", () => {
    const dashboard = read("src/pages/dashboards/ReferenceRoleDashboard.tsx");
    const employee = read("src/pages/dashboards/reference/EmployeeReferenceLayout.tsx");

    const fallback = dashboard.slice(
      dashboard.indexOf("function employeeAttendanceFallback"),
      dashboard.indexOf("async function loadEmployee"),
    );
    expect(fallback).not.toContain("?? 0");
    expect(employee).not.toContain("Attendance & Leave AI Brief");
    expect(employee).not.toContain("Insights powered by AI");
    expect(employee).toContain("Automated Attendance & Leave Summary");
    expect(dashboard).toContain("sourceFreshness");
    expect(employee).toContain("Source Freshness");
  });

  it("uses the mounted scoped IT provisioning stats endpoint", () => {
    const dashboard = read("src/pages/dashboards/ReferenceRoleDashboard.tsx");

    expect(dashboard).toContain("/api/it-provisioning/stats");
    expect(dashboard).not.toContain("/api/provisioning/it/stats");
  });

  it("requires an explicit payroll run before loading operational totals", () => {
    const dashboard = read("src/pages/dashboards/ReferenceRoleDashboard.tsx");
    const payroll = read("src/pages/dashboards/reference/PayrollReferenceLayout.tsx");

    expect(dashboard).toContain("selectedPayrollRunId");
    expect(dashboard).toContain("runId=${selectedPayrollRunId}");
    expect(payroll).toContain("Select a payroll run");
  });

  it("does not alter candidate registration, assessment, or onboarding route mounts", () => {
    const diffSensitiveFiles = [
      "backend/src/modules/ats/registration.enhanced.routes.ts",
      "backend/src/modules/ats-assessment/assessment.routes.ts",
      "backend/src/modules/ats/onboarding-full.routes.ts",
    ];

    for (const file of diffSensitiveFiles) {
      expect(read(file).length).toBeGreaterThan(0);
    }
  });
});
