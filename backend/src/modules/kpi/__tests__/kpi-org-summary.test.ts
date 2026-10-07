import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /api/kpi/org-summary?period=2026-09 returned 502 on prod.
 *
 *  - every query filtered `DATE_FORMAT(a.score_date, '%Y-%m') = ?`, which formats all ~82k rows of
 *    kpi_daily_actual before comparing and can never use an index on score_date. For a valid
 *    YYYY-MM it is exactly the half-open month range, which now replaces it;
 *  - the rollup, per-process and trend reads were awaited serially although independent;
 *  - concurrent viewers each recomputed the whole thing.
 */
const execute = vi.fn();
vi.mock("../../../db/mysql.js", () => ({
  db: { execute: (...a: unknown[]) => execute(...a) },
}));
vi.mock("../../../shared/apiResponse.js", () => ({
  logSourceFailure: vi.fn(() => ({})),
}));

import {
  getKpiOrgSummary,
  resetKpiOrgSummaryCacheForTest,
  scoreDateMonthPredicate,
} from "../kpi-org-summary.js";

const orgScope = {
  level: "ORG_ALL",
  branchIds: [],
  processIds: [],
  employeeIds: [],
  userId: "u",
  role: "admin",
} as any;
const flush = () => new Promise((r) => setTimeout(r, 0));

function answer(sql: string): unknown[] {
  if (/GROUP BY m\.id/.test(sql)) {
    return [
      [
        {
          metric_code: "QA_SCORE",
          metric_name: "QA",
          unit: "percent",
          direction: "higher_is_better",
          avg_value: 80,
          employees: 3,
          samples: 30,
        },
      ],
    ];
  }
  if (/AS org_avg_score/.test(sql))
    return [[{ org_avg_score: 80, sample_count: 30 }]];
  if (/AS label/.test(sql))
    return [[{ label: "P1", avg_score: 80, agents: 3 }]];
  if (/AS period/.test(sql)) return [[{ period: "2026-09", avg_score: 80 }]];
  return [[]];
}

describe("scoreDateMonthPredicate", () => {
  it("turns a valid month into a half-open date range", () => {
    expect(scoreDateMonthPredicate("2026-09")).toEqual({
      sql: "(a.score_date >= ? AND a.score_date < ?)",
      params: ["2026-09-01", "2026-10-01"],
    });
  });
  it("rolls December into January of the next year", () => {
    expect(scoreDateMonthPredicate("2026-12").params).toEqual([
      "2026-12-01",
      "2027-01-01",
    ]);
  });
  it("keeps the original DATE_FORMAT comparison for anything that is not YYYY-MM", () => {
    for (const bad of ["2026-9", "2026-13", "abc", "2026-09-01", ""]) {
      expect(scoreDateMonthPredicate(bad)).toEqual({
        sql: "DATE_FORMAT(a.score_date, '%Y-%m') = ?",
        params: [bad],
      });
    }
  });
});

describe("getKpiOrgSummary", () => {
  beforeEach(() => {
    execute.mockReset();
    resetKpiOrgSummaryCacheForTest();
  });

  it("uses the month range and issues the three headline reads together", async () => {
    const gates: Array<() => void> = [];
    execute.mockImplementation(
      (sql: string) =>
        new Promise((resolve) => {
          gates.push(() => resolve(answer(sql)));
        }),
    );

    const pending = getKpiOrgSummary("2026-09", orgScope);
    await flush();
    expect(execute).toHaveBeenCalledTimes(1); // by_metric decides the headline first
    gates.splice(0).forEach((g) => g());
    await flush();
    expect(execute).toHaveBeenCalledTimes(4); // rollup + by_process + trend, all in flight
    gates.splice(0).forEach((g) => g());
    const data: any = await pending;

    const sqls = execute.mock.calls.map((c) => String(c[0]));
    const monthFiltered = sqls.filter((s) => !/AS period/.test(s));
    expect(monthFiltered).toHaveLength(3);
    for (const s of monthFiltered)
      expect(s).not.toMatch(/DATE_FORMAT\(a\.score_date, '%Y-%m'\) = \?/);
    expect(execute.mock.calls[0]![1]).toEqual(["2026-09-01", "2026-10-01"]);
    expect(data.period).toBe("2026-09");
    expect(data.summary).toMatchObject({
      org_avg_score: 80,
      metric_code: "QA_SCORE",
      metric_unit: "percent",
    });
    expect(data.by_process).toEqual([
      { label: "P1", avg_score: 80, agents: 3 },
    ]);
    expect(data.trend).toEqual([{ period: "2026-09", avg_score: 80 }]);
    expect(data.unavailableSources).toBeUndefined();
  });

  it("serves repeat callers within the window from one computation", async () => {
    execute.mockImplementation(async (sql: string) => answer(sql));
    await Promise.all([
      getKpiOrgSummary("2026-09", orgScope),
      getKpiOrgSummary("2026-09", orgScope),
    ]);
    const first = execute.mock.calls.length;
    await getKpiOrgSummary("2026-09", orgScope);
    expect(execute).toHaveBeenCalledTimes(first);
    await getKpiOrgSummary("2026-08", orgScope); // different period => different key
    expect(execute.mock.calls.length).toBeGreaterThan(first);
  });

  it("does not pin a partial result: a failed source is reported and recomputed next time", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (/AS label/.test(sql)) throw new Error("boom");
      return answer(sql);
    });
    const data: any = await getKpiOrgSummary("2026-09", orgScope);
    expect(data.unavailableSources.failedQueries).toEqual([
      "kpi org-summary by_process",
    ]);
    expect(data.by_process).toEqual([]);

    const calls = execute.mock.calls.length;
    await getKpiOrgSummary("2026-09", orgScope);
    expect(execute.mock.calls.length).toBeGreaterThan(calls);
  });
});
