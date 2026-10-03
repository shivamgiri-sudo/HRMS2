import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
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

  it("runs by default when ROSTER_REQUESTS_CRON_ENABLED is unset", async () => {
    startRosterRequestsScheduler();
    await vi.advanceTimersByTimeAsync(ESCALATION_INTERVAL_MS);
    expect(m.sweepAuto).toHaveBeenCalledTimes(6);
    expect(m.sweepEsc).toHaveBeenCalledTimes(1);
  });

  it.each(["false", "FALSE", "0", "off", " Off "])("is a no-op when ROSTER_REQUESTS_CRON_ENABLED=%j", async (v) => {
    process.env.ROSTER_REQUESTS_CRON_ENABLED = v;
    startRosterRequestsScheduler();
    await vi.advanceTimersByTimeAsync(ESCALATION_INTERVAL_MS);
    expect(m.sweepAuto).not.toHaveBeenCalled();
    expect(m.sweepEsc).not.toHaveBeenCalled();
  });

  it.each(["true", "1", "yes", ""])("runs when ROSTER_REQUESTS_CRON_ENABLED=%j", async (v) => {
    process.env.ROSTER_REQUESTS_CRON_ENABLED = v;
    startRosterRequestsScheduler();
    await vi.advanceTimersByTimeAsync(AUTO_APPROVE_INTERVAL_MS);
    expect(m.sweepAuto).toHaveBeenCalledTimes(1);
  });

  it("runs both sweeps on their intervals, and starting twice does not double them", async () => {
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

describe("roster-requests cron registration", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
  const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
  const calls = (src: string) => src.match(/\bstartRosterRequestsScheduler\(\)/g)?.length ?? 0;

  it("is started once in the workers process and once in server.ts, only behind !WORKERS_EXTERNAL", () => {
    // Now that the cron is on by default, a second unguarded start would run it in both
    // hrms2-backend and hrms2-workers. server.ts may start it only for the single-process topology.
    const workers = read("src/workers/all-workers.ts");
    expect(calls(workers)).toBe(1);
    const server = read("src/server.ts");
    expect(calls(server)).toBe(1);
    const guard = server.indexOf("if (env.ENABLE_SCHEDULERS) {");
    const inner = server.indexOf("if (!WORKERS_EXTERNAL) {", guard);
    const call = server.indexOf("startRosterRequestsScheduler();");
    expect(guard).toBeGreaterThan(-1);
    expect(inner).toBeGreaterThan(guard);
    expect(call).toBeGreaterThan(inner);
  });
});
