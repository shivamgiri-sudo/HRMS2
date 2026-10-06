import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ record: vi.fn(), heal: vi.fn(), lock: vi.fn() }));
vi.mock("../../../workers/worker-utils.js", () => ({
  recordWorkerRun: (...a: unknown[]) => m.record(...a),
  withWorkerLock: async (_n: string, fn: () => Promise<void>) => { await fn(); return true; },
}));
vi.mock("../../../logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../attendance-heal.service.js", () => ({ runAutomaticHeal: (...a: unknown[]) => m.heal(...a) }));

const { runHealOnce, HEAL_WORKER_NAME } = await import("../attendance-heal.worker.js");

beforeEach(() => { m.record.mockReset().mockResolvedValue(undefined); m.heal.mockReset(); });

describe("heal worker", () => {
  it("records a started and a completed run with the counts", async () => {
    m.heal.mockResolvedValue({ found: 4, processed: 3, failed: 1, truncated: false });
    await runHealOnce();
    expect(m.record.mock.calls.map((c) => c[1])).toEqual(["started", "completed"]);
    expect(m.record.mock.calls[1]).toEqual([HEAL_WORKER_NAME, "completed", { found: 4, processed: 3, failed: 1, truncated: false, stale: null }]);
  });
  it("a failure is recorded as failed and never thrown (it must not break the server)", async () => {
    m.heal.mockRejectedValue(new Error("db down"));
    await expect(runHealOnce()).resolves.toBeUndefined();
    expect(m.record.mock.calls.map((c) => c[1])).toEqual(["started", "failed"]);
  });
});
