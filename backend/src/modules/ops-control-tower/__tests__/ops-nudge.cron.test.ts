import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { sweep } = vi.hoisted(() => ({ sweep: vi.fn() }));
vi.mock('../ops-nudge.service.js', () => ({ runAutoNudgeSweep: sweep }));
vi.mock('../../../logger.js', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import { msUntilNextRun, runOpsNudgeTick, startOpsNudgeScheduler, stopOpsNudgeScheduler } from '../ops-nudge.cron.js';

beforeEach(() => { sweep.mockReset(); sweep.mockResolvedValue({}); vi.useFakeTimers(); });
afterEach(() => { stopOpsNudgeScheduler(); vi.useRealTimers(); });

describe('msUntilNextRun', () => {
  it('targets 10:00 today when before it, tomorrow when after', () => {
    expect(msUntilNextRun(new Date(2026, 9, 2, 9, 0, 0))).toBe(3600_000);
    expect(msUntilNextRun(new Date(2026, 9, 2, 10, 0, 0))).toBe(24 * 3600_000);
    expect(msUntilNextRun(new Date(2026, 9, 2, 11, 0, 0))).toBe(23 * 3600_000);
  });
});

describe('startOpsNudgeScheduler', () => {
  it('does nothing unless OPS_AUTO_NUDGE_ENABLED=true', async () => {
    startOpsNudgeScheduler({} as NodeJS.ProcessEnv);
    await vi.advanceTimersByTimeAsync(72 * 3600_000);
    expect(sweep).not.toHaveBeenCalled();
  });

  it('runs a sweep every 24h once enabled', async () => {
    vi.setSystemTime(new Date(2026, 9, 2, 9, 0, 0));
    startOpsNudgeScheduler({ OPS_AUTO_NUDGE_ENABLED: 'true' } as unknown as NodeJS.ProcessEnv);
    await vi.advanceTimersByTimeAsync(3600_000);
    expect(sweep).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(24 * 3600_000);
    expect(sweep).toHaveBeenCalledTimes(2);
  });

  it('is idempotent — a second start does not double the cadence', async () => {
    vi.setSystemTime(new Date(2026, 9, 2, 9, 0, 0));
    const env = { OPS_AUTO_NUDGE_ENABLED: 'true' } as unknown as NodeJS.ProcessEnv;
    startOpsNudgeScheduler(env); startOpsNudgeScheduler(env);
    await vi.advanceTimersByTimeAsync(3600_000);
    expect(sweep).toHaveBeenCalledTimes(1);
  });
});

describe('runOpsNudgeTick', () => {
  it('swallows sweep errors so the timer chain survives', async () => {
    sweep.mockRejectedValue(new Error('db down'));
    await expect(runOpsNudgeTick()).resolves.toBeUndefined();
  });
});
