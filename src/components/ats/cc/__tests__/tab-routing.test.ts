import { describe, expect, it } from "vitest";
import { COMMAND_CENTER_V2_ROLES, toTab } from "@/pages/NativeATSCommandCenterV2";

describe("Command Center tab routing", () => {
  it("opens Pulse by default and for unknown names", () => {
    expect(toTab(null)).toBe("pulse");
    expect(toTab("nonsense")).toBe("pulse");
  });

  it("accepts the new tab ids in any case", () => {
    expect(toTab("live")).toBe("live");
    expect(toTab("OUTCOMES")).toBe("outcomes");
  });

  it("sends each old tab name to the tab that now holds its content", () => {
    const expected: Record<string, string> = {
      Cover: "pulse", Dashboard: "pulse", Trends: "pulse", Insights: "pulse",
      Rejections: "outcomes", Recruiters: "sourcing", Sourcing: "sourcing",
      "Live Queue": "live", "Branch Activity": "live", Journey: "controls", Health: "controls", BMI: "controls",
    };
    for (const [old, now] of Object.entries(expected)) expect(toTab(old)).toBe(now);
  });

  it("serves the new page only to the roles the cached aggregates allow", () => {
    expect([...COMMAND_CENTER_V2_ROLES].sort()).toEqual(["admin", "ceo", "hr", "manager", "super_admin"]);
  });
});
