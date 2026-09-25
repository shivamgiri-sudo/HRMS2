import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

const {
  getNeverReported,
  resetExistingRowsCacheForTests,
  warmFeedHealthCache,
  startFeedHealthCacheWarmer,
  stopFeedHealthCacheWarmer,
} = await import("../feed-health.service.js");

const neverReportedRow = (i: number) => ({
  process_id: `p${i}`,
  process_name: `Process ${i}`,
  metric_code: `METRIC_${i}`,
  metric_name: `Metric ${i}`,
  source_object: `src_table_${i}`,
  process_key_kind: "constant",
  process_key_column: null,
  process_key_value: null,
  employee_key_column: null,
  employee_key_kind: null,
  upload_type_code: `UP_${i}`,
  upload_type_name: `Upload ${i}`,
});

describe("feed-health cache warmer", () => {
  beforeEach(() => {
    execute.mockReset();
    resetExistingRowsCacheForTests();
  });

  afterEach(() => {
    stopFeedHealthCacheWarmer();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("warming fills the cache, so the next page load skips every source-table count", async () => {
    execute.mockResolvedValueOnce([[{ id: "p1" }, { id: "p2" }]]);
    execute.mockResolvedValueOnce([[neverReportedRow(1), neverReportedRow(2)]]);
    execute.mockResolvedValue([[{ n: 9 }]]);

    await warmFeedHealthCache();
    expect(execute).toHaveBeenCalledTimes(1 + 1 + 2);

    execute.mockReset();
    execute.mockResolvedValueOnce([[neverReportedRow(1), neverReportedRow(2)]]);
    const result = await getNeverReported(new Set(["p1", "p2"]));

    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.every((g) => g.existingSourceRows === 9)).toBe(true);
  });

  it("warms only active processes", async () => {
    execute.mockResolvedValueOnce([[]]);
    await warmFeedHealthCache();
    const sql = String(execute.mock.calls[0][0]);
    expect(sql).toMatch(/FROM process_master/);
    expect(sql).toMatch(/active_status = 1/);
  });

  it("a failing warm-up is logged and swallowed, never thrown into the server", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    execute.mockRejectedValue(new Error("db down"));

    startFeedHealthCacheWarmer();
    await vi.advanceTimersByTimeAsync(0);

    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0][0])).toContain("[feed-health]");
  });

  it("refreshes before the 10 minute cache expiry and can be stopped", async () => {
    vi.useFakeTimers();
    execute.mockResolvedValue([[]]);

    startFeedHealthCacheWarmer();
    startFeedHealthCacheWarmer(); // second start must not add a second timer
    await vi.advanceTimersByTimeAsync(0);
    const afterFirst = execute.mock.calls.length;
    expect(afterFirst).toBe(1);

    await vi.advanceTimersByTimeAsync(9 * 60 * 1000 + 1);
    expect(execute.mock.calls.length).toBe(2);

    stopFeedHealthCacheWarmer();
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(execute.mock.calls.length).toBe(2);
  });
});
