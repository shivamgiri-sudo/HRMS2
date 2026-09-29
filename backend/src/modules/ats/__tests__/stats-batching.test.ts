import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /api/ats/stats returned 502 on prod.
 *
 *  - getDashboardStats awaited nine independent reads one after another, including a separate
 *    COUNT(*) over exactly the rows its per-stage GROUP BY had just counted;
 *  - getEmployeeMobileJoinMap (a ~6s GROUP BY over employees) had a 15-minute cache but no
 *    in-flight de-duplication, so every request arriving while it was rebuilding started its
 *    own copy.
 * Results are unchanged: total_candidates is the sum of the stage counts, everything else is
 * the same statements issued together.
 */
const execute = vi.fn();
vi.mock("../../../db/mysql.js", () => ({ db: { execute: (...a: unknown[]) => execute(...a) } }));

import { atsService } from "../ats.service.js";
import {
  getEmployeeMobileJoinMap,
  resetEmployeeMobileJoinMapCacheForTest,
} from "../analytics.unified.service.js";

const flush = () => new Promise((r) => setTimeout(r, 0));

function answer(sql: string): unknown[] {
  if (/GROUP BY current_stage/.test(sql)) {
    return [[
      { current_stage: "Applied", count: 5 },
      { current_stage: "converted", count: 2 },
      { current_stage: null, count: 3 },
    ]];
  }
  if (/GROUP BY sourcing_channel/.test(sql)) return [[{ sourcing_channel: "Walk-In", count: 10 }]];
  if (/SELECT current_stage, mobile, created_at/.test(sql)) {
    return [[
      { current_stage: "converted", mobile: null, created_at: "2026-01-01" },
      { current_stage: "Applied", mobile: "999", created_at: "2026-01-01" },
    ]];
  }
  if (/GROUP BY mobile/.test(sql)) return [[{ mobile: "999", doj: "2026-02-01" }]];
  if (/AVG\(DATEDIFF/.test(sql)) return [[{ avg_days: "4" }]];
  if (/requested_headcount/.test(sql)) return [[{ count: 7 }]];
  if (/COUNT\(\*\) AS cnt/.test(sql)) return [[{ cnt: 1 }]];
  return [[]];
}

describe("atsService.getDashboardStats", () => {
  beforeEach(() => {
    execute.mockReset();
    resetEmployeeMobileJoinMapCacheForTest();
  });

  it("starts every read together and derives the total from the stage counts", async () => {
    const gates: Array<() => void> = [];
    execute.mockImplementation((sql: string) => new Promise((resolve) => { gates.push(() => resolve(answer(sql))); }));

    const pending = atsService.getDashboardStats({});
    await flush();
    // stage, source, candidate rows, employee-mobile map, time-to-hire, open positions,
    // previous selected, previous submitted, pending requisitions.
    expect(execute).toHaveBeenCalledTimes(9);
    gates.forEach((g) => g());
    const out = await pending;

    const sqls = execute.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /COUNT\(\*\) AS total\b/.test(s))).toBe(false);
    expect(out.total_candidates).toBe(10);                 // 5 + 2 + 3 (NULL-stage group included)
    expect(out.by_stage).toMatchObject({ Applied: 5, converted: 2 });
    expect(out.by_source).toEqual({ "Walk-In": 10 });
    // one stage-converted candidate + one identity-matched (mobile 999 joined after applying)
    expect(out.conversion_rate).toBe(20);
    expect(out.time_to_hire_avg).toBe(4);
    expect(out.open_positions).toBe(7);
    expect(out.previous_selected).toBe(1);
    expect(out.pending_requisitions).toBe(1);
  });
});

describe("getEmployeeMobileJoinMap in-flight de-duplication", () => {
  beforeEach(() => {
    execute.mockReset();
    resetEmployeeMobileJoinMapCacheForTest();
  });

  it("runs one GROUP BY for concurrent callers on a cold cache, then serves from cache", async () => {
    let release: () => void = () => undefined;
    execute.mockImplementation(() => new Promise((resolve) => {
      release = () => resolve([[{ mobile: "1", doj: "2026-01-01" }]]);
    }));

    const [a, b, c] = [getEmployeeMobileJoinMap(), getEmployeeMobileJoinMap(), getEmployeeMobileJoinMap()];
    await flush();
    expect(execute).toHaveBeenCalledTimes(1);
    release();
    const maps = await Promise.all([a, b, c]);
    expect(maps[0]).toBe(maps[1]);
    expect(maps[0].get("1")).toBe("2026-01-01");

    await getEmployeeMobileJoinMap();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("does not poison later callers when a build fails", async () => {
    execute.mockRejectedValueOnce(new Error("boom"));
    await expect(getEmployeeMobileJoinMap()).rejects.toThrow("boom");
    execute.mockResolvedValueOnce([[{ mobile: "2", doj: "2026-03-01" }]]);
    const map = await getEmployeeMobileJoinMap();
    expect(map.get("2")).toBe("2026-03-01");
  });
});
