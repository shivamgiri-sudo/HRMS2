import { describe, it, expect, vi, beforeEach } from "vitest";

const execute = vi.fn();
const connExecute = vi.fn();
const beginTransaction = vi.fn();
const commit = vi.fn();
const rollback = vi.fn();
const release = vi.fn();

vi.mock("../src/db/mysql.js", () => ({
  db: {
    execute: (...a: unknown[]) => execute(...a),
    getConnection: async () => ({
      execute: (...a: unknown[]) => connExecute(...a),
      beginTransaction, commit, rollback, release,
    }),
  },
}));
vi.mock("../src/lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const { raiseCoachingFromQuality } = await import("../src/modules/quality-dashboard/coaching-writer.service.js");

/**
 * coaching_session and training_need have both existed for months and both hold
 * ZERO rows, while 254 agents are scored at an average of 50.1%. "Quality is
 * low" has never once become "somebody is doing something about it".
 *
 * The hard requirement here is idempotency. The quality sync runs nightly and
 * will re-evaluate the same shortfall every night until somebody acts, so a row
 * per night would bury the signal within a week — exactly how 864 connector
 * failures went unnoticed for 36 days.
 */

const NO_ROWS: unknown = [[], []];
const COACH = [[{ coach_user_id: "mgr-login-1" }], []];

const failing = {
  employeeId: "emp-1",
  periodStart: "2026-07-01",
  periodEnd: "2026-07-31",
  signal: {
    qualityPercentage: 50,
    fatalTriggered: false,
    targetPercentage: 80,
    consecutiveShortfalls: 0,
    sampleSize: 12,
  },
};

beforeEach(() => {
  execute.mockReset(); connExecute.mockReset();
  beginTransaction.mockReset(); commit.mockReset(); rollback.mockReset(); release.mockReset();
  connExecute.mockResolvedValue([{ affectedRows: 1 }, []]);
  beginTransaction.mockResolvedValue(undefined);
  commit.mockResolvedValue(undefined);
  rollback.mockResolvedValue(undefined);
  release.mockReturnValue(undefined);
});

describe("nothing is written when nothing is wrong", () => {
  it("writes no row when the trigger declines", async () => {
    const result = await raiseCoachingFromQuality({
      ...failing,
      signal: { ...failing.signal, qualityPercentage: 85 },
    });
    expect(result).toEqual({ created: false, reason: "no_trigger" });
    expect(connExecute).not.toHaveBeenCalled();
  });

  it("writes nothing for an unassessed period", async () => {
    // 21% of July's audits are unscored. Coaching on an absent score would
    // blame the agent for a process failure.
    const result = await raiseCoachingFromQuality({
      ...failing,
      signal: { ...failing.signal, qualityPercentage: null },
    });
    expect(result).toMatchObject({ created: false, reason: "no_trigger" });
  });
});

describe("idempotency", () => {
  it("does not raise a second session while one is still open", async () => {
    execute.mockResolvedValueOnce([[{ id: "existing" }], []]);
    const result = await raiseCoachingFromQuality(failing);
    expect(result).toEqual({ created: false, reason: "already_open" });
    expect(connExecute).not.toHaveBeenCalled();
  });

  it("only counts scheduled sessions as blocking", async () => {
    // A completed session means the conversation happened, so a fresh shortfall
    // deserves a new one. A cancelled session was dropped deliberately and must
    // not be silently resurrected.
    execute.mockResolvedValueOnce(NO_ROWS).mockResolvedValueOnce(COACH);
    await raiseCoachingFromQuality(failing);
    expect(String(execute.mock.calls[0][0])).toMatch(/status = 'scheduled'/);
  });
});

describe("accountability", () => {
  it("refuses to raise a session with no coach to own it", async () => {
    // A row assigned to nobody is work nobody does.
    execute.mockResolvedValueOnce(NO_ROWS).mockResolvedValueOnce(NO_ROWS);
    const result = await raiseCoachingFromQuality(failing);
    expect(result).toEqual({ created: false, reason: "no_employee" });
    expect(connExecute).not.toHaveBeenCalled();
  });

  it("falls back from reporting_manager_id to manager_id", async () => {
    execute.mockResolvedValueOnce(NO_ROWS).mockResolvedValueOnce(COACH);
    await raiseCoachingFromQuality(failing);
    expect(String(execute.mock.calls[1][0])).toMatch(/COALESCE\(emp\.reporting_manager_id, emp\.manager_id\)/);
  });

  it("stores the manager's LOGIN, not their employee id", async () => {
    // coach_user_id is a user id everywhere else that reads it — the journey
    // audit report and the BPO adapter both treat it as the acting user. But
    // reporting_manager_id is an employee id, and none of them match auth_user.
    // Writing it straight through attributed coaching to an actor that does not
    // exist.
    execute.mockResolvedValueOnce(NO_ROWS).mockResolvedValueOnce(COACH);
    await raiseCoachingFromQuality(failing);
    expect(String(execute.mock.calls[1][0])).toMatch(/mgr\.auth_user_id/);
    const session = connExecute.mock.calls.find(([s]) => /INSERT INTO coaching_session/.test(String(s)));
    expect(session?.[1]?.[2]).toBe("mgr-login-1");
  });

  it("raises nothing when the manager has no login to own it", async () => {
    execute.mockResolvedValueOnce(NO_ROWS).mockResolvedValueOnce([[], []]);
    const r = await raiseCoachingFromQuality(failing);
    expect(r).toEqual({ created: false, reason: "no_employee" });
  });
});

describe("what gets written", () => {
  it("creates the session and its training need together", async () => {
    execute.mockResolvedValueOnce(NO_ROWS).mockResolvedValueOnce(COACH);
    const result = await raiseCoachingFromQuality(failing);

    expect(result).toMatchObject({ created: true });
    if (!result.created) throw new Error("expected creation");
    expect(result.trainingNeedId).not.toBeNull();

    const sqls = connExecute.mock.calls.map(([s]) => String(s));
    expect(sqls.some((s) => /INSERT INTO coaching_session/.test(s))).toBe(true);
    expect(sqls.some((s) => /INSERT INTO training_need/.test(s))).toBe(true);
    expect(commit).toHaveBeenCalled();
  });

  it("skips the training need on a first mild shortfall", async () => {
    // A conversation, not a training plan.
    execute.mockResolvedValueOnce(NO_ROWS).mockResolvedValueOnce(COACH);
    const result = await raiseCoachingFromQuality({
      ...failing,
      signal: { ...failing.signal, qualityPercentage: 70 },
    });
    if (!result.created) throw new Error("expected creation");
    expect(result.trainingNeedId).toBeNull();
    expect(connExecute.mock.calls.some(([s]) => /training_need/.test(String(s)))).toBe(false);
  });

  it("stores the numbers behind the decision, not just the sentence", async () => {
    // "Below target" is not auditable. The figures that produced the decision
    // have to survive alongside it.
    execute.mockResolvedValueOnce(NO_ROWS).mockResolvedValueOnce(COACH);
    await raiseCoachingFromQuality(failing);

    const session = connExecute.mock.calls.find(([s]) => /INSERT INTO coaching_session/.test(String(s)));
    const actionItems = JSON.parse(String(session?.[1]?.[6]));
    expect(actionItems).toMatchObject({
      qualityPercentage: 50, targetPercentage: 80, assessedAudits: 12, priority: "high",
    });
  });

  it("dates the session at the end of the period it judged", async () => {
    execute.mockResolvedValueOnce(NO_ROWS).mockResolvedValueOnce(COACH);
    await raiseCoachingFromQuality(failing);
    const session = connExecute.mock.calls.find(([s]) => /INSERT INTO coaching_session/.test(String(s)));
    expect(session?.[1]?.[3]).toBe("2026-07-31");
  });

  it("rolls back rather than leaving a need pointing at no session", async () => {
    execute.mockResolvedValueOnce(NO_ROWS).mockResolvedValueOnce(COACH);
    connExecute
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockImplementationOnce(() => Promise.reject(new Error("deadlock")));

    await expect(raiseCoachingFromQuality(failing)).rejects.toThrow("deadlock");
    expect(rollback).toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalled();
  });
});
