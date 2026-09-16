import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../logger.js", () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock("../worker-utils.js", () => ({ registerTimer: vi.fn(), unregisterTimer: vi.fn(), withWorkerLock: vi.fn(async (_name: string, fn: () => Promise<void>) => { await fn(); return true; }) }));
vi.mock("../../shared/istDate.js", () => ({ getCurrentDateIST: () => "2026-09-16" }));

const { refreshRunningSalarySnapshot } = vi.hoisted(() => ({ refreshRunningSalarySnapshot: vi.fn() }));
vi.mock("../../modules/process-pnl/pnl-running-salary.service.js", () => ({ refreshRunningSalarySnapshot }));

import {
  startPnlRunningSalaryRefreshWorker, stopPnlRunningSalaryRefreshWorker, windowPeriods,
} from "../pnl-running-salary-refresh.worker.js";

describe("pnl-running-salary-refresh window", () => {
  it("refreshes the open month and the one just behind it", () => {
    expect(windowPeriods("2026-09-16")).toEqual(["2026-08", "2026-09"]);
    expect(windowPeriods("2026-01-05")).toEqual(["2025-12", "2026-01"]);
  });
});

describe("pnl-running-salary-refresh scheduling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    refreshRunningSalarySnapshot.mockReset();
    refreshRunningSalarySnapshot.mockResolvedValue({ snapshotted: 1, skipped: 0, failed: 0 });
    delete process.env.PNL_RUNNING_SALARY_REFRESH_ENABLED;
    stopPnlRunningSalaryRefreshWorker();
  });

  it("does nothing when disabled", () => {
    process.env.PNL_RUNNING_SALARY_REFRESH_ENABLED = "false";
    startPnlRunningSalaryRefreshWorker();
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(refreshRunningSalarySnapshot).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("refreshes both months of the window 15 minutes after startup, company-wide (no branch filter)", async () => {
    startPnlRunningSalaryRefreshWorker();
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    expect(refreshRunningSalarySnapshot).toHaveBeenCalledTimes(2);
    expect(refreshRunningSalarySnapshot.mock.calls.map((c) => c[0])).toEqual(["2026-08", "2026-09"]);
    // Called with just the period — no branchId/employeeId scoping, matches the manual refresh
    // that fixed September live: it ran for everyone, not one branch at a time.
    expect(refreshRunningSalarySnapshot.mock.calls.every((c) => c.length === 1)).toBe(true);
    vi.useRealTimers();
  });

  it("one month failing does not stop the other from running", async () => {
    refreshRunningSalarySnapshot.mockRejectedValueOnce(new Error("db down")).mockResolvedValueOnce({ snapshotted: 5, skipped: 0, failed: 0 });
    startPnlRunningSalaryRefreshWorker();
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    expect(refreshRunningSalarySnapshot).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("refreshes again every 4 hours", async () => {
    startPnlRunningSalaryRefreshWorker();
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    expect(refreshRunningSalarySnapshot).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000);
    expect(refreshRunningSalarySnapshot).toHaveBeenCalledTimes(4);
    vi.useRealTimers();
  });
});
