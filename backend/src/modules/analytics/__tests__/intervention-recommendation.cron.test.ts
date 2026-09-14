import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { recordWorkerRun } = vi.hoisted(() => ({ recordWorkerRun: vi.fn(async () => undefined) }));
vi.mock("../../../workers/worker-utils.js", () => ({ recordWorkerRun }));

const { getAtRiskEmployeeIds } = vi.hoisted(() => ({ getAtRiskEmployeeIds: vi.fn() }));
vi.mock("../predictive-attrition.service.js", () => ({ getAtRiskEmployeeIds }));

const { generateRecommendationsForEmployee } = vi.hoisted(() => ({ generateRecommendationsForEmployee: vi.fn() }));
vi.mock("../intervention-recommendation.service.js", () => ({ generateRecommendationsForEmployee }));

// Simulates the "already has an open case" lookup this driver runs before
// generating — see the cron file's header for why this exists (the upsert it
// calls into has no unique constraint to dedupe on its own).
const { poolQuery } = vi.hoisted(() => ({ poolQuery: vi.fn(async () => [[]]) }));
vi.mock("../../../db/mysql.js", () => ({ db: { query: poolQuery } }));

function candidate(id: string) {
  return { id, predictionScore: 60 };
}

const ORIGINAL_ENV = { ...process.env };

describe("intervention-recommendation.cron", () => {
  beforeEach(() => {
    vi.resetModules();
    recordWorkerRun.mockClear();
    getAtRiskEmployeeIds.mockReset();
    generateRecommendationsForEmployee.mockReset();
    poolQuery.mockReset().mockResolvedValue([[]]); // default: no employee already has an open case
    process.env = { ...ORIGINAL_ENV };
    delete process.env.INTERVENTION_RECOMMENDATIONS_ENABLED;
    delete process.env.INTERVENTION_RECOMMENDATIONS_TIME;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.useRealTimers();
  });

  describe("default run time", () => {
    it("defaults to 10:00, after the 09:30 daily-brief run it depends on the same signals as", async () => {
      const { parseRunTime } = await import("../intervention-recommendation.cron.js");
      expect(parseRunTime(undefined)).toEqual({ hour: 10, minute: 0 });
    });

    it("computes a next-run delay consistent with the configured HH:mm", async () => {
      const { millisecondsUntilNextInterventionRecommendationRun } = await import("../intervention-recommendation.cron.js");
      process.env.INTERVENTION_RECOMMENDATIONS_TIME = "10:00";
      const now = new Date(2026, 7, 19, 8, 0, 0, 0); // 08:00 local, before today's 10:00
      const ms = millisecondsUntilNextInterventionRecommendationRun(now);
      expect(ms).toBe(120 * 60 * 1000); // 2h until 10:00
    });

    it("rolls over to the next day when the configured time has already passed today", async () => {
      const { millisecondsUntilNextInterventionRecommendationRun } = await import("../intervention-recommendation.cron.js");
      process.env.INTERVENTION_RECOMMENDATIONS_TIME = "10:00";
      const now = new Date(2026, 7, 19, 11, 0, 0, 0); // after today's 10:00
      const ms = millisecondsUntilNextInterventionRecommendationRun(now);
      expect(ms).toBeGreaterThan(22 * 60 * 60 * 1000);
      expect(ms).toBeLessThan(24 * 60 * 60 * 1000);
    });

    it("falls back to the default for an unparseable INTERVENTION_RECOMMENDATIONS_TIME", async () => {
      const { parseRunTime } = await import("../intervention-recommendation.cron.js");
      expect(parseRunTime("not-a-time")).toEqual({ hour: 10, minute: 0 });
      expect(parseRunTime("25:99")).toEqual({ hour: 10, minute: 0 });
    });
  });

  describe("INTERVENTION_RECOMMENDATIONS_ENABLED gate", () => {
    it("is a no-op (never queries at-risk employees) when unset", async () => {
      const { startInterventionRecommendationScheduler, stopInterventionRecommendationScheduler } =
        await import("../intervention-recommendation.cron.js");
      vi.useFakeTimers();
      startInterventionRecommendationScheduler();
      await vi.advanceTimersByTimeAsync(48 * 60 * 60 * 1000);
      expect(getAtRiskEmployeeIds).not.toHaveBeenCalled();
      stopInterventionRecommendationScheduler();
    });

    it("is a no-op when explicitly \"false\"", async () => {
      process.env.INTERVENTION_RECOMMENDATIONS_ENABLED = "false";
      const { startInterventionRecommendationScheduler, stopInterventionRecommendationScheduler } =
        await import("../intervention-recommendation.cron.js");
      vi.useFakeTimers();
      startInterventionRecommendationScheduler();
      await vi.advanceTimersByTimeAsync(48 * 60 * 60 * 1000);
      expect(getAtRiskEmployeeIds).not.toHaveBeenCalled();
      stopInterventionRecommendationScheduler();
    });

    it("registers and fires once enabled", async () => {
      process.env.INTERVENTION_RECOMMENDATIONS_ENABLED = "true";
      getAtRiskEmployeeIds.mockResolvedValue([]);
      const {
        startInterventionRecommendationScheduler,
        stopInterventionRecommendationScheduler,
        millisecondsUntilNextInterventionRecommendationRun,
      } = await import("../intervention-recommendation.cron.js");
      vi.useFakeTimers();
      startInterventionRecommendationScheduler();
      const delay = millisecondsUntilNextInterventionRecommendationRun();
      await vi.advanceTimersByTimeAsync(delay + 1000);
      expect(getAtRiskEmployeeIds).toHaveBeenCalled();
      stopInterventionRecommendationScheduler();
    });
  });

  describe("population targeting", () => {
    it("requests only HIGH+CRITICAL tier (minScore=55) candidates, bounded to 300", async () => {
      getAtRiskEmployeeIds.mockResolvedValue([]);
      const { runInterventionRecommendationGeneration } = await import("../intervention-recommendation.cron.js");

      await runInterventionRecommendationGeneration();

      expect(getAtRiskEmployeeIds).toHaveBeenCalledWith(55, 300);
    });
  });

  describe("dedup against the upsert's missing unique constraint (see file header)", () => {
    it("skips candidates who already have an open (action_taken=0) case instead of duplicating it", async () => {
      getAtRiskEmployeeIds.mockResolvedValue([candidate("e1"), candidate("e2"), candidate("e3")]);
      poolQuery.mockResolvedValue([[{ employee_id: "e2" }]]); // e2 already has an open case
      generateRecommendationsForEmployee.mockResolvedValue({});

      const { runInterventionRecommendationGeneration } = await import("../intervention-recommendation.cron.js");
      const summary = await runInterventionRecommendationGeneration();

      expect(generateRecommendationsForEmployee).toHaveBeenCalledTimes(2);
      expect(generateRecommendationsForEmployee).not.toHaveBeenCalledWith("e2");
      expect(summary.candidatesFound).toBe(3);
      expect(summary.alreadyOpen).toBe(1);
      expect(summary.generated).toBe(2);
    });
  });

  describe("resilience: one employee failing never aborts the run", () => {
    it("processes the other candidates when one of three throws", async () => {
      getAtRiskEmployeeIds.mockResolvedValue([candidate("e1"), candidate("e2"), candidate("e3")]);
      generateRecommendationsForEmployee.mockImplementation(async (id: string) => {
        if (id === "e2") throw new Error("boom");
        return {};
      });
      const { runInterventionRecommendationGeneration } = await import("../intervention-recommendation.cron.js");

      const summary = await runInterventionRecommendationGeneration();

      expect(generateRecommendationsForEmployee).toHaveBeenCalledTimes(3);
      expect(summary.candidatesFound).toBe(3);
      expect(summary.failed).toBe(1);
      expect(summary.generated).toBe(2);
    });
  });

  describe("bounded concurrency", () => {
    it("never has more than BATCH_SIZE generateRecommendationsForEmployee calls in flight at once", async () => {
      const candidates = Array.from({ length: 17 }, (_, i) => candidate(`e${i}`));
      getAtRiskEmployeeIds.mockResolvedValue(candidates);

      let inFlight = 0;
      let maxInFlight = 0;
      const releasers: Array<() => void> = [];
      generateRecommendationsForEmployee.mockImplementation(() => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        return new Promise((resolve) => {
          releasers.push(() => {
            inFlight -= 1;
            resolve({});
          });
        });
      });

      const { runInterventionRecommendationGeneration } = await import("../intervention-recommendation.cron.js");
      const runPromise = runInterventionRecommendationGeneration();

      let runSettled = false;
      runPromise.then(
        () => { runSettled = true; },
        () => { runSettled = true; },
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

      expect(summary.generated).toBe(17);
      expect(maxInFlight).toBeLessThanOrEqual(5); // BATCH_SIZE
      expect(maxInFlight).toBeGreaterThan(1); // proves it is actually batching, not fully serial
    });
  });
});
