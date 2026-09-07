import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Write side for client-supplied process metrics.
 *
 * Two properties are protected here, both server-side, because the UI is not a
 * security boundary: a caller may only write to a process inside their own
 * scope, and may only write a metric the registry actually defines for that
 * process. Without the second, a typo (or a crafted request) silently creates
 * an orphan metric_key that no dashboard reads and nobody ever notices.
 *
 * The third property is the honesty rule the whole dashboard rests on: a blank
 * value is stored as NULL, never coerced to 0, because a 0 here is
 * indistinguishable from a measured zero.
 */
const { execute, buildScopeWhereClause } = vi.hoisted(() => ({
  execute: vi.fn(),
  buildScopeWhereClause: vi.fn(),
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../shared/scopeAccess.js", () => ({ buildScopeWhereClause }));

const svc = await import("../process-data-source.service.js");

const insertCall = () =>
  execute.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO process_metric_actual"));

describe("saveManualMetricValue", () => {
  beforeEach(() => {
    execute.mockReset();
    buildScopeWhereClause.mockReset();
    buildScopeWhereClause.mockResolvedValue({ sql: "1=1", params: [] });
  });

  it("refuses a metric key the registry does not define for that process", async () => {
    execute.mockResolvedValueOnce([[{ process_code: "GS1" }], []]);
    await expect(
      svc.saveManualMetricValue({
        userId: "u1", processId: "p1", metricKey: "not_a_real_metric",
        scoreDate: "2026-08-01", value: 10,
      }),
    ).rejects.toThrow(/not a registered metric/i);
    expect(insertCall()).toBeUndefined();
  });

  it("refuses a metric that belongs to a different process", async () => {
    // gs1_email_tat_sec is real, but it is GS1's -- not BLA_BLI_BLU's.
    execute.mockResolvedValueOnce([[{ process_code: "BLA_BLI_BLU" }], []]);
    await expect(
      svc.saveManualMetricValue({
        userId: "u1", processId: "p1", metricKey: "gs1_email_tat_sec",
        scoreDate: "2026-08-01", value: 10,
      }),
    ).rejects.toThrow(/not a registered metric/i);
  });

  it("refuses a date that is not YYYY-MM-DD", async () => {
    await expect(
      svc.saveManualMetricValue({
        userId: "u1", processId: "p1", metricKey: "gs1_email_tat_sec",
        scoreDate: "01/08/2026", value: 10,
      }),
    ).rejects.toThrow(/YYYY-MM-DD/);
  });

  it("upserts a valid value tagged as manual", async () => {
    execute
      .mockResolvedValueOnce([[{ process_code: "GS1" }], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    const out = await svc.saveManualMetricValue({
      userId: "u1", processId: "p1", metricKey: "gs1_email_tat_sec",
      scoreDate: "2026-08-01", value: 3200, note: "from client MIS",
    });
    expect(out).toEqual({ ok: true });
    const call = insertCall();
    expect(call).toBeTruthy();
    expect(call![1]).toContain(3200);
    expect(call![1]).toContain("gs1_email_tat_sec");
  });

  it("stores a blank value as NULL rather than as zero", async () => {
    execute
      .mockResolvedValueOnce([[{ process_code: "GS1" }], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    await svc.saveManualMetricValue({
      userId: "u1", processId: "p1", metricKey: "gs1_email_tat_sec",
      scoreDate: "2026-08-01", value: null,
    });
    const params = insertCall()![1] as unknown[];
    expect(params).toContain(null);
    expect(params).not.toContain(0);
  });

  it("rejects an unknown process outright", async () => {
    execute.mockResolvedValueOnce([[], []]);
    await expect(
      svc.saveManualMetricValue({
        userId: "u1", processId: "nope", metricKey: "gs1_email_tat_sec",
        scoreDate: "2026-08-01", value: 1,
      }),
    ).rejects.toThrow(/Unknown process/);
  });
});

describe("assertProcessWritable", () => {
  beforeEach(() => {
    execute.mockReset();
    buildScopeWhereClause.mockReset();
  });

  it("is false when the caller's scope predicate matches no row", async () => {
    buildScopeWhereClause.mockResolvedValue({ sql: "1=0", params: [] });
    execute.mockResolvedValueOnce([[], []]);
    await expect(svc.assertProcessWritable("u1", "p-outside")).resolves.toBe(false);
  });

  it("is true when the scope predicate matches the process", async () => {
    buildScopeWhereClause.mockResolvedValue({ sql: "1=1", params: [] });
    execute.mockResolvedValueOnce([[{ id: "p1" }], []]);
    await expect(svc.assertProcessWritable("u1", "p1")).resolves.toBe(true);
  });

  it("applies the scope predicate in SQL, not after the fact", async () => {
    buildScopeWhereClause.mockResolvedValue({ sql: "p.id IN (?)", params: ["p1"] });
    execute.mockResolvedValueOnce([[{ id: "p1" }], []]);
    await svc.assertProcessWritable("u1", "p1");
    const [sql, params] = execute.mock.calls[0];
    expect(String(sql)).toContain("p.id IN (?)");
    expect(params).toContain("p1");
  });
});
