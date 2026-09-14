import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { recordWorkerRun } = vi.hoisted(() => ({ recordWorkerRun: vi.fn(async () => undefined) }));
vi.mock("../../../../workers/worker-utils.js", () => ({ recordWorkerRun }));

const { getDispatchBlock } = vi.hoisted(() => ({ getDispatchBlock: vi.fn(async () => ({ blocked: false })) }));
vi.mock("../../../../shared/notification-dispatch-block.js", () => ({ getDispatchBlock }));

const { resolveAllEligibleRecipients } = vi.hoisted(() => ({ resolveAllEligibleRecipients: vi.fn() }));
vi.mock("../daily-brief-recipient.resolver.js", () => ({ resolveAllEligibleRecipients }));

const { dispatchDailyBrief } = vi.hoisted(() => ({ dispatchDailyBrief: vi.fn() }));
vi.mock("../daily-brief-dispatch.service.js", () => ({ dispatchDailyBrief }));

function recipient(id: string) {
  return {
    employeeId: id,
    userId: `user-${id}`,
    fullName: `Employee ${id}`,
    role: "team_leader",
    scopeLabel: "Your direct/indirect reports",
    teamEmployeeIds: [],
    email: `${id}@masindia.com`,
  };
}

const ORIGINAL_ENV = { ...process.env };

describe("daily-brief.cron", () => {
  beforeEach(() => {
    vi.resetModules();
    recordWorkerRun.mockClear();
    getDispatchBlock.mockReset().mockResolvedValue({ blocked: false });
    resolveAllEligibleRecipients.mockReset();
    dispatchDailyBrief.mockReset();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.MANAGER_DAILY_BRIEF_ENABLED;
    delete process.env.MANAGER_DAILY_BRIEF_TIME;
    delete process.env.MANAGER_DAILY_BRIEF_DRY_RUN;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.useRealTimers();
  });

  describe("dependency-timing default run time", () => {
    it("defaults to 09:30, genuinely after every dependency job found in the repo " +
      "(attendance-engine 23:00, reconciliation 02:00, attendance-gaps 06:00, " +
      "payroll-readiness 07:00, roster-shortages 09:00)", async () => {
      const { parseRunTime } = await import("../daily-brief.cron.js");
      const { hour, minute } = parseRunTime(undefined);
      expect(hour).toBe(9);
      expect(minute).toBe(30);

      const latestDependencyHour = 9; // roster-shortages sync, cron/business-action-sync.cron.ts
      expect(hour).toBeGreaterThanOrEqual(latestDependencyHour);
      if (hour === latestDependencyHour) {
        expect(minute).toBeGreaterThan(0);
      }
    });

    it("computes a next-run delay consistent with the configured HH:mm", async () => {
      const { millisecondsUntilNextManagerDailyBriefRun } = await import("../daily-brief.cron.js");
      process.env.MANAGER_DAILY_BRIEF_TIME = "09:30";
      const now = new Date(2026, 7, 19, 8, 0, 0, 0); // 08:00 local, before today's 09:30
      const ms = millisecondsUntilNextManagerDailyBriefRun(now);
      expect(ms).toBe(90 * 60 * 1000); // 1h30m until 09:30
    });

    it("rolls over to the next day when the configured time has already passed today", async () => {
      const { millisecondsUntilNextManagerDailyBriefRun } = await import("../daily-brief.cron.js");
      process.env.MANAGER_DAILY_BRIEF_TIME = "09:30";
      const now = new Date(2026, 7, 19, 10, 0, 0, 0); // 10:00 local, after today's 09:30
      const ms = millisecondsUntilNextManagerDailyBriefRun(now);
      // Should land on tomorrow 09:30 -> ~23.5 hours away.
      expect(ms).toBeGreaterThan(23 * 60 * 60 * 1000);
      expect(ms).toBeLessThan(24 * 60 * 60 * 1000);
    });

    it("falls back to the default for an unparseable MANAGER_DAILY_BRIEF_TIME", async () => {
      const { parseRunTime } = await import("../daily-brief.cron.js");
      expect(parseRunTime("not-a-time")).toEqual({ hour: 9, minute: 30 });
      expect(parseRunTime("25:99")).toEqual({ hour: 9, minute: 30 });
    });
  });

  describe("MANAGER_DAILY_BRIEF_ENABLED gate", () => {
    it("is a no-op (never resolves recipients or fires) when unset", async () => {
      const { startManagerDailyBriefScheduler, stopManagerDailyBriefScheduler } = await import("../daily-brief.cron.js");
      vi.useFakeTimers();
      startManagerDailyBriefScheduler();
      await vi.advanceTimersByTimeAsync(48 * 60 * 60 * 1000); // fast-forward two full days
      expect(resolveAllEligibleRecipients).not.toHaveBeenCalled();
      stopManagerDailyBriefScheduler();
    });

    it("is a no-op when explicitly \"false\"", async () => {
      process.env.MANAGER_DAILY_BRIEF_ENABLED = "false";
      const { startManagerDailyBriefScheduler, stopManagerDailyBriefScheduler } = await import("../daily-brief.cron.js");
      vi.useFakeTimers();
      startManagerDailyBriefScheduler();
      await vi.advanceTimersByTimeAsync(48 * 60 * 60 * 1000);
      expect(resolveAllEligibleRecipients).not.toHaveBeenCalled();
      stopManagerDailyBriefScheduler();
    });

    it("registers and fires once enabled", async () => {
      process.env.MANAGER_DAILY_BRIEF_ENABLED = "true";
      resolveAllEligibleRecipients.mockResolvedValue({ resolved: [], unresolved: [] });
      const { startManagerDailyBriefScheduler, stopManagerDailyBriefScheduler, millisecondsUntilNextManagerDailyBriefRun } =
        await import("../daily-brief.cron.js");
      vi.useFakeTimers();
      startManagerDailyBriefScheduler();
      const delay = millisecondsUntilNextManagerDailyBriefRun();
      await vi.advanceTimersByTimeAsync(delay + 1000);
      expect(resolveAllEligibleRecipients).toHaveBeenCalled();
      stopManagerDailyBriefScheduler();
    });
  });

  describe("MANAGER_DAILY_BRIEF_DRY_RUN hard gate", () => {
    it("passes dryRun:true through to dispatchDailyBrief when unset", async () => {
      resolveAllEligibleRecipients.mockResolvedValue({ resolved: [recipient("e1")], unresolved: [] });
      dispatchDailyBrief.mockResolvedValue({ status: "dry_run", brief: {}, html: "<p/>", subject: "s" });
      const { runManagerDailyBrief } = await import("../daily-brief.cron.js");

      const summary = await runManagerDailyBrief("2026-08-18");

      expect(dispatchDailyBrief).toHaveBeenCalledWith("e1", { businessDate: "2026-08-18", dryRun: true });
      expect(summary.dryRunOnly).toBe(1);
      expect(summary.sent).toBe(0);
    });

    it("passes dryRun:true even when MANAGER_DAILY_BRIEF_DRY_RUN is garbage/truthy-looking", async () => {
      process.env.MANAGER_DAILY_BRIEF_DRY_RUN = "yes";
      resolveAllEligibleRecipients.mockResolvedValue({ resolved: [recipient("e1")], unresolved: [] });
      dispatchDailyBrief.mockResolvedValue({ status: "dry_run", brief: {}, html: "<p/>", subject: "s" });
      const { runManagerDailyBrief } = await import("../daily-brief.cron.js");

      await runManagerDailyBrief("2026-08-18");

      expect(dispatchDailyBrief).toHaveBeenCalledWith("e1", { businessDate: "2026-08-18", dryRun: true });
    });

    it("only passes dryRun:false when the env var is the literal string \"false\"", async () => {
      process.env.MANAGER_DAILY_BRIEF_DRY_RUN = "false";
      resolveAllEligibleRecipients.mockResolvedValue({ resolved: [recipient("e1")], unresolved: [] });
      dispatchDailyBrief.mockResolvedValue({ status: "dispatched", dispatchIds: ["d-1"] });
      const { runManagerDailyBrief } = await import("../daily-brief.cron.js");

      const summary = await runManagerDailyBrief("2026-08-18");

      expect(dispatchDailyBrief).toHaveBeenCalledWith("e1", { businessDate: "2026-08-18", dryRun: false });
      expect(summary.sent).toBe(1);
    });
  });

  describe("resilience: one recipient failing never aborts the run", () => {
    it("processes the other recipients when one of three throws", async () => {
      resolveAllEligibleRecipients.mockResolvedValue({
        resolved: [recipient("e1"), recipient("e2"), recipient("e3")],
        unresolved: [],
      });
      dispatchDailyBrief.mockImplementation(async (employeeId: string) => {
        if (employeeId === "e2") throw new Error("boom");
        return { status: "dry_run", brief: {}, html: "<p/>", subject: "s" };
      });
      const { runManagerDailyBrief } = await import("../daily-brief.cron.js");

      const summary = await runManagerDailyBrief("2026-08-18");

      expect(dispatchDailyBrief).toHaveBeenCalledTimes(3);
      expect(summary.failed).toBe(1);
      expect(summary.dryRunOnly).toBe(2);
    });
  });

  describe("bounded concurrency", () => {
    it("never has more than the batch size of dispatchDailyBrief calls in flight at once", async () => {
      const recipients = Array.from({ length: 17 }, (_, i) => recipient(`e${i}`));
      resolveAllEligibleRecipients.mockResolvedValue({ resolved: recipients, unresolved: [] });

      let inFlight = 0;
      let maxInFlight = 0;
      const releasers: Array<() => void> = [];
      dispatchDailyBrief.mockImplementation(() => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        return new Promise((resolve) => {
          releasers.push(() => {
            inFlight -= 1;
            resolve({ status: "dry_run", brief: {}, html: "<p/>", subject: "s" });
          });
        });
      });

      const { runManagerDailyBrief } = await import("../daily-brief.cron.js");
      const runPromise = runManagerDailyBrief("2026-08-18");

      // Drain releasers as they appear, batch by batch, until the run settles.
      //
      // NOTE: the exit condition must track whether the run itself has finished, not
      // `releasers.length` — that array is drained back to 0 every iteration below, so
      // its live length never reaches recipients.length even once the run is long done
      // (it maxes out at RECIPIENT_BATCH_SIZE per batch). Checking it directly used to
      // spin this loop forever after the real run had already completed, starving the
      // event loop with nothing but microtask ticks and crashing the vitest worker
      // fork instead of failing cleanly. A `MAX_ROUNDS` hard cap is kept as a
      // safety net so a genuine regression (e.g. batching that stops making progress)
      // fails the test with a clear message instead of hanging again.
      let runSettled = false;
      runPromise.then(
        () => {
          runSettled = true;
        },
        () => {
          runSettled = true;
        },
      );

      const MAX_ROUNDS = 1000;
      let round = 0;
      while (!runSettled) {
        round += 1;
        if (round > MAX_ROUNDS) {
          throw new Error(
            `bounded concurrency drain loop did not converge after ${MAX_ROUNDS} rounds ` +
              `(inFlight=${inFlight}, maxInFlight=${maxInFlight}, pending releasers=${releasers.length})`,
          );
        }
        await Promise.resolve();
        while (releasers.length > 0) releasers.shift()!();
        await Promise.resolve();
      }
      const summary = await runPromise;

      expect(summary.dryRunOnly).toBe(17);
      expect(maxInFlight).toBeLessThanOrEqual(5); // RECIPIENT_BATCH_SIZE
      expect(maxInFlight).toBeGreaterThan(1); // proves it is actually batching, not fully serial
    });
  });

  describe("global dispatch block", () => {
    it("skips the whole run without resolving recipients when globally blocked", async () => {
      getDispatchBlock.mockResolvedValue({ blocked: true, scope: "global", reason: "incident" });
      const { runManagerDailyBrief } = await import("../daily-brief.cron.js");

      const summary = await runManagerDailyBrief("2026-08-18");

      expect(summary.blockedGlobally).toBe(true);
      expect(resolveAllEligibleRecipients).not.toHaveBeenCalled();
    });
  });
});
