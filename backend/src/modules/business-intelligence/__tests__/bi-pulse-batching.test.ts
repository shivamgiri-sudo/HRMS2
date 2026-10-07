import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /api/bi/daily-operations-pulse and /api/bi/quality-intervention returned 502 on prod.
 *
 * Causes fixed here (results unchanged):
 *  - the pulse awaited its apr aggregate, the attendance counts, the top-process query and the
 *    policy lookups one after another; they are independent and now go out as one batch;
 *  - `DATE(a.ReportDate) = ?` wrapped a DATE column in a function, forcing a scan of apr
 *    instead of a primary-key lookup;
 *  - quality-intervention awaited four independent audit aggregates serially;
 *  - neither had a cache or in-flight de-duplication, so concurrent viewers each ran the
 *    whole bundle.
 */
const execute = vi.fn();
const querySource = vi.fn();

vi.mock("../../../db/mysql.js", () => ({
  db: { execute: (...a: unknown[]) => execute(...a) },
}));
vi.mock("../../../db/sourceDb.js", () => ({
  querySource: (...a: unknown[]) => querySource(...a),
}));
vi.mock("../../../db/legacyDb.js", () => ({ getLegacyPool: vi.fn() }));
vi.mock("../../policy-engine/policy-engine.cache.js", () => ({
  getPolicyValue: vi.fn(
    async (_d: string, _s: string, _k: string, fallback: string) => fallback,
  ),
}));
vi.mock("../../../lib/logger.js", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import {
  getDailyOpsPulse,
  getQualityIntervention,
  resetBiCacheForTest,
} from "../bi.service.js";

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("getDailyOpsPulse batching", () => {
  beforeEach(() => {
    execute.mockReset();
    resetBiCacheForTest();
  });

  it("issues every independent query before any of them resolves, with a sargable apr filter", async () => {
    const resolvers: Array<(v: unknown) => void> = [];
    execute.mockImplementation(
      (sql: string) =>
        new Promise((resolve) => {
          resolvers.push(() => {
            if (/AS agents_logged_in/.test(sql))
              return resolve([
                [
                  {
                    agents_logged_in: 10,
                    total_calls: 100,
                    avg_aht_seconds: 300,
                  },
                ],
              ]);
            if (/AS scheduled/.test(sql)) return resolve([[{ scheduled: 12 }]]);
            if (/AS baseline/.test(sql)) return resolve([[{ baseline: 12 }]]);
            return resolve([[{ name: "P1", calls: 60, agent_count: 4 }]]);
          });
        }),
    );

    const pending = getDailyOpsPulse("2026-09-28");
    await flush();
    // apr aggregate + scheduled + baseline + top process, all in flight at once.
    expect(execute).toHaveBeenCalledTimes(4);
    resolvers.forEach((r) => r(undefined));
    const data = await pending;

    const sqls = execute.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /DATE\(\s*a\.ReportDate\s*\)/.test(s))).toBe(false);
    expect(sqls.filter((s) => /a\.ReportDate = \?/.test(s))).toHaveLength(2);
    expect(data.agents_logged_in).toBe(10);
    expect(data.total_calls).toBe(100);
    expect(data.agents_scheduled).toBe(12);
    expect(data.top_process).toEqual({ name: "P1", calls: 60, agent_count: 4 });
  });

  it("shares one computation between concurrent identical requests", async () => {
    execute.mockResolvedValue([
      [{ agents_logged_in: 1, scheduled: 1, baseline: 1 }],
    ]);
    await Promise.all([
      getDailyOpsPulse("2026-09-28"),
      getDailyOpsPulse("2026-09-28"),
    ]);
    expect(execute).toHaveBeenCalledTimes(4);
  });
});

describe("getQualityIntervention batching", () => {
  beforeEach(() => {
    querySource.mockReset();
    resetBiCacheForTest();
  });

  it("starts all four audit aggregates together and de-duplicates concurrent callers", async () => {
    const gates: Array<() => void> = [];
    querySource.mockImplementation(
      (sql: string) =>
        new Promise((resolve) => {
          gates.push(() =>
            resolve(
              /AS total_agents/.test(sql)
                ? [{ avg_score: 80, total_agents: 6, below_threshold: 2 }]
                : [],
            ),
          );
        }),
    );

    const a = getQualityIntervention();
    const b = getQualityIntervention();
    await flush();
    expect(querySource).toHaveBeenCalledTimes(4);
    gates.forEach((g) => g());
    const [ra, rb] = await Promise.all([a, b]);
    expect(querySource).toHaveBeenCalledTimes(4);
    expect(ra.summary.avg_quality_score).toBe(80);
    expect(ra.summary.agents_below_threshold).toBe(2);
    expect(rb).toBe(ra);
  });
});
