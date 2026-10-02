import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  sweepAuto: vi.fn(async () => ({ checked: 0, approved: 0 })),
  sweepEsc: vi.fn(async () => ({ candidates: 0, escalated: 0 })),
}));
vi.mock("../roster-requests.auto.js", () => ({ sweepAutoApprove: m.sweepAuto }));
vi.mock("../roster-requests.escalation.js", () => ({ runEscalationSweep: m.sweepEsc }));

import {
  AUTO_APPROVE_INTERVAL_MS,
  ESCALATION_INTERVAL_MS,
  runAutoApproveTick,
  startRosterRequestsScheduler,
  stopRosterRequestsScheduler,
} from "../roster-requests.cron.js";

describe("roster-requests cron", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    delete process.env.ROSTER_REQUESTS_CRON_ENABLED;
  });
  afterEach(() => {
    stopRosterRequestsScheduler();
    vi.useRealTimers();
    delete process.env.ROSTER_REQUESTS_CRON_ENABLED;
  });

  it("uses 5-minute auto-approve and 30-minute escalation intervals", () => {
    expect(AUTO_APPROVE_INTERVAL_MS).toBe(5 * 60 * 1000);
    expect(ESCALATION_INTERVAL_MS).toBe(30 * 60 * 1000);
  });

  it("is a no-op unless ROSTER_REQUESTS_CRON_ENABLED=true", async () => {
    startRosterRequestsScheduler();
    await vi.advanceTimersByTimeAsync(ESCALATION_INTERVAL_MS);
    expect(m.sweepAuto).not.toHaveBeenCalled();
    expect(m.sweepEsc).not.toHaveBeenCalled();
  });

  it("runs both sweeps on their intervals when enabled, and starting twice does not double them", async () => {
    process.env.ROSTER_REQUESTS_CRON_ENABLED = "true";
    startRosterRequestsScheduler();
    startRosterRequestsScheduler();
    await vi.advanceTimersByTimeAsync(ESCALATION_INTERVAL_MS);
    expect(m.sweepAuto).toHaveBeenCalledTimes(6);
    expect(m.sweepEsc).toHaveBeenCalledTimes(1);
  });

  it("does not overlap a still-running sweep, and swallows its errors", async () => {
    let release!: () => void;
    m.sweepAuto.mockImplementationOnce(() => new Promise((r) => { release = () => r({ checked: 0, approved: 0 }); }));
    const first = runAutoApproveTick();
    await runAutoApproveTick();
    expect(m.sweepAuto).toHaveBeenCalledTimes(1);
    release();
    await first;
    m.sweepAuto.mockRejectedValueOnce(new Error("db down"));
    await expect(runAutoApproveTick()).resolves.toBeUndefined();
  });
});
