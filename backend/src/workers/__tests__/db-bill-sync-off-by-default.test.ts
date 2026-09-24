import { afterEach, describe, expect, it, vi } from "vitest";

const registerTimer = vi.fn();
vi.mock("../worker-utils.js", () => ({
  registerTimer: (...args: unknown[]) => registerTimer(...args),
  unregisterTimer: vi.fn(),
  withWorkerLock: vi.fn(),
}));
vi.mock("../../logger.js", () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import { startDbBillFinanceSyncWorker, stopDbBillFinanceSyncWorker } from "../db-bill-finance-sync.worker.js";

describe("db_bill finance sync worker is off unless DB_BILL_SYNC_ENABLED=true", () => {
  afterEach(() => {
    stopDbBillFinanceSyncWorker();
    registerTimer.mockClear();
    delete process.env.DB_BILL_SYNC_ENABLED;
  });

  it("schedules nothing when the variable is unset", () => {
    delete process.env.DB_BILL_SYNC_ENABLED;
    startDbBillFinanceSyncWorker();
    expect(registerTimer).not.toHaveBeenCalled();
  });

  it("schedules nothing when it is anything but 'true'", () => {
    process.env.DB_BILL_SYNC_ENABLED = "1";
    startDbBillFinanceSyncWorker();
    expect(registerTimer).not.toHaveBeenCalled();
  });

  it("schedules the startup and daily timers when explicitly enabled", () => {
    process.env.DB_BILL_SYNC_ENABLED = "true";
    startDbBillFinanceSyncWorker();
    expect(registerTimer).toHaveBeenCalledTimes(2);
  });
});
