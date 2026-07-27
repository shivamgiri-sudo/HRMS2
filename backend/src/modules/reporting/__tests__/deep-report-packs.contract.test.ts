import { describe, expect, it } from "vitest";
import { REPORT_CATALOG } from "../report-catalog.js";
import {
  DEEP_REPORT_PACKS,
  resolveAllDeepReportPacks,
  type DeepReportPerspectiveType,
} from "../deep-report-packs.js";

const REQUIRED_PERSPECTIVES: DeepReportPerspectiveType[] = [
  "overview",
  "trend",
  "register",
  "exceptions",
  "reconciliation",
  "compliance",
];

const SAFE_IDENTIFIER = /^[A-Za-z0-9_]+$/;

describe("deep section report packs", () => {
  it("keeps the report centre limited to governed section packs", () => {
    expect(DEEP_REPORT_PACKS.length).toBeGreaterThanOrEqual(15);
    expect(DEEP_REPORT_PACKS.length).toBeLessThanOrEqual(24);
    expect(new Set(DEEP_REPORT_PACKS.map((pack) => pack.code)).size).toBe(DEEP_REPORT_PACKS.length);
  });

  it("provides every required analytical perspective exactly once", () => {
    for (const pack of DEEP_REPORT_PACKS) {
      const types = pack.perspectives.map((perspective) => perspective.type);
      expect(types.sort()).toEqual([...REQUIRED_PERSPECTIVES].sort());
      expect(new Set(types).size).toBe(REQUIRED_PERSPECTIVES.length);
    }
  });

  it("defines ownership, decisions, compliance and source evidence for every pack", () => {
    for (const pack of DEEP_REPORT_PACKS) {
      expect(pack.name.trim()).not.toBe("");
      expect(pack.description.trim()).not.toBe("");
      expect(pack.businessOwner.trim()).not.toBe("");
      expect(pack.viewRoles.length).toBeGreaterThan(0);
      expect(pack.exportRoles.length).toBeGreaterThan(0);
      expect(pack.decisionQuestions.length).toBeGreaterThanOrEqual(3);
      expect(pack.complianceControls.length).toBeGreaterThanOrEqual(3);
      expect(pack.sourceGroups.length).toBeGreaterThanOrEqual(3);
      expect(pack.relatedRoutes.length).toBeGreaterThan(0);
    }
  });

  it("uses only safe static source-table identifiers", () => {
    for (const pack of DEEP_REPORT_PACKS) {
      const groupKeys = pack.sourceGroups.map((group) => group.key);
      expect(new Set(groupKeys).size).toBe(groupKeys.length);
      for (const group of pack.sourceGroups) {
        expect(group.candidateTables.length).toBeGreaterThan(0);
        for (const table of group.candidateTables) {
          expect(table).toMatch(SAFE_IDENTIFIER);
        }
      }
    }
  });

  it("does not duplicate detailed report codes inside one perspective", () => {
    for (const pack of DEEP_REPORT_PACKS) {
      for (const perspective of pack.perspectives) {
        expect(new Set(perspective.reportCodes).size).toBe(perspective.reportCodes.length);
      }
    }
  });

  it("resolves existing report definitions and exposes planned gaps explicitly", () => {
    const knownCodes = new Set(REPORT_CATALOG.map((report) => report.code));
    const resolved = resolveAllDeepReportPacks();
    for (const pack of resolved) {
      for (const perspective of pack.perspectives) {
        for (const report of perspective.reports) expect(knownCodes.has(report.code)).toBe(true);
        for (const code of perspective.missingReportCodes) expect(knownCodes.has(code)).toBe(false);
      }
      const resolvedCount = new Set(
        pack.perspectives.flatMap((perspective) => perspective.reports.map((report) => report.code))
      ).size;
      const missingCount = new Set(pack.perspectives.flatMap((perspective) => perspective.missingReportCodes)).size;
      expect(pack.reportCount).toBe(resolvedCount);
      expect(pack.missingReportCount).toBe(missingCount);
    }
  });

  it("covers every major HRMS operating domain", () => {
    const requiredCodes = [
      "people-workforce",
      "recruitment-onboarding",
      "attendance-biometric",
      "leave-absence",
      "wfm-roster-breaks",
      "payroll-compensation",
      "statutory-tax",
      "exit-attrition",
      "finance-profitability",
      "operations-productivity",
      "quality-risk",
      "performance-career",
      "training-lms",
      "assets-it",
      "support-grievance",
      "documents-identity-privacy",
      "engagement-experience",
      "security-access-audit",
      "integration-data-quality",
      "visitor-workplace",
    ];
    expect(DEEP_REPORT_PACKS.map((pack) => pack.code).sort()).toEqual(requiredCodes.sort());
  });
});
