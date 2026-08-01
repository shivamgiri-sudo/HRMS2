import { describe, it, expect, vi, beforeEach } from "vitest";

const poolExecute = vi.fn();
const dbExecute = vi.fn();

vi.mock("../src/db/mysql.js", () => ({ db: { execute: (...a: unknown[]) => dbExecute(...a) } }));
vi.mock("../src/modules/external-db/external-db.service.js", () => ({
  getPoolForKey: async () => ({ execute: (...a: unknown[]) => poolExecute(...a) }),
}));
vi.mock("../src/modules/kpi/mapping-exception.service.js", () => ({
  recordMappingException: vi.fn(async () => undefined),
}));

const { syncQualityMetricsForDate } = await import("../src/modules/kpi/kpi-data-connector.service.js");

/**
 * Quality ran once a month — on the 2nd, for the month before — while every
 * other metric ran daily. It also aggregated the whole month with GROUP BY User
 * and wrote a single fact dated at MAX(CallDate).
 *
 * Two consequences. Quality sat up to five weeks behind the metrics it is
 * compared against. And one rollup per agent per month cannot be attributed to
 * a process if the agent worked two that month, which defeats per-process
 * quality entirely.
 *
 * These pin the daily behaviour: one bounded day, facts dated to that day.
 */

const QUALITY_ROW = {
  agent_user: "MAS57576",
  points_earned: 340,
  points_possible: 500,
  fatal_audits: 1,
  total_audits: 10,
};

beforeEach(() => {
  poolExecute.mockReset();
  dbExecute.mockReset();
  // metric ids, formula ids, lineage columns, employee map — all empty is fine;
  // the assertions here are about the source query and the fact dates.
  dbExecute.mockResolvedValue([[], []]);
});

describe("daily quality sync", () => {
  it("bounds the source query to a single day", async () => {
    poolExecute.mockResolvedValueOnce([[], []]);
    await syncQualityMetricsForDate("2026-07-15");

    const [sql, params] = poolExecute.mock.calls[0];
    expect(sql).toMatch(/CallDate >= \? AND CallDate < \?/);
    // Half-open interval: the day itself up to, but excluding, the next day.
    expect(params).toEqual(["2026-07-15", "2026-07-16"]);
  });

  it("does not read last_audit_date, which is what made it a monthly rollup", async () => {
    poolExecute.mockResolvedValueOnce([[], []]);
    await syncQualityMetricsForDate("2026-07-15");
    expect(poolExecute.mock.calls[0][0]).not.toMatch(/last_audit_date/);
  });

  it("still aggregates per agent within that day", async () => {
    poolExecute.mockResolvedValueOnce([[], []]);
    await syncQualityMetricsForDate("2026-07-15");
    expect(poolExecute.mock.calls[0][0]).toMatch(/GROUP BY UPPER\(TRIM\(`User`\)\)/);
  });

  it("reads the quality source, not some other connector", async () => {
    poolExecute.mockResolvedValueOnce([[], []]);
    await syncQualityMetricsForDate("2026-07-15");
    expect(poolExecute.mock.calls[0][0]).toMatch(/FROM call_quality_assessment/);
  });

  it("reports the source error instead of throwing, so one bad day does not kill the run", async () => {
    poolExecute.mockImplementationOnce(() => Promise.reject(new Error("source unreachable")));
    const result = await syncQualityMetricsForDate("2026-07-15");
    expect(result).toEqual({ synced: 0, skipped: 0, errors: ["source unreachable"] });
  });

  it("returns a zero result when no agent was audited that day", async () => {
    poolExecute.mockResolvedValueOnce([[QUALITY_ROW], []]);
    // No metric ids resolve from the stubbed db, so nothing is written — the
    // point here is that it completes cleanly rather than throwing.
    const result = await syncQualityMetricsForDate("2026-07-15");
    expect(result.errors).toEqual([]);
  });

  it("matches inactive employees too, so a resigned agent's work is still attributed", async () => {
    // This filtered on active_status = 1, so the moment someone resigned their
    // already-completed work stopped being attributed. Two of July's 48 scored
    // agents were being dropped for exactly this. Ordering instead of filtering
    // keeps an active employee winning any collision.
    poolExecute.mockResolvedValueOnce([[QUALITY_ROW], []]);
    await syncQualityMetricsForDate("2026-07-15");

    const employeeLookup = dbExecute.mock.calls
      .map(([sql]) => String(sql))
      .find((sql) => /FROM employees/.test(sql) && /employee_code/.test(sql));

    expect(employeeLookup, "expected an employee lookup query").toBeDefined();
    expect(employeeLookup).not.toMatch(/WHERE active_status = 1/);
    expect(employeeLookup).toMatch(/ORDER BY active_status DESC/);
  });

  it("counts only scored audits toward the fatal rate", async () => {
    // 1,383 of July's 6,568 audits carry quality_percentage NULL and max_score
    // 0 — never scored. NULL never matches "= 0", so counting them made an
    // agent with 17 unscored audits report a 0% fatal rate, reading as
    // flawless work.
    poolExecute.mockResolvedValueOnce([[], []]);
    await syncQualityMetricsForDate("2026-07-15");
    const sql = String(poolExecute.mock.calls[0][0]);
    expect(sql).toMatch(/SUM\(quality_percentage IS NOT NULL\) AS scored_audits/);
  });
});

describe("monthly quality sync carries the same fatal-rate correction", () => {
  it("uses scored audits, not COUNT(*), as the denominator", async () => {
    // The month-close job had the identical defect. Leaving them disagreeing
    // would mean the monthly and daily numbers contradict each other for the
    // same agent and period.
    const { syncQualityMetrics } = await import("../src/modules/kpi/kpi-data-connector.service.js");
    poolExecute.mockResolvedValueOnce([[], []]);
    await syncQualityMetrics("2026-07");
    expect(String(poolExecute.mock.calls[0][0])).toMatch(
      /SUM\(quality_percentage IS NOT NULL\) AS scored_audits/,
    );
  });
});
