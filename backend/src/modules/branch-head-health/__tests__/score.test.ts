import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.fn();
vi.mock("../../../db/mysql.js", () => ({ db: { execute: (...a: unknown[]) => execute(...a) } }));

import { computeScore } from "../score.js";
import { readTrend, writeSnapshot } from "../snapshot.js";

function report(over: Record<string, unknown> = {}) {
  return {
    overallStatus: "watch",
    raw: {
      shrinkage: { scheduled: 10, shrinkagePct: 5 },
      lateStats: { totalLate: 4 },
      headcount: { totalActive: 100, leftMtd: 2, exitsNotClosed: 1, mandateSeatsTotal: 100 },
      budget: { totalBudget: 1000, utilizationPct: 70 },
      grnStats: { unbudgeted: { count: 1 }, pendingOver3Days: 1 },
      offers: { offered: 10, joined: 8, conversionPct: 80 },
      regularization: { pending: 3, over3Days: 1 },
      leaveAging: { pending: 2, over3Days: 1 },
      ats: { slaBreaches: 1, slaTotal: 20 },
      ...over,
    },
  } as never;
}

describe("computeScore", () => {
  it("default weights sum to 100 in the specified order", () => {
    const r = computeScore(report());
    expect(r.pillars.map((p) => [p.key, p.weight])).toEqual([
      ["attendance", 25], ["people", 20], ["finance", 20], ["hiring", 15], ["compliance", 10], ["quality", 10],
    ]);
    expect(r.pillars.reduce((s, p) => s + p.weight, 0)).toBe(100);
  });

  it("returns only score, pillars, excluded", () => {
    expect(Object.keys(computeScore(report())).sort()).toEqual(["excluded", "pillars", "score"]);
  });

  it("excludes a pillar with no data and renormalises", () => {
    const r = computeScore(report({ shrinkage: { scheduled: 0, shrinkagePct: 0 } }));
    expect(r.excluded).toEqual(["attendance"]);
    expect(r.pillars.find((p) => p.key === "attendance")?.score).toBeNull();
    expect(r.score).toBeGreaterThan(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });

  it("all pillars null gives 0 except compliance which is never null", () => {
    const r = computeScore(report({
      shrinkage: { scheduled: 0 }, headcount: { totalActive: 0 }, budget: { totalBudget: 0 },
      offers: { offered: 0, conversionPct: null }, ats: { slaTotal: 0 },
      regularization: { over3Days: 0 }, leaveAging: { over3Days: 0 }, grnStats: { unbudgeted: { count: 0 }, pendingOver3Days: 0 },
    }));
    expect(r.excluded.sort()).toEqual(["attendance", "finance", "hiring", "people", "quality"]);
    expect(r.pillars.find((p) => p.key === "compliance")?.score).toBe(100);
  });

  it("returns 0 and every key excluded when every pillar is null (zero weight compliance)", () => {
    const w = { attendance: 1, people: 1, finance: 1, hiring: 1, compliance: 0, quality: 1 };
    const r = computeScore(report({
      shrinkage: { scheduled: 0 }, headcount: { totalActive: 0 }, budget: { totalBudget: 0 },
      offers: { offered: 0, conversionPct: null }, ats: { slaTotal: 0 },
    }), w);
    expect(r.score).toBe(0);
  });

  it("stays within 0..100 for extreme inputs", () => {
    const bad = computeScore(report({
      shrinkage: { scheduled: 10, shrinkagePct: 90 }, lateStats: { totalLate: 500 },
      headcount: { totalActive: 10, leftMtd: 10, exitsNotClosed: 99, mandateSeatsTotal: 1000 },
      budget: { totalBudget: 1, utilizationPct: 300 }, grnStats: { unbudgeted: { count: 99 }, pendingOver3Days: 99 },
      offers: { offered: 5, conversionPct: 0 }, regularization: { over3Days: 99 }, leaveAging: { over3Days: 99 },
      ats: { slaBreaches: 20, slaTotal: 20 },
    }));
    expect(bad.score).toBe(0);
    const good = computeScore(report({
      shrinkage: { scheduled: 10, shrinkagePct: 0 }, lateStats: { totalLate: 0 },
      headcount: { totalActive: 10, leftMtd: 0, exitsNotClosed: 0, mandateSeatsTotal: 10 },
      budget: { totalBudget: 1, utilizationPct: 10 }, grnStats: { unbudgeted: { count: 0 }, pendingOver3Days: 0 },
      offers: { offered: 5, conversionPct: 100 }, regularization: { over3Days: 0 }, leaveAging: { over3Days: 0 },
      ats: { slaBreaches: 0, slaTotal: 20 },
    }));
    expect(good.score).toBe(100);
  });

  it("finance bands: <=80 full, 95 -> 60, >95 -> 40", () => {
    const f = (u: number) => computeScore(report({ budget: { totalBudget: 1, utilizationPct: u }, grnStats: { unbudgeted: { count: 0 }, pendingOver3Days: 0 } }))
      .pillars.find((p) => p.key === "finance")?.score;
    expect(f(80)).toBe(100);
    expect(f(95)).toBe(60);
    expect(f(100)).toBe(40);
  });
});

describe("snapshot", () => {
  beforeEach(() => execute.mockReset());

  it("writeSnapshot upserts on (branch_id, snap_date)", async () => {
    execute.mockResolvedValue([{}]);
    await writeSnapshot("b1", "2026-10-15", 77.5, [{ key: "attendance", weight: 25, score: 80 }], { late: 3 });
    const [sql, params] = execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/INSERT INTO branch_health_snapshot/);
    expect(sql).toMatch(/ON DUPLICATE KEY UPDATE/);
    expect(params[1]).toBe("b1");
    expect(params[2]).toBe("2026-10-15");
    expect(params[3]).toBe(77.5);
    expect(JSON.parse(params[5] as string)).toEqual({ late: 3 });
  });

  it("readTrend returns ascending {date,value} with null for absent keys", async () => {
    execute.mockResolvedValue([[
      { snap_date: "2026-10-14", value: "3" },
      { snap_date: "2026-10-15", value: null },
    ]]);
    const out = await readTrend("b1", "late", 7);
    expect(out).toEqual([{ date: "2026-10-14", value: 3 }, { date: "2026-10-15", value: null }]);
    expect((execute.mock.calls[0] as [string])[0]).toMatch(/ORDER BY snap_date ASC/);
  });
});
