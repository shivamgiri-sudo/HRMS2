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

const { upsertProcessMetricDefinition, retireProcessMetricDefinition } = await import(
  "../src/modules/kpi/process-metric-definition.write.js"
);

/**
 * process_metric_definition had readers and no writer, so the per-process
 * metrics this whole effort was about could not be entered. Same gap the QA form
 * had: schema, resolver, tests, and no way to create a row.
 *
 * Definitions are superseded rather than edited, because a score computed last
 * month was measured against the definition in force then.
 */

const NO_ROWS: unknown = [[], []];
const OK: unknown = [{ affectedRows: 1 }, []];

const canonical = {
  processId: "p1", metricId: "m-quality", displayName: "CX Score", effectiveFrom: "2026-09-01",
};

beforeEach(() => {
  execute.mockReset(); connExecute.mockReset();
  beginTransaction.mockReset(); commit.mockReset(); rollback.mockReset(); release.mockReset();
  connExecute.mockResolvedValue(OK);
  beginTransaction.mockResolvedValue(undefined);
  commit.mockResolvedValue(undefined);
  rollback.mockResolvedValue(undefined);
  release.mockReturnValue(undefined);
});

describe("what a definition must say", () => {
  it("refuses both a canonical metric and a local code", async () => {
    await expect(upsertProcessMetricDefinition({
      ...canonical, localCode: "GREETING",
    })).rejects.toThrow(/not both and not neither/);
  });

  it("refuses neither", async () => {
    await expect(upsertProcessMetricDefinition({
      processId: "p1", displayName: "X", effectiveFrom: "2026-09-01",
    })).rejects.toThrow(/not both and not neither/);
  });

  it("requires a display name — it is the reason the table exists", async () => {
    await expect(upsertProcessMetricDefinition({
      ...canonical, displayName: "   ",
    })).rejects.toThrow(/displayName is required/);
  });

  it("requires unit and direction on a process-local metric", async () => {
    // No canonical row to inherit from, and "62" means nothing without knowing
    // it is a percentage and that higher is better.
    await expect(upsertProcessMetricDefinition({
      processId: "p1", localCode: "GREETING", displayName: "Greeting",
      effectiveFrom: "2026-09-01",
    })).rejects.toThrow(/needs its own unit and direction/);
  });

  it("accepts a local metric that carries them", async () => {
    connExecute.mockResolvedValueOnce(NO_ROWS).mockResolvedValue(OK);
    const result = await upsertProcessMetricDefinition({
      processId: "p1", localCode: "GREETING", displayName: "Greeting Adherence",
      unit: "percent", direction: "higher_is_better", effectiveFrom: "2026-09-01",
    });
    expect(result.supersededId).toBeNull();
    expect(commit).toHaveBeenCalled();
  });

  it("rejects a weightage outside 0..100", async () => {
    await expect(upsertProcessMetricDefinition({ ...canonical, weightage: 150 }))
      .rejects.toThrow(/between 0 and 100/);
  });
});

describe("superseding rather than editing", () => {
  it("closes the previous definition the day before the new one opens", async () => {
    // No overlap, so a score on any date resolves to exactly one definition.
    connExecute
      .mockResolvedValueOnce([[{ id: "old", effective_from: "2026-01-01" }], []])
      .mockResolvedValue(OK);

    const result = await upsertProcessMetricDefinition(canonical);
    expect(result.supersededId).toBe("old");

    const closing = connExecute.mock.calls.find(([s]) => /UPDATE process_metric_definition/.test(String(s)));
    expect(String(closing?.[0])).toMatch(/DATE_SUB\(\?, INTERVAL 1 DAY\)/);
  });

  it("refuses a second definition starting the same day", async () => {
    // It would collide on the unique key, and the caller may simply have
    // double-submitted a form.
    connExecute.mockResolvedValueOnce([[{ id: "old", effective_from: "2026-09-01" }], []]);
    await expect(upsertProcessMetricDefinition(canonical)).rejects.toMatchObject({ statusCode: 409 });
    expect(rollback).toHaveBeenCalled();
  });

  it("rolls back rather than closing the old without opening the new", async () => {
    // That would leave the process measuring nothing for this metric.
    connExecute
      .mockResolvedValueOnce([[{ id: "old", effective_from: "2026-01-01" }], []])
      .mockResolvedValueOnce(OK)
      .mockImplementationOnce(() => Promise.reject(new Error("deadlock")));

    await expect(upsertProcessMetricDefinition(canonical)).rejects.toThrow("deadlock");
    expect(rollback).toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalled();
  });

  it("looks for the open definition by scope key, so local and canonical do not collide", async () => {
    connExecute.mockResolvedValueOnce(NO_ROWS).mockResolvedValue(OK);
    await upsertProcessMetricDefinition(canonical);
    const lookup = String(connExecute.mock.calls[0][0]);
    expect(lookup).toMatch(/COALESCE\(metric_id, local_code\) = \?/);
  });
});

describe("retiring", () => {
  it("deactivates rather than deleting", async () => {
    // The row still explains scores recorded while it applied.
    execute.mockResolvedValueOnce([[{ effective_from: "2026-01-01" }], []]).mockResolvedValueOnce(OK);
    await retireProcessMetricDefinition("d1", "2026-09-30");
    expect(String(execute.mock.calls[1][0])).toMatch(/active_status = 0/);
    expect(String(execute.mock.calls[1][0])).not.toMatch(/DELETE/);
  });

  it("refuses an end date before the start", async () => {
    execute.mockResolvedValueOnce([[{ effective_from: "2026-10-01" }], []]);
    await expect(retireProcessMetricDefinition("d1", "2026-09-30"))
      .rejects.toThrow(/cannot end before it starts/);
  });

  it("reports a missing definition as 404", async () => {
    execute.mockResolvedValueOnce(NO_ROWS);
    await expect(retireProcessMetricDefinition("nope", "2026-09-30"))
      .rejects.toMatchObject({ statusCode: 404 });
  });
});
