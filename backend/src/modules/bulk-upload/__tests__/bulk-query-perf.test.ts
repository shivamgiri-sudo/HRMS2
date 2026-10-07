/**
 * Query-shape guards for the upload_batch_row hot paths (16 GB / 2.7M JSON rows in prod).
 * Deleting a batch's rows must be chunked, and importers must not read JSON columns they never use.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const execute = vi.fn();
const query = vi.fn();
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: (...a: unknown[]) => execute(...a),
    query: (...a: unknown[]) => query(...a),
  },
}));

const { deleteBatchRowsChunked, ROW_DELETE_CHUNK_SIZE } =
  await import("../batch-row-status.js");

const src = (f: string) => readFileSync(resolve(__dirname, "..", f), "utf8");

beforeEach(() => {
  execute.mockReset();
  query.mockReset();
});

describe("deleteBatchRowsChunked", () => {
  it("loops with LIMIT-ed, index-ordered deletes until a short chunk", async () => {
    query
      .mockResolvedValueOnce([{ affectedRows: ROW_DELETE_CHUNK_SIZE }])
      .mockResolvedValueOnce([{ affectedRows: ROW_DELETE_CHUNK_SIZE }])
      .mockResolvedValueOnce([{ affectedRows: 17 }]);
    const n = await deleteBatchRowsChunked("b1");
    expect(n).toBe(2 * ROW_DELETE_CHUNK_SIZE + 17);
    expect(query).toHaveBeenCalledTimes(3);
    for (const [sql, params] of query.mock.calls) {
      expect(sql).toMatch(
        /DELETE FROM upload_batch_row WHERE upload_batch_id = \? ORDER BY row_no LIMIT 1000/,
      );
      expect(params).toEqual(["b1"]);
    }
  });

  it("keeps the status predicate when narrowed to statuses", async () => {
    query.mockResolvedValueOnce([{ affectedRows: 0 }]);
    await deleteBatchRowsChunked("b2", ["error", "failed"]);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("row_status IN (?,?)");
    expect(params).toEqual(["b2", "error", "failed"]);
  });

  it("stops after one call when nothing is staged", async () => {
    query.mockResolvedValueOnce([{ affectedRows: 0 }]);
    expect(await deleteBatchRowsChunked("b3")).toBe(0);
    expect(query).toHaveBeenCalledTimes(1);
  });
});

describe("source contracts", () => {
  it("DELETE /batches/:id no longer issues a single unbounded row delete", () => {
    const s = src("bulk-upload.routes.ts");
    expect(s).not.toMatch(
      /DELETE FROM upload_batch_row WHERE upload_batch_id = \?"/,
    );
    expect(s).toContain("deleteBatchRowsChunked(id)");
  });

  it("staged-row importers no longer SELECT * (raw_data / error_messages are unused)", () => {
    for (const f of [
      "weekoff-preference-bulk.service.ts",
      "roster-assignment-bulk.service.ts",
      "shift-roster-bulk.service.ts",
      "shift-rotation-type-bulk.service.ts",
    ]) {
      const s = src(f);
      expect(s).not.toMatch(/SELECT \* FROM upload_batch_row/);
      expect(s).toContain(
        "SELECT id, row_no, normalized_data FROM upload_batch_row",
      );
    }
  });

  it("loadStagedRows reads one JSON column via COALESCE instead of both", () => {
    const s = src("bulk-approval.service.ts");
    expect(s).toContain(
      "COALESCE(normalized_data, raw_data) AS normalized_data",
    );
  });

  it("'anything staged?' checks use EXISTS instead of COUNT(*) over the batch", () => {
    expect(src("bulk-upload.routes.ts")).not.toMatch(
      /COUNT\(\*\) AS n FROM upload_batch_row WHERE upload_batch_id = \?`/,
    );
    expect(src("bridge-insert-helper.ts")).toContain(
      "SELECT EXISTS(SELECT 1 FROM upload_batch_row",
    );
  });
});
