import { describe, expect, it } from "vitest";
import { cachedRoleInsights, registerInsightProvider } from "../index.js";
import type { InsightContext } from "../types.js";

const ctx = (userId: string): InsightContext => ({
  scope: { level: "ORG_ALL", branchIds: [], processIds: [], employeeIds: [], userId, role: "super_admin" },
  userId, roleKeys: ["super_admin"], canSeeFinance: true, today: "2026-10-02",
});

describe("progressive role insights", () => {
  it("answers within the first-paint budget with what is ready, reports the slow section as pending, then completes", async () => {
    registerInsightProvider("HR_DASHBOARD", async () => ({
      default: {
        sections: {
          fast: async () => ({ kpis: [{ key: "a", label: "A", value: 1 }] }),
          slow: async () => { await new Promise((r) => setTimeout(r, 3_200)); return { kpis: [{ key: "b", label: "B", value: 2 }] }; },
          broken: async () => { throw new Error("boom"); },
        },
      },
    }));
    const started = Date.now();
    const first = await cachedRoleInsights("HR_DASHBOARD", ctx("progressive-test"), true);
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(first.kpis.map((k) => k.key)).toEqual(["a"]);
    expect(first.pending).toEqual(["slow"]);
    expect(first.sectionErrors.broken).toBe("boom");

    await new Promise((r) => setTimeout(r, 1_200));
    const second = await cachedRoleInsights("HR_DASHBOARD", ctx("progressive-test"), true);
    expect(second.pending).toEqual([]);
    expect(second.kpis.map((k) => k.key)).toEqual(["a", "b"]);
  }, 15_000);
});
