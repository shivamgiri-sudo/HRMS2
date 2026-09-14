import { describe, it, expect, beforeAll } from "vitest";
import { runStaticScan } from "../uat-static-scan.service.js";
import { buildImpactIndex } from "../uat-impact-index.js";
import type { ScanInput, StaticScanResult } from "../uat-pipeline.types.js";

/**
 * The registry must evolve from actual failures, not from theoretical categories. Every
 * fixture below is a REAL defect this codebase has already suffered. Each asserts that the
 * risk model would have classified the report correctly — that a reporter describing the
 * symptom, in the words a reporter would actually use, lands in the right place.
 *
 * When a defect escapes the pipeline in future, it gets a fixture here. That is the
 * mechanism by which the registry gets better rather than just older.
 */

function scan(partial: Partial<ScanInput> & { title: string; text: string }): StaticScanResult {
  return runStaticScan({
    feedbackId: "fixture",
    pageRoute: null,
    pageCode: null,
    moduleHint: null,
    apiPathHint: null,
    ...partial,
  });
}

beforeAll(() => {
  // Build once; the index walks ~2,400 source files.
  buildImpactIndex(true);
}, 120_000);

describe("historical defects — the risk model would have caught these", () => {
  it("malformed holiday date range zeroing payable days -> deny", () => {
    // Real: a malformed holiday range always evaluated to 0, so P&L payable days diverged
    // from payroll's. Reported as a reporting discrepancy; actually attendance feeding pay.
    const r = scan({
      title: "P&L payable days do not match payroll",
      text: "The payable days figure in the P&L report is different from what payroll calculated for the same month. Looks like holidays and week-offs are not counted the same way.",
    });
    expect(r.effectiveRisk).toBe("deny");
    expect(r.capabilityHits.map((h) => h.capabilityKey)).toContain("payroll_calculation");
  });

  it("CLOSED_RUN_STATUSES mismatch hiding finalized payroll runs -> deny", () => {
    const r = scan({
      title: "Finalized payroll runs still show as open",
      text: "A payroll run that has been finalized still appears in the open runs list, so we cannot close the month.",
    });
    expect(r.effectiveRisk).toBe("deny");
  });

  it("IST midnight punches rejected as hour 24 -> deny via attendance", () => {
    // Real: hour12:false rendered 00:xx as "24:xx" on the server's node build, so midnight
    // punches were rejected outright.
    const r = scan({
      title: "Night shift punches at midnight are rejected",
      text: "Employees on the night shift punch in at 00:05 and the system rejects the punch as an invalid time.",
    });
    expect(r.effectiveRisk).toBe("deny");
    expect(r.capabilityHits.map((h) => h.capabilityKey)).toContain("attendance_classification");
  });

  it("branch role union failing open on access checks -> deny via auth", () => {
    const r = scan({
      title: "Branch admin can see other branches",
      text: "A user with branch admin permission for one branch is able to open the employee list for a different branch.",
    });
    expect(r.effectiveRisk).toBe("deny");
    expect(r.capabilityHits.map((h) => h.capabilityKey)).toContain("auth_rbac");
  });

  it("LMS mapper saving silently -> review, and never auto-built", () => {
    const r = scan({
      title: "LMS course completion not reflected against the employee",
      text: "A trainee finished the course in the LMS but the certification status against the employee record never updated.",
    });
    expect(["review", "deny"]).toContain(r.effectiveRisk);
    expect(r.capabilityHits.map((h) => h.capabilityKey)).toContain("lms_owned");
  });
});

describe("the case a path-only model misses", () => {
  it("leave carry-forward is HIGH_REVIEW via capability with NO deny-tier path hit", () => {
    // This is the whole argument for the second dimension. Nothing under a protected path
    // is named, and a naive triager would call it a reporting bug.
    const r = scan({
      title: "Leave balance shows wrong carry forward",
      text: "My leave balance carried forward from last year is wrong. It shows 5 days but should be 8 days of earned leave.",
    });

    expect(
      r.protectedHits.filter((h) => h.tier === "deny"),
      "fixture is only meaningful if no deny-tier PATH matches"
    ).toEqual([]);

    expect(r.capabilityClass).toBe("HIGH_REVIEW");
    expect(r.effectiveRisk).toBe("review");
    expect(r.capabilityHits.map((h) => h.capabilityKey)).toContain("leave_entitlement");
    expect(r.requiredApproverRoles).toContain("UAT_DOMAIN_OWNER_HR");
  });

  it("roster week-off rules are HIGH_REVIEW even when reported as a display bug", () => {
    const r = scan({
      title: "Week off showing on the wrong day",
      text: "The roster shows my week off on Tuesday but it was published as Sunday.",
    });
    expect(r.capabilityClass).toBe("HIGH_REVIEW");
    expect(r.capabilityHits.map((h) => h.capabilityKey)).toContain("roster_shift");
  });
});

describe("ordinary requests are not over-blocked", () => {
  it("a tooltip request is trivial or standard, never blocked", () => {
    const r = scan({
      title: "Add a tooltip to the visitor form",
      text: "The purpose of visit field on the visitor form needs a tooltip explaining what to enter.",
    });
    expect(r.effectiveRisk).not.toBe("deny");
    expect(r.effectiveRisk).not.toBe("review");
  });

  it("a spelling correction is not blocked", () => {
    const r = scan({
      title: "Spelling mistake on the dashboard heading",
      text: "The heading says Depatment instead of Department.",
    });
    expect(r.effectiveRisk).not.toBe("deny");
  });
});

describe("a user's own labelling cannot lower the verdict", () => {
  it("a payroll bug mislabelled as cosmetic UI is still deny", () => {
    const r = scan({
      title: "Small display issue",
      text: "The PF deduction amount on the payslip is showing the wrong figure.",
      moduleHint: "visitor",          // user picked the wrong module
      pageRoute: "/visitor-management",
    });
    expect(r.effectiveRisk).toBe("deny");
    expect(r.capabilityHits.map((h) => h.capabilityKey)).toContain("payroll_calculation");
  });
});

describe("scan output is reproducible and explains itself", () => {
  it("records the sha of both control-plane files", () => {
    const r = scan({ title: "x", text: "y" });
    expect(r.pathsSha).toMatch(/^[0-9a-f]{64}$/);
    expect(r.registrySha).toMatch(/^[0-9a-f]{64}$/);
    expect(r.scannerVersion).toBeTruthy();
  });

  it("a blocked scan always explains why, naming the matched signal", () => {
    const r = scan({
      title: "Wrong gratuity calculation",
      text: "Gratuity paid on exit was calculated on the wrong number of years.",
    });
    expect(r.effectiveRisk).toBe("deny");
    expect(r.blockedReason, "a blocked request must tell the submitter why").toBeTruthy();
    expect(r.blockedReason!.length).toBeGreaterThan(20);
  });

  it("a non-blocked scan carries no blockedReason", () => {
    const r = scan({ title: "Tooltip please", text: "Add a tooltip to the label." });
    expect(r.blockedReason).toBeNull();
  });

  it("every capability hit names the concrete token that matched", () => {
    const r = scan({
      title: "Attendance wrong",
      text: "The biometric punch is not showing for yesterday.",
    });
    for (const h of r.capabilityHits) {
      expect(["path", "table", "keyword"]).toContain(h.signal);
      expect(h.matchedToken, `hit on ${h.capabilityKey} has no matched token`).toBeTruthy();
    }
  });
});
