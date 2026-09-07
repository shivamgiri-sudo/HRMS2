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

/**
 * Checking an upload before it lands.
 *
 * A month is pasted or uploaded in one go, and the failure that matters is the
 * one nobody sees: half the rows write, half are rejected for a reason only
 * visible afterwards, and the dashboard becomes a blend of new and stale
 * figures that still looks complete. The dry run must therefore validate
 * through exactly the same checks the write uses, and must write nothing.
 */
describe("importMetricRows dry run", () => {
  beforeEach(() => {
    execute.mockReset();
    buildScopeWhereClause.mockReset();
    buildScopeWhereClause.mockResolvedValue({ sql: "1=1", params: [] });
  });

  /** process lookup, then the existing-values read the preview uses for hints. */
  function gs1(existing: Array<{ metric_key: string; d: string; actual_value: number | null }> = []) {
    execute.mockImplementation((sql: string) => {
      const text = String(sql);
      if (text.includes("process_master")) return Promise.resolve([[{ process_code: "GS1" }], []]);
      if (text.includes("FROM process_metric_actual")) return Promise.resolve([existing, []]);
      return Promise.resolve([[], []]);
    });
  }

  it("writes nothing at all", async () => {
    gs1();
    const result = await svc.importMetricRows({
      userId: "u1",
      processId: "p1",
      dryRun: true,
      rows: [{ metricKey: "gs1_email_tat_sec", scoreDate: "2026-08-15", value: "2900" }],
    });
    expect(result.dryRun).toBe(true);
    expect(result.imported).toBe(0);
    expect(insertCall()).toBeUndefined();
  });

  it("reports a bad metric key and a bad date per row, rather than failing the batch", async () => {
    gs1();
    const result = await svc.importMetricRows({
      userId: "u1",
      processId: "p1",
      dryRun: true,
      rows: [
        { metricKey: "gs1_email_tat_sec", scoreDate: "2026-08-20", value: "3100" },
        { metricKey: "gs1_not_a_metric", scoreDate: "2026-08-20", value: "5" },
        // The Excel default. It has silently destroyed bulk uploads elsewhere in
        // this system, so the preview has to surface it before the write.
        { metricKey: "gs1_email_tat_sec", scoreDate: "20-08-2026", value: "5" },
      ],
    });
    expect(result.outcomes[0].ok).toBe(true);
    expect(result.outcomes[1].ok).toBe(false);
    expect(result.outcomes[1].message).toMatch(/not a registered metric/i);
    expect(result.outcomes[2].ok).toBe(false);
    expect(result.outcomes[2].message).toMatch(/YYYY-MM-DD/);
    expect(result.errors).toHaveLength(2);
  });

  it("says which rows would OVERWRITE a figure already stored", async () => {
    gs1([{ metric_key: "gs1_email_tat_sec", d: "2026-08-15", actual_value: 3200 }]);
    const result = await svc.importMetricRows({
      userId: "u1",
      processId: "p1",
      dryRun: true,
      rows: [
        { metricKey: "gs1_email_tat_sec", scoreDate: "2026-08-15", value: "2900" },
        { metricKey: "gs1_email_tat_sec", scoreDate: "2026-08-16", value: "2800" },
      ],
    });
    expect(result.outcomes[0].replaces).toBe(3200);
    // Undefined, not null: null is a stored "no reading", absent means nothing there.
    expect(result.outcomes[1].replaces).toBeUndefined();
  });

  it("keeps a blank value as no reading, never as zero", async () => {
    gs1();
    const result = await svc.importMetricRows({
      userId: "u1",
      processId: "p1",
      dryRun: true,
      rows: [{ metricKey: "gs1_datacart_tat_sec", scoreDate: "2026-08-21", value: "" }],
    });
    expect(result.outcomes[0].value).toBeNull();
    expect(result.outcomes[0].ok).toBe(true);
  });

  it("still writes when it is not a dry run", async () => {
    gs1();
    const result = await svc.importMetricRows({
      userId: "u1",
      processId: "p1",
      rows: [{ metricKey: "gs1_email_tat_sec", scoreDate: "2026-08-15", value: "2900" }],
    });
    expect(result.dryRun).toBe(false);
    expect(result.imported).toBe(1);
    expect(insertCall()).toBeTruthy();
  });
});
