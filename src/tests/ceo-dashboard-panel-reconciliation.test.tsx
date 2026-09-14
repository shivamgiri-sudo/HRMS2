import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import {
  AttendanceExceptionPanel,
  DocumentCompliancePanel,
  OnboardingFunnelPanel,
  PayrollBlockersPanel,
} from "@/pages/dashboards/reference/ReferenceSharedPanels";
import type { ReferenceDashboardData } from "@/pages/dashboards/reference-dashboard-model";

/**
 * Every fixture below is the metric payload the live database actually produced on
 * 2026-08-28, re-run read-only against mas_hrms. The panels were reporting numbers that
 * did not reconcile with their own totals, or rows that could never be non-zero.
 */

function data(metrics: Record<string, unknown>): ReferenceDashboardData {
  return {
    variant: "ceo",
    summary: {} as never,
    metrics: metrics as never,
    employee: {
      attendance: {}, balances: [], onboarding: {}, lms: {}, engagement: {},
      sourceErrors: [], sourceFreshness: {},
    },
    ats: {}, system: {}, workforce: {}, pnl: {}, payroll: {},
    biometric: {}, devices: {}, opsPulse: {},
    managerLeaves: [], managerInsights: {}, managerAccountability: [],
    quality: {}, orgKpi: {},
    loading: false,
  } as unknown as ReferenceDashboardData;
}

function render(node: React.ReactElement): string {
  return renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);
}

// ─── Attendance exceptions ────────────────────────────────────────────────────
// Live: 4,666 open, of which 4,405 blockers. The panel itemised only missing_adr (2,678),
// salary_payable_days_mismatch (455) and unmapped_cosec_user (212) = 3,345, leaving 1,321
// open exceptions — five whole issue types — with no row anywhere on the panel.
const ATT_EXCEPTION = {
  attException: {
    value: 4666,
    available: true,
    detail: {
      openTotal: 4666,
      blockers: 4405,
      warnings: 261,
      missingAdr: 2678,
      payableMismatch: 455,
      unmappedCosec: 212,
      zeroMinute: 514,
      missingPunchWithSource: 289,
      diallerWithoutEvidence: 288,
      missingIbd: 181,
      inactiveCosecActivity: 49,
      otherOpen: 0,
      resolvedLast30d: 7110,
      unscopeable: 352,
    },
  },
};

describe("AttendanceExceptionPanel", () => {
  it("itemises every open issue type so the rows reconcile with the panel's own total", () => {
    const html = render(<AttendanceExceptionPanel data={data(ATT_EXCEPTION)} />);

    // The four blocker types that had no row at all.
    expect(html).toContain("Zero-Minute Attendance");
    expect(html).toContain("Missing Punch");
    expect(html).toContain("Dialler Source Without Evidence");
    expect(html).toContain("Missing Biometric Day");
  });

  it("states that the resolved count is measured over cleared date, not raised date", () => {
    const html = render(<AttendanceExceptionPanel data={data(ATT_EXCEPTION)} />);

    // The old subtitle claimed "Cleared in the last 30 days" while the query counted
    // resolved rows among issues *raised* in the last 30 days — a different set.
    expect(html).toContain("Cleared in the last 30 days");
  });
});

// ─── Payroll readiness blockers ───────────────────────────────────────────────
// Live: total 1,120 · ready 882 · blocked 238 · missingBank 5 · missingNeftBank 6 ·
// missingPan 238 · missingUan 410. UAN is NOT part of the ready test, so a 410 sat
// directly above a "Total Blocked 238".
const PAYROLL = {
  payroll: {
    value: 882,
    available: true,
    detail: {
      total: 1120, readyCount: 881, blockerCount: 239,
      missingBank: 5, missingNeftBank: 6, missingPan: 232, invalidPan: 7, missingUan: 410,
    },
  },
};

describe("PayrollBlockersPanel", () => {
  it("uses the NEFT-specific count on the row whose subtitle claims NEFT", () => {
    const html = render(<PayrollBlockersPanel data={data(PAYROLL)} />);

    // missingBank (5) is "payable by SOME route"; missingNeftBank (6) is the one that
    // cannot be reached by the NEFT file the subtitle names.
    expect(html).toContain("Cannot be paid by the NEFT file");
    expect(html).toMatch(/Cannot be paid by the NEFT file[\s\S]{0,400}>6</);
  });

  it("marks Missing UAN as excluded from Total Blocked", () => {
    const html = render(<PayrollBlockersPanel data={data(PAYROLL)} />);

    expect(html).toContain("not counted in Total Blocked");
  });

  it("separates a PAN that will be rejected from no PAN at all", () => {
    const html = render(<PayrollBlockersPanel data={data(PAYROLL)} />);

    // Seven employees hold values like CTRPC455K that no statutory filing will accept.
    // They were being counted as payroll-ready.
    expect(html).toContain("Invalid PAN Format");
    expect(html).toMatch(/Invalid PAN Format[\s\S]{0,400}>7</);
  });

  it("shows that Total Blocked covers only bank and PAN", () => {
    const html = render(<PayrollBlockersPanel data={data(PAYROLL)} />);

    expect(html).toContain("Missing bank or PAN past the grace window");
  });
});

// ─── Onboarding pipeline ──────────────────────────────────────────────────────
// Live: 517 bridge rows. pending 28, pendingBeforeCutoff 433, submitted 3, joined 7,
// stuck 0 (the status is never written), otpVerified 100 (a different population).
const ONBOARDING = {
  onb: {
    value: 31,
    available: true,
    detail: {
      total: 517, submitted: 3, pending: 28, pendingBeforeCutoff: 433,
      pendingRaw: 507, pendingAlreadyJoined: 27, pendingClosedCandidate: 6,
      pendingNonCandidate: 15, staleNotActionable: 48, stuck: 0,
      joined: 7, otpVerified: 100,
    },
  },
};

describe("OnboardingFunnelPanel", () => {
  it("headlines the actionable count, not the all-time bridge total", () => {
    const html = render(<OnboardingFunnelPanel data={data(ONBOARDING)} />);

    // "517 candidates" over rows summing to 38 is what made the funnel unreadable.
    expect(html).not.toContain("517 candidates");
    expect(html).toContain("28 actionable of 517");
  });

  it("shows the pre-cutoff backlog that is filtered out of Pending", () => {
    const html = render(<OnboardingFunnelPanel data={data(ONBOARDING)} />);

    expect(html).toContain("Raised before the 25-Aug-2026 pendency cutoff");
    expect(html).toMatch(/Raised before the 25-Aug-2026 pendency cutoff[\s\S]{0,400}>433</);
  });

  it("shows the already-joined bridge rows that were never advanced", () => {
    const html = render(<OnboardingFunnelPanel data={data(ONBOARDING)} />);

    expect(html).toContain("Converted but still marked pending");
  });

  it("hides the Stuck row when the status is never written", () => {
    const html = render(<OnboardingFunnelPanel data={data(ONBOARDING)} />);

    // ats_onboarding_bridge.status only ever holds pending / profile_submitted / joined.
    expect(html).not.toContain("Beyond the ageing threshold");
  });

  it("does not present OTP Verified as a stage of this funnel", () => {
    const html = render(<OnboardingFunnelPanel data={data(ONBOARDING)} />);

    // 100 counts every candidate_onboarding_profile ever, not the 517 bridge rows.
    expect(html).toContain("All candidate profiles, not only the rows above");
  });
});

// ─── Document compliance ──────────────────────────────────────────────────────
// Live: 1,120 active · 20 with any document · 500 documents · 487 flagged verified,
// of which only a handful carry a verification_date.
const DOCS = {
  docCompliance: {
    value: 1100,
    available: true,
    detail: {
      activeEmployees: 1120, employeesWithNoDocs: 1100, employeesWithDocs: 20,
      totalDocs: 500, verifiedDocs: 487, unverifiedDocs: 13,
      verifiedWithEvidence: 2, coveragePct: 1.8,
    },
  },
};

describe("DocumentCompliancePanel", () => {
  it("qualifies the verified count with how many carry verification evidence", () => {
    const html = render(<DocumentCompliancePanel data={data(DOCS)} />);

    expect(html).toContain("2 carry a verification date");
  });
});
