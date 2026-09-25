import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

const { getNeverReported, resetExistingRowsCacheForTests } =
  await import("../feed-health.service.js");

const neverReportedRow = (i: number) => ({
  process_id: `p${i}`,
  process_name: `Process ${i}`,
  metric_code: `METRIC_${i}`,
  metric_name: `Metric ${i}`,
  source_object: `src_table_${i}`,
  process_key_kind: "constant",
  process_key_column: null,
  process_key_value: null,
  employee_key_column: null,
  employee_key_kind: null,
  upload_type_code: `UP_${i}`,
  upload_type_name: `Upload ${i}`,
});

describe("getNeverReported existence counts", () => {
  beforeEach(() => {
    execute.mockReset();
    resetExistingRowsCacheForTests();
  });

  it("serves a repeat call from cache instead of re-counting every source table", async () => {
    execute.mockResolvedValueOnce([[neverReportedRow(1), neverReportedRow(2)]]);
    execute.mockResolvedValue([[{ n: 7 }]]);
    const first = await getNeverReported(new Set(["p1", "p2"]));
    const callsAfterFirst = execute.mock.calls.length;
    expect(callsAfterFirst).toBe(1 + 2);

    execute.mockReset();
    execute.mockResolvedValueOnce([[neverReportedRow(1), neverReportedRow(2)]]);
    const second = await getNeverReported(new Set(["p1", "p2"]));

    expect(execute).toHaveBeenCalledTimes(1);
    expect(second.map((g) => g.existingSourceRows)).toEqual(
      first.map((g) => g.existingSourceRows),
    );
    expect(second.every((g) => g.existingSourceRows === 7)).toBe(true);
  });

  it("does not cache a failed count, so an unknown stays unknown and is retried", async () => {
    execute.mockResolvedValueOnce([[neverReportedRow(1)]]);
    execute.mockRejectedValueOnce(
      Object.assign(new Error("boom"), { code: "ER_X" }),
    );
    const first = await getNeverReported(new Set(["p1"]));
    expect(first[0].existingSourceRows).toBeNull();

    execute.mockReset();
    execute.mockResolvedValueOnce([[neverReportedRow(1)]]);
    execute.mockResolvedValueOnce([[{ n: 3 }]]);
    const second = await getNeverReported(new Set(["p1"]));
    expect(second[0].existingSourceRows).toBe(3);
  });

  it("runs the counts in parallel, but never more than 6 at once", async () => {
    const rows = Array.from({ length: 14 }, (_, i) => neverReportedRow(i + 1));
    execute.mockResolvedValueOnce([rows]);
    let inFlight = 0;
    let peak = 0;
    execute.mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return [[{ n: 1 }]];
    });

    const result = await getNeverReported(
      new Set(rows.map((r) => r.process_id)),
    );

    expect(result).toHaveLength(14);
    expect(result.every((g) => g.existingSourceRows === 1)).toBe(true);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(6);
  });
});
