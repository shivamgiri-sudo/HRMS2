import { describe, it, expect, vi, beforeEach } from "vitest";

const execute = vi.fn();
vi.mock("../src/db/mysql.js", () => ({ db: { execute: (...a: unknown[]) => execute(...a) } }));
vi.mock("../src/lib/logger.js", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const { recordMappingException, countOpenMappingExceptions } = await import(
  "../src/modules/kpi/mapping-exception.service.js"
);

/**
 * kpi-data-connector's writeFacts() increments a `skipped` counter and moves on
 * when an agent code matches no employee. Nothing recorded WHICH code, so an
 * agent whose identifier drifts just stops being measured — the sync still
 * reports success, only with a smaller number in it.
 *
 * integration_mapping_exception has existed all along, with a resolution
 * workflow behind it, holding 0 rows. This gives it its first writer.
 */

const NO_ROWS: unknown = [[], []];

beforeEach(() => execute.mockReset());

const input = {
  sourceSystem: "quality_audit",
  sourceEntity: "db_audit.call_quality_assessment",
  externalIdentifier: "MAS99999",
  exceptionType: "employee_unmapped" as const,
};

describe("queueing an unmapped identifier", () => {
  it("inserts an open exception the first time", async () => {
    execute.mockResolvedValueOnce(NO_ROWS).mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    await recordMappingException(input);

    const [sql, params] = execute.mock.calls[1];
    expect(sql).toMatch(/INSERT INTO integration_mapping_exception/);
    expect(params).toEqual(
      expect.arrayContaining(["quality_audit", "db_audit.call_quality_assessment", "MAS99999", "employee_unmapped"]),
    );
  });

  it("does not insert a duplicate when an open row already exists", async () => {
    // The table's UNIQUE key includes integration_run_id, and these come from a
    // scheduled sync where it is NULL. MySQL treats NULL <> NULL, so a plain
    // INSERT would add a fresh row on every single sync.
    execute.mockResolvedValueOnce([[{ id: "exc-1" }], []]).mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    await recordMappingException(input);

    expect(execute.mock.calls[1][0]).toMatch(/UPDATE integration_mapping_exception/);
    expect(execute.mock.calls.some(([sql]) => /INSERT INTO/.test(String(sql)))).toBe(false);
  });

  it("refreshes the existing row so its age means 'still happening'", async () => {
    execute.mockResolvedValueOnce([[{ id: "exc-1" }], []]).mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    await recordMappingException(input);
    expect(execute.mock.calls[1][0]).toMatch(/updated_at = NOW\(\)/);
  });

  it("ignores a blank identifier rather than queueing an empty row", async () => {
    await recordMappingException({ ...input, externalIdentifier: "   " });
    expect(execute).not.toHaveBeenCalled();
  });

  it("trims the identifier before storing it", async () => {
    execute.mockResolvedValueOnce(NO_ROWS).mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    await recordMappingException({ ...input, externalIdentifier: "  MAS99999  " });
    expect(execute.mock.calls[0][1]).toContain("MAS99999");
  });

  it("never lets a logging failure break the sync that called it", async () => {
    // A sync that dies because it could not record a warning is strictly worse
    // than one that missed a row.
    // Built lazily: mockRejectedValue creates the rejected promise at
    // configuration time, and the unconsumed one surfaces as an unhandled
    // rejection that fails the test for the wrong reason.
    execute.mockImplementationOnce(() => Promise.reject(new Error("table is gone")));
    await expect(recordMappingException(input)).resolves.toBeUndefined();
  });
});

describe("counting open exceptions", () => {
  it("counts across all sources by default", async () => {
    execute.mockResolvedValueOnce([[{ n: 7 }], []]);
    expect(await countOpenMappingExceptions()).toBe(7);
    expect(execute.mock.calls[0][1]).toEqual([]);
  });

  it("filters by source system when asked", async () => {
    execute.mockResolvedValueOnce([[{ n: 2 }], []]);
    expect(await countOpenMappingExceptions("quality_audit")).toBe(2);
    expect(execute.mock.calls[0][1]).toEqual(["quality_audit"]);
  });

  it("reports zero rather than NaN when the table is empty", async () => {
    execute.mockResolvedValueOnce([[], []]);
    expect(await countOpenMappingExceptions()).toBe(0);
  });
});
