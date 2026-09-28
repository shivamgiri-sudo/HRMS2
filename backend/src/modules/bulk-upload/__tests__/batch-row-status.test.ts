/**
 * BATCH-1790414059915 (GS1_EMAIL_DAILY, 26,924 rows): flagging every staged row imported with one
 * `WHERE id IN (...)` statement ran for hours holding locks on upload_batch_row and failed every
 * other upload with "Lock wait timeout exceeded". The flagging must be many short statements.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const execute = vi.fn();
vi.mock("../../../db/mysql.js", () => ({ db: { execute: (...a: unknown[]) => execute(...a) } }));

const { markRowsImported, ROW_STATUS_CHUNK_SIZE } = await import("../batch-row-status.js");

beforeEach(() => execute.mockReset());

describe("markRowsImported", () => {
  it("splits 26,924 ids into short statements, none larger than the chunk size", async () => {
    const ids = Array.from({ length: 26_924 }, (_, i) => `row-${i}`);
    await markRowsImported(ids);
    expect(execute).toHaveBeenCalledTimes(Math.ceil(26_924 / ROW_STATUS_CHUNK_SIZE));
    for (const [, params] of execute.mock.calls) {
      expect((params as string[]).length).toBeLessThanOrEqual(ROW_STATUS_CHUNK_SIZE);
    }
  });

  it("flags every id exactly once", async () => {
    const ids = Array.from({ length: 2_345 }, (_, i) => `row-${i}`);
    await markRowsImported(ids);
    const sent = execute.mock.calls.flatMap(([, params]) => params as string[]);
    expect(sent).toEqual(ids);
  });

  it("does nothing for an empty list", async () => {
    await markRowsImported([]);
    expect(execute).not.toHaveBeenCalled();
  });
});
