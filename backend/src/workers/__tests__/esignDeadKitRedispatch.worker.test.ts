import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute, redispatchDeadKit, envMock } = vi.hoisted(() => ({
  execute: vi.fn(),
  redispatchDeadKit: vi.fn(),
  envMock: { ESIGN_AUTO_REDISPATCH_ENABLED: false as boolean },
}));

vi.mock("../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../config/env.js", () => ({ env: envMock }));
vi.mock("../../modules/employees/joiningKitDispatch.service.js", () => ({
  redispatchDeadKit,
}));

import {
  runDeadKitRedispatchOnce,
  startDeadKitRedispatchWorker,
  stopDeadKitRedispatchWorker,
} from "../esign-dead-kit-redispatch.worker.js";

beforeEach(() => {
  execute.mockReset();
  redispatchDeadKit.mockReset();
  envMock.ESIGN_AUTO_REDISPATCH_ENABLED = false;
  stopDeadKitRedispatchWorker();
  vi.restoreAllMocks();
});

describe("runDeadKitRedispatchOnce", () => {
  it("does nothing when no kit has a dead session", async () => {
    execute.mockResolvedValueOnce([[]]);

    const result = await runDeadKitRedispatchOnce();

    expect(result).toEqual({ found: false });
    expect(redispatchDeadKit).not.toHaveBeenCalled();
  });

  it("redispatches exactly one kit per tick, with no human actor", async () => {
    execute.mockResolvedValueOnce([[{ id: "kit-1", employee_id: "emp-1" }]]);
    redispatchDeadKit.mockResolvedValueOnce({ status: "sent", message: "ok" });

    const result = await runDeadKitRedispatchOnce();

    expect(redispatchDeadKit).toHaveBeenCalledTimes(1);
    expect(redispatchDeadKit).toHaveBeenCalledWith("emp-1", null);
    expect(result).toEqual({
      found: true,
      employeeId: "emp-1",
      outcome: "sent",
    });
    // LIMIT is bound, not interpolated, and equals the one-per-tick budget.
    expect(execute.mock.calls[0][1]).toEqual([1]);
  });

  it("reports a failed redispatch as an error outcome instead of throwing", async () => {
    execute.mockResolvedValueOnce([[{ id: "kit-1", employee_id: "emp-1" }]]);
    redispatchDeadKit.mockRejectedValueOnce(new Error("Luckpay down"));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await runDeadKitRedispatchOnce();

    expect(result).toEqual({
      found: true,
      employeeId: "emp-1",
      outcome: "error: Luckpay down",
    });
  });
});

describe("startDeadKitRedispatchWorker", () => {
  it("stays off while ESIGN_AUTO_REDISPATCH_ENABLED is false", () => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    execute.mockResolvedValue([[]]);

    startDeadKitRedispatchWorker();
    vi.advanceTimersByTime(60 * 60 * 1000);

    expect(execute).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("starts when the flag is on — env exposes it as a boolean, not the string 'true'", () => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    envMock.ESIGN_AUTO_REDISPATCH_ENABLED = true;
    execute.mockResolvedValue([[]]);

    startDeadKitRedispatchWorker();
    vi.advanceTimersByTime(10 * 60 * 1000 + 1);

    expect(execute).toHaveBeenCalledTimes(1);
    stopDeadKitRedispatchWorker();
    vi.useRealTimers();
  });
});

describe("wiring", () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

  it("is registered in all-workers.ts", () => {
    const src = read("src/workers/all-workers.ts");
    expect(src).toMatch(/esign-dead-kit-redispatch\.worker\.js/);
    expect(src).toMatch(/name:\s*"esign-dead-kit-redispatch"/);
    expect(src).toMatch(/startDeadKitRedispatchWorker\(\);/);
    expect(src).toMatch(/stopDeadKitRedispatchWorker\(\);/);
  });

  it("selects only kits whose session kitEsignSessionIsAlive would call dead", () => {
    const worker = read("src/workers/esign-dead-kit-redispatch.worker.ts");
    const svc = read("src/modules/employees/joiningKitDispatch.service.ts");
    const deadAfter = svc.match(/SESSION_DEAD_AFTER_DAYS = (\d+)/)![1];
    expect(worker).toContain(`>= ${deadAfter})`);
    expect(worker).toMatch(
      /IN \('pending','initiated'\)\s+AND DATEDIFF\(NOW\(\), t\.initiated_at\) >= 7/,
    );
    expect(svc).toMatch(
      /\["pending", "initiated"\]\.includes\(status\) && ageDays >= 7/,
    );
  });
});
