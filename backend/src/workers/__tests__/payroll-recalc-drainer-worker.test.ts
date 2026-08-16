import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * payroll_recalculation_queue backlogged by construction.
 *
 * drainPayrollRecalcQueue handles at most 200 rows per call, does not loop, and had exactly one
 * caller: the tail of cosec-sync.service.ts, inside a try/catch that downgrades any failure to
 * "sync result unaffected". So the queue drained only as a side effect of an unrelated job, 200 at
 * a time, and one COSEC sync could enqueue far more than a single drain removes.
 *
 * Measured live 2026-08-16: 912 pending for 270 ACTIVE employees, oldest 12 days, nothing drained
 * since 2026-08-12 — those employees' salary_prep_line rows stale against attendance that had
 * since changed. Rows sourced from attendance_regularization had no drain path at all except when
 * a COSEC sync happened to visit the same month.
 */

const { mockExecute, mockDrain } = vi.hoisted(() => ({ mockExecute: vi.fn(), mockDrain: vi.fn() }));
vi.mock("../../db/mysql.js", () => ({ db: { execute: mockExecute } }));
vi.mock("../../modules/payroll/payroll-recalc-drainer.service.js", () => ({
  drainPayrollRecalcQueue: mockDrain,
}));
vi.mock("../../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
// Run the body directly rather than under a real distributed lock.
vi.mock("../worker-utils.js", () => ({
  withWorkerLock: vi.fn(async (_name: string, fn: () => Promise<void>) => { await fn(); return true; }),
  registerTimer: vi.fn(),
  unregisterTimer: vi.fn(),
}));

const SOURCE = readFileSync(resolve(process.cwd(), "src/workers/payroll-recalc-drainer.worker.ts"), "utf8");

const drained = (processed = 0, failed = 0, skipped_locked = 0) => ({ processed, failed, skipped_locked });

/** The worker asks for months with pending work, then drains each. */
function stubMonths(months: Array<{ month: string; pending: number }>) {
  mockExecute.mockReset();
  mockExecute.mockImplementation(async () => [months, []]);
}

beforeEach(() => {
  mockExecute.mockReset();
  mockDrain.mockReset();
});

describe("the drainer keeps going until the month is actually empty", () => {
  it("calls drain repeatedly rather than once per tick", async () => {
    // The defect in one line: one call moved 200 rows and stopped, whatever was left behind.
    stubMonths([{ month: "2026-08", pending: 912 }]);
    mockDrain
      .mockResolvedValueOnce(drained(200))
      .mockResolvedValueOnce(drained(200))
      .mockResolvedValueOnce(drained(112))
      .mockResolvedValue(drained(0));

    const { startPayrollRecalcDrainerWorker } = await import("../payroll-recalc-drainer.worker.js");
    expect(typeof startPayrollRecalcDrainerWorker).toBe("function");

    // Exercise the drain loop through the module's own tick by invoking the interval callback.
    vi.useFakeTimers();
    startPayrollRecalcDrainerWorker();
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    await vi.waitFor(() => expect(mockDrain.mock.calls.length).toBeGreaterThan(3));
    vi.useRealTimers();
  });
});

describe("properties the loop must hold, pinned at source", () => {
  it("stops on no progress, not on an empty read", () => {
    // Keying the loop on rows SEEN would spin forever against rows another drainer has claimed
    // between the SELECT and the UPDATE.
    expect(SOURCE).toMatch(/const moved = result\.processed \+ result\.failed \+ result\.skipped_locked/);
    expect(SOURCE).toMatch(/if \(moved === 0\) break/);
  });

  it("bounds how much payroll recalculation one tick can trigger", () => {
    expect(SOURCE).toMatch(/MAX_BATCHES_PER_MONTH/);
    expect(SOURCE).toMatch(/while \(batches < MAX_BATCHES_PER_MONTH\)/);
  });

  it("says so when it hits the cap, so a capped drain is not read as a finished one", () => {
    // A silent cap is the same class of defect as the original: work left undone with nothing
    // saying it was left undone.
    expect(SOURCE).toMatch(/batches >= MAX_BATCHES_PER_MONTH/);
    expect(SOURCE).toMatch(/logger\.warn/);
  });

  it("drains every month with pending work, not only the current one", () => {
    // attendance_regularization rows spanned months the COSEC path would never have visited.
    expect(SOURCE).toMatch(/GROUP BY DATE_FORMAT\(payroll_month, '%Y-%m'\)/);
    expect(SOURCE).toMatch(/WHERE status = 'pending'/);
  });

  it("runs under the distributed lock, since two drainers would recalculate one employee twice", () => {
    expect(SOURCE).toMatch(/withWorkerLock\(WORKER_NAME/);
  });
});

describe("registered in both topologies", () => {
  // A worker in only one of server.ts / all-workers.ts silently never runs in the other.
  const server = readFileSync(resolve(process.cwd(), "src/server.ts"), "utf8");
  const all = readFileSync(resolve(process.cwd(), "src/workers/all-workers.ts"), "utf8");

  it("starts in server.ts", () => {
    expect(server).toMatch(/startPayrollRecalcDrainerWorker\(\)/);
  });

  it("starts in all-workers.ts", () => {
    expect(all).toMatch(/startPayrollRecalcDrainerWorker\(\)/);
  });

  it("stops in both, so a shutdown does not leave the interval running", () => {
    expect(server).toMatch(/stopPayrollRecalcDrainerWorker\(\)/);
    expect(all).toMatch(/stopPayrollRecalcDrainerWorker\(\)/);
  });
});
