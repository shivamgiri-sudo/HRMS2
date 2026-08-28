import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Guards against dashboards silently discarding the data they fetch.
 *
 * Measured before this suite existed: 172 datapoints across the twelve dashboards were
 * computed, scoped and returned on every load, then never rendered — the payroll
 * dashboard showed none of its twelve and had no clickable tile at all. Nothing failed;
 * the panels were simply thin.
 *
 * These are static checks on the layout sources, so they need no database and no server.
 */
const REF = resolve(__dirname, "../reference");
const read = (f: string) => readFileSync(resolve(REF, f), "utf8");

const LAYOUTS = [
  "SuperAdminReferenceLayout.tsx",
  "CeoReferenceLayout.tsx",
  "HrReferenceLayout.tsx",
  "WfmReferenceLayout.tsx",
  "WfmAttendanceReferenceLayout.tsx",
  "PayrollReferenceLayout.tsx",
  "QualityReferenceLayout.tsx",
  "OperationsReferenceLayout.tsx",
  "RecruiterReferenceLayout.tsx",
  "ItManagerReferenceLayout.tsx",
  "ManagerReferenceLayout.tsx",
  "EmployeeReferenceLayout.tsx",
];

/** Layouts whose tiles come from metrics and must therefore offer drill-down. */
const METRIC_BACKED = LAYOUTS.filter(
  (f) => !["QualityReferenceLayout.tsx", "ItManagerReferenceLayout.tsx"].includes(f),
);

describe("dashboard widget coverage", () => {
  it("every metric-backed layout offers drill-down on at least one tile", () => {
    const missing = METRIC_BACKED.filter((f) => !read(f).includes("drill("));
    expect(
      missing,
      `These layouts render metric tiles but never call data.drilldownFor(), so nothing ` +
        `is clickable through to the records behind the number:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });

  it("drill-down is owned once, centrally, not per layout", () => {
    // A drawer per layout would drift; ReferenceRoleDashboard owns the only instance.
    const perLayout = LAYOUTS.filter((f) => read(f).includes("DashboardDrilldownDrawer"));
    expect(perLayout, "layouts must not mount their own drawer").toEqual([]);

    const host = readFileSync(resolve(__dirname, "../ReferenceRoleDashboard.tsx"), "utf8");
    expect(host).toContain("DashboardDrilldownDrawer");
    expect(host).toContain("drilldownFor");
  });

  it("the payroll dashboard renders its blocker breakdown", () => {
    // Regression pin: this layout previously rendered 0 of its 12 datapoints.
    const src = read("PayrollReferenceLayout.tsx");
    for (const key of ["missingBank", "missingPan", "missingUan", "blockerCount", "readyCount"]) {
      expect(src, `payroll layout must render ${key}`).toContain(key);
    }
  });

  it("the payroll dashboard no longer equates total employees with processed", () => {
    const src = read("PayrollReferenceLayout.tsx");
    expect(src).not.toMatch(/const total = processed;/);
    expect(src).toContain("totalEmployees");
  });

  it("shared breakdown panels exist and are reused rather than copied", () => {
    const shared = read("ReferenceSharedPanels.tsx");
    for (const panel of [
      "AttendanceBreakdownPanel",
      "LiveVsProcessedPanel",
      "OnboardingFunnelPanel",
      "PayrollBlockersPanel",
      "ExitPipelinePanel",
    ]) {
      expect(shared, `${panel} must be defined once in ReferenceSharedPanels`).toContain(`export function ${panel}`);
    }

    // At least four layouts should consume them; copying the markup instead would mean
    // the attendance breakdown drifts between dashboards.
    const consumers = LAYOUTS.filter((f) => read(f).includes("ReferenceSharedPanels"));
    expect(consumers.length).toBeGreaterThanOrEqual(4);
  });

  it("attendance breakdown states its anchor day rather than implying today", () => {
    const shared = read("ReferenceSharedPanels.tsx");
    expect(shared).toContain("expectedToWork");
    // Half days must be visible: they are counted as 0.5 in the rate, so a viewer
    // reconciling the percentage needs the count.
    expect(shared).toContain("halfDay");
  });

  it("tiles explain a blank value instead of showing a bare dash", () => {
    // metricUnavailableReason distinguishes "no data recorded" from "query failed".
    const users = LAYOUTS.filter((f) => read(f).includes("metricUnavailableReason"));
    expect(users.length, "layouts should surface why a tile is blank").toBeGreaterThanOrEqual(3);
  });

  it("renders every datapoint the newly-added metrics return", () => {
    // Each of these metrics was added with a full detail breakdown. Fetching a breakdown
    // and rendering only its headline is exactly the 172-datapoint gap this suite exists
    // to prevent, so every detail key is pinned here.
    const shared = read("ReferenceSharedPanels.tsx");
    const REQUIRED: Record<string, readonly string[]> = {
      // ATTENDANCE_EXCEPTIONS gained a row per issue type: only missing_adr,
      // salary_payable_days_mismatch and unmapped_cosec_user were itemised, which on
      // 2026-08-28 covered 3,345 of 4,666 open exceptions and left the other 1,321 in the
      // headline total with no row. `resolved` was replaced by `resolvedLast30d` — the
      // former counted issues RAISED in the window and since cleared, which is not what
      // the "Cleared in the last 30 days" row says.
      AttendanceExceptionPanel: [
        "openTotal", "blockers", "warnings", "missingAdr", "payableMismatch",
        "unmappedCosec", "zeroMinute", "missingPunchWithSource", "diallerWithoutEvidence",
        "missingIbd", "inactiveCosecActivity", "otherOpen", "resolvedLast30d", "unscopeable",
      ],
      PayrollBlockersPanel: [
        "missingBank", "missingNeftBank", "missingPan", "invalidPan", "missingUan",
        "blockerCount", "readyCount", "total",
      ],
      DocumentCompliancePanel: [
        "activeEmployees", "employeesWithNoDocs", "employeesWithDocs", "totalDocs",
        "verifiedDocs", "verifiedWithEvidence", "unverifiedDocs", "coveragePct",
      ],
      BiometricCoveragePanel: [
        "employees", "completePunchPairs", "singlePunchOnly", "singlePunchPct",
        "avgHours", "avgPunches",
      ],
      SalaryComponentPanel: [
        "componentCodes", "employees", "earningLines", "deductionLines",
        "earningTotal", "deductionTotal", "taxableLines",
      ],
      RecruiterFunnelPanel: [
        "leads", "recruiters", "contacted", "walkins", "hrScreened", "selected",
        "joined", "conversionPct",
      ],
      TrainingProgressPanel: [
        "assignments", "learners", "courses", "completed", "inProgress", "notStarted",
        "avgCompletionPct", "avgScore",
      ],
      LeaveApprovalPanel: [
        "pending", "pendingAlreadyStarted", "needsBranchHead", "approved", "rejected",
        "oldestPendingDays",
      ],
    };

    const missing: string[] = [];
    for (const [panel, keys] of Object.entries(REQUIRED)) {
      expect(shared, `${panel} must exist in ReferenceSharedPanels`).toContain(`export function ${panel}`);
      // Scope the search to the panel's own body so a key rendered by a different panel
      // does not mask a genuine omission here.
      const start = shared.indexOf(`export function ${panel}`);
      const nextExport = shared.indexOf("\nexport function ", start + 1);
      const body = shared.slice(start, nextExport === -1 ? undefined : nextExport);
      for (const key of keys) {
        if (!body.includes(`"${key}"`)) missing.push(`${panel}.${key}`);
      }
    }
    expect(
      missing,
      `These metric datapoints are fetched on every dashboard load but never rendered:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });

  it("keeps salary amounts off non-payroll layouts", () => {
    // CLAUDE.md: payroll/salary values must never appear on a management, CEO or client
    // surface. SalaryComponentPanel renders rupee totals, so only the payroll layout may
    // mount it. The backend bundle test is the other half of this guard.
    const offenders = LAYOUTS
      .filter((f) => f !== "PayrollReferenceLayout.tsx")
      .filter((f) => read(f).includes("SalaryComponentPanel"));
    expect(
      offenders,
      `SalaryComponentPanel renders salary amounts and must stay on the payroll ` +
        `dashboard only:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
    expect(read("PayrollReferenceLayout.tsx")).toContain("SalaryComponentPanel");
  });

  it("routes the new panels to the layouts that own the work", () => {
    const mounted = (layout: string, panel: string) => read(layout).includes(`<${panel} data={data} />`);
    // WFM fixes attendance exceptions; payroll is blocked by them.
    expect(mounted("WfmAttendanceReferenceLayout.tsx", "AttendanceExceptionPanel")).toBe(true);
    expect(mounted("WfmReferenceLayout.tsx", "AttendanceExceptionPanel")).toBe(true);
    expect(mounted("PayrollReferenceLayout.tsx", "AttendanceExceptionPanel")).toBe(true);
    expect(mounted("WfmReferenceLayout.tsx", "BiometricCoveragePanel")).toBe(true);
    expect(mounted("HrReferenceLayout.tsx", "DocumentCompliancePanel")).toBe(true);
    expect(mounted("RecruiterReferenceLayout.tsx", "RecruiterFunnelPanel")).toBe(true);
    // Training goes to HR and Management; trainer keeps the employee self dashboard.
    expect(mounted("HrReferenceLayout.tsx", "TrainingProgressPanel")).toBe(true);
    expect(mounted("ManagerReferenceLayout.tsx", "TrainingProgressPanel")).toBe(true);
    expect(mounted("EmployeeReferenceLayout.tsx", "TrainingProgressPanel")).toBe(false);
  });

  it("does not present an inbox age as a missed deadline", () => {
    // work_inbox_item has no due date. Reporting its age as "overdue" would invent a
    // deadline that never existed, so the panel must distinguish the two.
    const shared = read("ReferenceSharedPanels.tsx");
    expect(shared).toContain("aged_count");
    expect(shared).toContain("overdue_count");
    expect(shared, "the aged row must say the rows carry no due date").toContain("carry no due date");
  });
});
