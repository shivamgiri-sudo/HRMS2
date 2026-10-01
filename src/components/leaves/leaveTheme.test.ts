import { describe, expect, it } from "vitest";
import { CHART_TOKEN_COUNT, leaveTypeChartVar, leaveTypeToken } from "./leaveTheme";

describe("leaveTypeToken", () => {
  it("is stable: the same type always gets the same token", () => {
    expect(leaveTypeToken("Casual Leave")).toBe(leaveTypeToken("Casual Leave"));
    expect(leaveTypeToken("Some New Type")).toBe(leaveTypeToken("Some New Type"));
  });

  it("always lands inside the theme's chart palette", () => {
    for (const name of ["Casual Leave", "Earned Leave", "Medical Leave", "Unpaid Leave", "x", "", "Zzzzzz 99"]) {
      const n = leaveTypeToken(name);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(CHART_TOKEN_COUNT);
    }
  });

  it("maps the common types to distinct tokens", () => {
    const tokens = ["Casual Leave", "Earned Leave", "Medical Leave", "Unpaid Leave"].map(leaveTypeToken);
    expect(new Set(tokens).size).toBe(4);
  });

  it("matches on code or name, case-insensitively", () => {
    expect(leaveTypeToken("CL")).toBe(leaveTypeToken("casual leave"));
    expect(leaveTypeToken("EL")).toBe(leaveTypeToken("EARNED LEAVE"));
  });
});

describe("leaveTypeChartVar", () => {
  it("returns a theme variable reference, never a hard-coded colour", () => {
    const v = leaveTypeChartVar("Casual Leave");
    expect(v).toMatch(/^hsl\(var\(--chart-[1-8]\)\)$/);
    expect(v).not.toMatch(/#|rgb/);
  });
});
