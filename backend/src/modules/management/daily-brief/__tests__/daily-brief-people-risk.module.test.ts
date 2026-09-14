import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../../db/mysql.js", () => ({
  db: { execute, query: execute, getConnection: vi.fn() },
}));

import { buildPeopleRiskModule } from "../daily-brief-people-risk.module.js";

describe("daily-brief-people-risk: role gating", () => {
  beforeEach(() => {
    execute.mockReset();
  });

  it("returns empty / NOT_APPLICABLE for an out-of-scope role (it)", async () => {
    const result = await buildPeopleRiskModule(["e1", "e2"], "it", "2026-08-18");
    expect(result.applicable).toBe(false);
    expect(result.countRequiringAttention).toBeNull();
    expect(result.severity).toBeNull();
    expect(result.sourceHealth.state).toBe("NOT_APPLICABLE");
    // The query must never even run for an out-of-scope role.
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns empty / NOT_APPLICABLE for finance and recruiter roles too", async () => {
    const finance = await buildPeopleRiskModule(["e1"], "finance", "2026-08-18");
    const recruiter = await buildPeopleRiskModule(["e1"], "recruiter", "2026-08-18");
    expect(finance.applicable).toBe(false);
    expect(recruiter.applicable).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  it("is populated for a people-manager-adjacent role (branch_head)", async () => {
    execute.mockResolvedValue([[
      { risk_label: "attrition_risk" },
      { risk_label: "critical_people_risk" },
    ]]);

    const result = await buildPeopleRiskModule(["e1", "e2"], "branch_head", "2026-08-18");

    expect(result.applicable).toBe(true);
    expect(result.countRequiringAttention?.value).toBe(2);
    expect(result.severity).toBe("critical");
  });
});

describe("daily-brief-people-risk: never exposes score/band/driver text", () => {
  beforeEach(() => {
    execute.mockReset();
  });

  it("output contains no raw score, band label, or driver field anywhere", async () => {
    execute.mockResolvedValue([[
      { risk_label: "attrition_risk", engagement_score: 27, top_risk_drivers_json: '["low pay"]' },
    ]]);

    const result = await buildPeopleRiskModule(["e1"], "hr", "2026-08-18");

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("engagement_score");
    expect(serialized).not.toContain("attrition_risk");
    expect(serialized).not.toContain("critical_people_risk");
    expect(serialized).not.toContain("low pay");
    expect(serialized).not.toMatch(/"score"\s*:/);
    expect(serialized).not.toMatch(/"driver/i);
    // Only a safe generic label may appear.
    expect(result.actionLabel).toBe("Review in HRMS");
  });
});
