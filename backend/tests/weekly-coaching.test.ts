import { describe, it, expect, vi, beforeEach } from "vitest";

const execute = vi.fn();
const raiseCoachingFromQuality = vi.fn();

vi.mock("../src/db/mysql.js", () => ({ db: { execute: (...a: unknown[]) => execute(...a) } }));
vi.mock("../src/lib/logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("../src/modules/quality-dashboard/coaching-writer.service.js", () => ({
  raiseCoachingFromQuality: (...a: unknown[]) => raiseCoachingFromQuality(...a),
}));

const { runWeeklyCoachingEvaluation, isoWeekBounds } = await import(
  "../src/modules/quality-dashboard/weekly-coaching.service.js"
);

/**
 * Weekly quality review, evaluated on a rolling ISO week every night rather than
 * on a fixed weekday. A "runs on Monday" job silently skips a whole week if that
 * one night fails, and this codebase has form: dialer_1 managed 864 consecutive
 * failures across 36 days without anyone noticing.
 */

beforeEach(() => {
  execute.mockReset();
  raiseCoachingFromQuality.mockReset();
  raiseCoachingFromQuality.mockResolvedValue({ created: false, reason: "no_trigger" });
});

describe("ISO week bounds", () => {
  it("runs Monday to Sunday", () => {
    // 2026-07-15 is a Wednesday.
    expect(isoWeekBounds("2026-07-15")).toEqual({ start: "2026-07-13", end: "2026-07-19" });
  });

  it("treats Monday as the start of its own week, not the end of the last", () => {
    expect(isoWeekBounds("2026-07-13")).toEqual({ start: "2026-07-13", end: "2026-07-19" });
  });

  it("keeps Sunday in the week that preceded it", () => {
    // The common off-by-one: Sunday is day 0 in JS, so a naive shift puts it in
    // the following week and splits the weekend across two reviews.
    expect(isoWeekBounds("2026-07-19")).toEqual({ start: "2026-07-13", end: "2026-07-19" });
  });

  it("crosses a month boundary without breaking the week", () => {
    expect(isoWeekBounds("2026-08-01")).toEqual({ start: "2026-07-27", end: "2026-08-02" });
  });
});

describe("weekly evaluation", () => {
  const oneAgent = [[{
    employee_id: "emp-1", metric_id: "m-q", avg_value: 55,
    target_value: 80, sample_days: 5, audit_count: 20, fatal_weeks: 0,
  }], []];

  it("evaluates each employee with quality that week", async () => {
    execute.mockResolvedValueOnce(oneAgent).mockResolvedValueOnce([[], []]);
    const result = await runWeeklyCoachingEvaluation("2026-07-15");

    expect(result).toMatchObject({ weekStart: "2026-07-13", weekEnd: "2026-07-19", evaluated: 1 });
    expect(raiseCoachingFromQuality).toHaveBeenCalledTimes(1);
    expect(raiseCoachingFromQuality.mock.calls[0][0]).toMatchObject({
      employeeId: "emp-1", periodStart: "2026-07-13", periodEnd: "2026-07-19",
    });
  });

  it("judges on audits assessed, not days worked", async () => {
    // Three days of one audit each is not the same evidence as three days of
    // twenty, and the trigger's minimum sample depends on knowing the difference.
    execute.mockResolvedValueOnce(oneAgent).mockResolvedValueOnce([[], []]);
    await runWeeklyCoachingEvaluation("2026-07-15");
    expect(raiseCoachingFromQuality.mock.calls[0][0].signal.sampleSize).toBe(20);
  });

  it("does not claim a fatal from a weekly average", async () => {
    // A week's mean cannot express a single fatal call. Those are raised from
    // the audit itself, where the breach is actually known.
    execute.mockResolvedValueOnce(oneAgent).mockResolvedValueOnce([[], []]);
    await runWeeklyCoachingEvaluation("2026-07-15");
    expect(raiseCoachingFromQuality.mock.calls[0][0].signal.fatalTriggered).toBe(false);
  });

  it("counts each outcome separately so the run is legible", async () => {
    execute
      .mockResolvedValueOnce([[
        { employee_id: "e1", metric_id: "m", avg_value: 50, target_value: 80, sample_days: 5, audit_count: 10 },
        { employee_id: "e2", metric_id: "m", avg_value: 50, target_value: 80, sample_days: 5, audit_count: 10 },
        { employee_id: "e3", metric_id: "m", avg_value: 90, target_value: 80, sample_days: 5, audit_count: 10 },
      ], []])
      .mockResolvedValue([[], []]);

    raiseCoachingFromQuality
      .mockResolvedValueOnce({ created: true, sessionId: "s1", trainingNeedId: null, trigger: {} })
      .mockResolvedValueOnce({ created: false, reason: "already_open" })
      .mockResolvedValueOnce({ created: false, reason: "no_trigger" });

    const result = await runWeeklyCoachingEvaluation("2026-07-15");
    expect(result).toMatchObject({
      evaluated: 3, raised: 1, skippedAlreadyOpen: 1, skippedNoTrigger: 1,
    });
  });

  it("carries on when one employee fails", async () => {
    // One bad row must not abandon the rest of the week.
    execute
      .mockResolvedValueOnce([[
        { employee_id: "e1", metric_id: "m", avg_value: 50, target_value: 80, sample_days: 5, audit_count: 10 },
        { employee_id: "e2", metric_id: "m", avg_value: 50, target_value: 80, sample_days: 5, audit_count: 10 },
      ], []])
      .mockResolvedValue([[], []]);

    raiseCoachingFromQuality
      .mockImplementationOnce(() => Promise.reject(new Error("deadlock")))
      .mockResolvedValueOnce({ created: true, sessionId: "s2", trainingNeedId: null, trigger: {} });

    const result = await runWeeklyCoachingEvaluation("2026-07-15");
    expect(result.evaluated).toBe(2);
    expect(result.raised).toBe(1);
  });

  it("returns a zero result for a week with no quality at all", async () => {
    execute.mockResolvedValueOnce([[], []]);
    const result = await runWeeklyCoachingEvaluation("2026-07-15");
    expect(result).toMatchObject({ evaluated: 0, raised: 0 });
    expect(raiseCoachingFromQuality).not.toHaveBeenCalled();
  });
});

describe("consecutive shortfall counting", () => {
  it("stops the streak at a week with no target rather than counting it short", async () => {
    // An unmeasurable week is not a failed one.
    execute
      .mockResolvedValueOnce([[{
        employee_id: "emp-1", metric_id: "m-q", avg_value: 55,
        target_value: 80, sample_days: 5, audit_count: 20,
      }], []])
      .mockResolvedValueOnce([[
        { wk: 202629, avg_value: 50, target_value: 80 },   // short
        { wk: 202628, avg_value: 50, target_value: null }, // unmeasurable — stop
        { wk: 202627, avg_value: 10, target_value: 80 },   // must not be counted
      ], []]);

    await runWeeklyCoachingEvaluation("2026-07-15");
    expect(raiseCoachingFromQuality.mock.calls[0][0].signal.consecutiveShortfalls).toBe(1);
  });

  it("stops at the first week that met target", async () => {
    execute
      .mockResolvedValueOnce([[{
        employee_id: "emp-1", metric_id: "m-q", avg_value: 55,
        target_value: 80, sample_days: 5, audit_count: 20,
      }], []])
      .mockResolvedValueOnce([[
        { wk: 202629, avg_value: 50, target_value: 80 },
        { wk: 202628, avg_value: 85, target_value: 80 },
        { wk: 202627, avg_value: 50, target_value: 80 },
      ], []]);

    await runWeeklyCoachingEvaluation("2026-07-15");
    expect(raiseCoachingFromQuality.mock.calls[0][0].signal.consecutiveShortfalls).toBe(1);
  });
});

describe("an absent target is not the same as meeting it", () => {
  const noTarget = {
    employee_id: "e1", metric_id: "m", avg_value: 50,
    target_value: null, sample_days: 5, audit_count: 10,
  };

  it("counts a missing target separately from a met one", async () => {
    // Measured on production 2026-08-02: all 41 agents with quality that week
    // had no resolved target, and zero QUALITY_SCORE targets were configured
    // anywhere. Folding this into skippedNoTrigger made a completely inert
    // coaching loop look like a quiet week.
    execute.mockResolvedValueOnce([[noTarget], []]).mockResolvedValue([[], []]);
    const result = await runWeeklyCoachingEvaluation("2026-07-15");

    expect(result.skippedMissingTarget).toBe(1);
    expect(result.skippedNoTrigger).toBe(0);
  });

  it("does not bother the writer when there is no target", async () => {
    execute.mockResolvedValueOnce([[noTarget], []]).mockResolvedValue([[], []]);
    await runWeeklyCoachingEvaluation("2026-07-15");
    expect(raiseCoachingFromQuality).not.toHaveBeenCalled();
  });

  it("treats a zero target as no target", async () => {
    // Dividing by it would be worse than declining.
    execute.mockResolvedValueOnce([[{ ...noTarget, target_value: 0 }], []]).mockResolvedValue([[], []]);
    const result = await runWeeklyCoachingEvaluation("2026-07-15");
    expect(result.skippedMissingTarget).toBe(1);
  });

  it("still counts a genuine pass as no-trigger, not as missing", async () => {
    execute
      .mockResolvedValueOnce([[{ ...noTarget, target_value: 80, avg_value: 95 }], []])
      .mockResolvedValue([[], []]);
    const result = await runWeeklyCoachingEvaluation("2026-07-15");
    expect(result.skippedMissingTarget).toBe(0);
    expect(result.skippedNoTrigger).toBe(1);
  });
});

describe("the missing-target gap names where to fix it", () => {
  it("groups affected employees by process", async () => {
    // A bare count says coaching is inert; this says which process to configure.
    execute.mockResolvedValueOnce([[
      { employee_id: "e1", metric_id: "m", avg_value: 50, target_value: null, sample_days: 5, audit_count: 10,
        process_id: "p1", process_name: "Neemans Inbound" },
      { employee_id: "e2", metric_id: "m", avg_value: 40, target_value: null, sample_days: 5, audit_count: 8,
        process_id: "p1", process_name: "Neemans Inbound" },
      { employee_id: "e3", metric_id: "m", avg_value: 60, target_value: null, sample_days: 5, audit_count: 9,
        process_id: "p2", process_name: "GNC Orders" },
    ], []]).mockResolvedValue([[], []]);

    const result = await runWeeklyCoachingEvaluation("2026-07-15");

    expect(result.skippedMissingTarget).toBe(3);
    expect(result.processesMissingTarget).toEqual([
      { processId: "p1", processName: "Neemans Inbound", employeeCount: 2 },
      { processId: "p2", processName: "GNC Orders", employeeCount: 1 },
    ]);
  });

  it("does not lose an employee who has no process at all", async () => {
    // Silently dropping them would understate the gap.
    execute.mockResolvedValueOnce([[
      { employee_id: "e1", metric_id: "m", avg_value: 50, target_value: null, sample_days: 5, audit_count: 10,
        process_id: null, process_name: null },
    ], []]).mockResolvedValue([[], []]);

    const result = await runWeeklyCoachingEvaluation("2026-07-15");
    expect(result.processesMissingTarget).toEqual([
      { processId: "unassigned", processName: "(no process assigned)", employeeCount: 1 },
    ]);
  });
});
