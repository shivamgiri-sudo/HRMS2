import { describe, it, expect } from "vitest";
import { createExitRequestSchema } from "../exit.validation.js";

const base = {
  employeeId: "11111111-1111-1111-1111-111111111111",
  exitDate: "2026-09-22",
  exitType: "voluntary" as const,
};

describe("exitReasonCategory enum", () => {
  it("accepts every code in the frontend REASON_CATEGORIES list", () => {
    const codes = [
      "better_opportunity",
      "career_growth",
      "compensation",
      "relocation",
      "health_personal",
      "family_reasons",
      "higher_education",
      "work_environment",
      "dissatisfaction_management",
      "entrepreneurship",
      "performance_action",
      "termination_misconduct",
      "absconding",
      "contract_end",
      "other",
    ];
    for (const exitReasonCategory of codes) {
      const parsed = createExitRequestSchema.parse({ ...base, exitReasonCategory });
      expect(parsed.exitReasonCategory).toBe(exitReasonCategory);
    }
  });

  it("accepts a null/omitted category", () => {
    expect(createExitRequestSchema.parse({ ...base }).exitReasonCategory).toBeNull();
    expect(
      createExitRequestSchema.parse({ ...base, exitReasonCategory: null }).exitReasonCategory,
    ).toBeNull();
  });

  it("rejects free-text values that are not a known category code", () => {
    expect(() =>
      createExitRequestSchema.parse({ ...base, exitReasonCategory: "Health Problem" }),
    ).toThrow();
    expect(() =>
      createExitRequestSchema.parse({ ...base, exitReasonCategory: "Absconded" }),
    ).toThrow();
    expect(() =>
      createExitRequestSchema.parse({ ...base, exitReasonCategory: "termination_performance" }),
    ).toThrow();
  });
});
