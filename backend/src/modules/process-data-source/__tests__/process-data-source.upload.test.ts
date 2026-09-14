import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Spreadsheet import.
 *
 * A month of figures pasted in by an ops user must not be lost to one typo, so
 * each row is validated on its own and a bad one is reported by its row number
 * while the good ones land. The blank-cell rule is the same as single entry's:
 * NULL, never 0.
 */
const { execute, buildScopeWhereClause } = vi.hoisted(() => ({
  execute: vi.fn(),
  buildScopeWhereClause: vi.fn(),
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../shared/scopeAccess.js", () => ({ buildScopeWhereClause }));

const svc = await import("../process-data-source.service.js");

describe("importMetricRows", () => {
  beforeEach(() => {
    execute.mockReset();
    buildScopeWhereClause.mockReset();
    buildScopeWhereClause.mockResolvedValue({ sql: "1=1", params: [] });
    // Every process lookup answers GS1; inserts answer OK.
    execute.mockImplementation((sql: string) =>
      String(sql).includes("SELECT process_code")
        ? Promise.resolve([[{ process_code: "GS1" }], []])
        : Promise.resolve([{ affectedRows: 1 }, []]),
    );
  });

  it("imports the good rows and reports the bad ones by row number", async () => {
    const out = await svc.importMetricRows({
      userId: "u1", processId: "p1",
      rows: [
        { metricKey: "gs1_email_tat_sec", scoreDate: "2026-08-01", value: "3200" },
        { metricKey: "nope", scoreDate: "2026-08-01", value: "1" },
        { metricKey: "gs1_approval_tat_sec", scoreDate: "not-a-date", value: "1" },
      ],
    });
    expect(out.imported).toBe(1);
    expect(out.errors).toHaveLength(2);
    expect(out.errors[0].row).toBe(2);
    expect(out.errors[1].row).toBe(3);
  });

  it("treats an empty value cell as no reading, not as zero", async () => {
    await svc.importMetricRows({
      userId: "u1", processId: "p1",
      rows: [{ metricKey: "gs1_email_tat_sec", scoreDate: "2026-08-01", value: "" }],
    });
    const insert = execute.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO process_metric_actual"));
    expect(insert![1]).toContain(null);
  });

  it("keeps going after a bad row rather than aborting the batch", async () => {
    const out = await svc.importMetricRows({
      userId: "u1", processId: "p1",
      rows: [
        { metricKey: "bad", scoreDate: "2026-08-01", value: "1" },
        { metricKey: "gs1_email_tat_sec", scoreDate: "2026-08-02", value: "10" },
        { metricKey: "gs1_email_tat_sec", scoreDate: "2026-08-03", value: "20" },
      ],
    });
    expect(out.imported).toBe(2);
    expect(out.errors.map((e) => e.row)).toEqual([1]);
  });
});
