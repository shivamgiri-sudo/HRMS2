import { describe, it, expect, vi } from "vitest";

vi.mock("../src/db/mysql.js", () => ({ db: { execute: vi.fn().mockResolvedValue([[], []]) } }));

import { portalKpiService } from "../src/modules/portal/portal.kpi.service.js";

describe("portalKpiService.computeAchievement", () => {
  it("higher_is_better: actual/target * 100", () => {
    expect(portalKpiService.computeAchievement(90, 100, "higher_is_better")).toBe(90);
  });
  it("lower_is_better: target/actual * 100, capped at 120", () => {
    expect(portalKpiService.computeAchievement(200, 250, "lower_is_better")).toBe(120);
  });
  it("caps at 120%", () => {
    expect(portalKpiService.computeAchievement(150, 100, "higher_is_better")).toBe(120);
  });
});

describe("portalKpiService.ragFromAchievement", () => {
  it("green at 100%", () => expect(portalKpiService.ragFromAchievement(100)).toBe("green"));
  it("amber at 85%", () => expect(portalKpiService.ragFromAchievement(85)).toBe("amber"));
  it("red at 84%", () => expect(portalKpiService.ragFromAchievement(84)).toBe("red"));
});
