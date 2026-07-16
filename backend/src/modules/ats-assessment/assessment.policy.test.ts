import { describe, expect, it, vi } from "vitest";
import {
  classifyExperience,
  getRemainingSeconds,
  normalizeAssessmentProcess,
  normalizeAssessmentRole,
} from "./assessment.service.js";

describe("assessment mapping policy", () => {
  it("normalizes supported process names without guessing unknown processes", () => {
    expect(normalizeAssessmentProcess("Inbound Customer Care")).toBe("inbound");
    expect(normalizeAssessmentProcess("Outbound Sales")).toBe("outbound");
    expect(normalizeAssessmentProcess("Back Office Data Entry")).toBe("backoffice");
    expect(normalizeAssessmentProcess("KYC Document Verification")).toBe("document");
    expect(normalizeAssessmentProcess("Email Support")).toBe("email");
    expect(normalizeAssessmentProcess("Team Leader")).toBeNull();
    expect(normalizeAssessmentProcess("Unknown Specialist Process")).toBeNull();
  });

  it("normalizes role levels conservatively", () => {
    expect(normalizeAssessmentRole("Executive")).toBe("executive");
    expect(normalizeAssessmentRole("Team Leader - Operations")).toBe("team_leader");
    expect(normalizeAssessmentRole("Quality Auditor")).toBe("quality_auditor");
  });

  it("classifies fresher and experienced candidates", () => {
    expect(classifyExperience("Fresher")).toBe("fresher");
    expect(classifyExperience("0-1 Year")).toBe("fresher");
    expect(classifyExperience("2-3 Years")).toBe("experienced");
  });

  it("calculates remaining assessment time only for an active attempt", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T10:00:00.000Z"));
    expect(getRemainingSeconds({ status: "in_progress", expires_at: "2026-07-16T10:05:00.000Z" })).toBe(300);
    expect(getRemainingSeconds({ status: "assigned", expires_at: "2026-07-16T10:05:00.000Z" })).toBeNull();
    expect(getRemainingSeconds({ status: "in_progress", expires_at: "2026-07-16T09:59:00.000Z" })).toBe(0);
    vi.useRealTimers();
  });
});
